// Home: ask for something, or pick up a problem.
//
// A search box that answers as you type (and, on Enter, turns a sentence into a
// practice set); the guided path, for when you would rather be told; a handful
// of problems the ranker thinks you should try next; and the problems you worked
// most recently. Ratings, plans and the graph live on their own pages.
(() => {
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const get = (p) => fetch(`/api${p}`).then((r) => {
    if (!r.ok) throw new Error(`${p} → ${r.status}`);
    return r.json();
  });

  /** A set that opens on these problems, then carries on in their field. */
  function itemsHash(ids, domain, label) {
    const q = new URLSearchParams({ kind: "items", items: ids.join(",") });
    if (domain) q.set("domains", domain);
    q.set("label", label || domain || "Practice");
    return `#study|${q}`;
  }

  function ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400);
    return d === 1 ? "yesterday" : d < 30 ? `${d} days ago`
      : new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  // ---- search ----------------------------------------------------------------
  // Typing searches concepts, fields, books and techniques (/search, which is
  // plain substring ranking and answers before the next keystroke). Enter with
  // nothing highlighted sends the sentence to /practice-request instead, which
  // reads it as a request for a set. Without a model key that only understands
  // named drills, so an unreadable request falls back to the best search hit.

  let results = [];      // current dropdown rows
  let active = -1;       // highlighted row, -1 for none
  let lastQuery = "";
  let asking = false;
  let searchTimer = null;
  let due = 0;
  let greeting = "";
  let path = null;

  // Real topics from the corpus, each of which the search box finds.
  const PLACEHOLDERS = [
    "eigenvalues", "conditional probability", "15 minutes of number theory",
    "Bayes rule", "induction", "two-digit multiplication", "determinants",
  ];
  let placeholderAt = 0;
  let placeholderTimer = null;

  function rotatePlaceholder() {
    clearInterval(placeholderTimer);
    placeholderTimer = setInterval(() => {
      const input = el("askInput");
      if (!input) return clearInterval(placeholderTimer);
      if (input.value || document.activeElement === input) return;
      placeholderAt = (placeholderAt + 1) % PLACEHOLDERS.length;
      input.placeholder = `try “${PLACEHOLDERS[placeholderAt]}”`;
    }, 3200);
  }

  const ROUTE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="2.2"/>
    <circle cx="18" cy="5" r="2.2"/><path d="M8.2 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8"/></svg>`;

  /** The guided path, as one button and a list you can open. */
  function pathPanel() {
    if (!path?.steps?.length) return "";
    const step = path.steps[path.current];
    const dot = (st) => ({ passed: "✓", weak: "!", started: "·", new: "" }[st] ?? "");
    let stage = "";
    const list = path.steps.map((st) => {
      const head = st.stage !== stage ? `<li class="path-stage">${esc(stage = st.stage)}</li>` : "";
      const stats = st.attempts
        ? `${st.attempts} tried · ${Math.round((st.accuracy ?? 0) * 100)}% lately` : "";
      return `${head}<li class="path-step s-${st.status}${st.index === path.current ? " is-current" : ""}">
        <span class="path-dot">${dot(st.status)}</span>
        <a href="#study|${esc(st.spec)}">${esc(st.title)}</a>
        <span class="path-stat">${esc(stats)}</span></li>`;
    }).join("");
    return `
      <div class="path-card">
        <a class="path-go" href="#study|${esc(step.spec)}">
          <span class="path-icon">${ROUTE_ICON}</span>
          <span class="path-text">
            <span class="path-kicker">Guided path · step ${path.current + 1} of ${path.total}</span>
            <b>${esc(step.title)}</b>
            <span class="path-reason">${esc(path.reason)}</span>
          </span>
          <span class="path-arrow">→</span>
        </a>
        <details class="path-all">
          <summary>See the whole path · ${path.passed} of ${path.total} done</summary>
          <ol class="path-list">${list}</ol>
        </details>
      </div>`;
  }

  function heroPanel() {
    const chips = [
      due ? [`Reviews (${due})`, "#study|kind=review&count=12"] : null,
      ["5 quick ones", "#study|kind=study&count=5&difficulty=target"],
      ["Mental math", "#study|kind=drill&count=10&label=Mental+math"],
    ].filter(Boolean);
    return `
      ${greeting ? `<p class="home-greeting">${esc(greeting)}</p>` : ""}
      <h1 class="hero-title">What are you working on?</h1>
      <div class="ask-wrap">
        <form class="ask" id="askForm" autocomplete="off">
          <input id="askInput" class="ask-input" type="text"
                 placeholder="try “${esc(PLACEHOLDERS[placeholderAt])}”"
                 aria-label="Search or describe what you want to practice"
                 aria-controls="askSuggest" aria-autocomplete="list" />
          <button class="ask-go" type="submit" aria-label="Start">→</button>
        </form>
        <ul id="askSuggest" class="ask-suggest" role="listbox" hidden></ul>
      </div>
      <div id="askStatus" class="ask-status" hidden></div>
      <div class="home-chips">${chips.map(([label, href]) =>
        `<a class="ask-eg" href="${href}">${esc(label)}</a>`).join("")}</div>
      ${pathPanel()}`;
  }

  function askStatus(html, tone = "") {
    const box = el("askStatus");
    if (!box) return;
    box.hidden = !html;
    box.className = `ask-status ${tone}`;
    box.innerHTML = html;
  }

  function paintSuggest() {
    const list = el("askSuggest");
    if (!list) return;
    const text = el("askInput")?.value.trim() ?? "";
    if (!text) { list.hidden = true; list.innerHTML = ""; return; }
    // The first row is always "practise exactly what I typed", so Enter and a
    // click on it do the same thing.
    const rows = [{ kind: "practice", label: `Practice “${text}”`, sub: "build a set" },
                  ...results];
    list.hidden = false;
    list.innerHTML = rows.map((r, i) => `
      <li class="palette-row${i === active ? " on" : ""}" role="option" data-row="${i}"
          aria-selected="${i === active}">
        <span class="palette-kind k-${esc(r.kind)}">${esc(r.kind)}</span>
        <span class="palette-label">${esc(r.label)}</span>
        <span class="palette-sub">${esc(r.sub ?? "")}</span>
      </li>`).join("");
  }

  async function search(text) {
    lastQuery = text;
    if (text.length < 2) { results = []; return paintSuggest(); }
    const d = await get(`/search?q=${encodeURIComponent(text)}&limit=6`).catch(() => null);
    if (text !== lastQuery) return;          // a later keystroke already won
    results = d?.results ?? [];
    active = -1;
    paintSuggest();
  }

  function choose(i) {
    if (i <= 0) return ask(el("askInput").value);
    const r = results[i - 1];
    if (r?.href) location.hash = r.href;
  }

  async function ask(text) {
    text = text.trim();
    if (asking || !text) return;
    asking = true;
    el("askSuggest").hidden = true;
    askStatus("Building a set…");
    try {
      const r = await fetch("/api/practice-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.understood && !d.empty) {
        askStatus("");
        location.hash = `#study|${d.spec}`;
        return;
      }
      // Not a request the parser could run. The search box already knows the
      // closest concept, so go there rather than dead-ending.
      if (results[0]?.href) {
        askStatus("");
        location.hash = results[0].href;
        return;
      }
      askStatus("Couldn't find that. Try a topic like “eigenvalues” or “conditional probability”.",
        "bad");
    } catch (err) {
      askStatus(esc(err.message), "bad");
    } finally {
      asking = false;
    }
  }

  document.addEventListener("input", (ev) => {
    if (ev.target.id !== "askInput") return;
    askStatus("");
    active = -1;
    paintSuggest();
    clearTimeout(searchTimer);
    const text = ev.target.value.trim();
    searchTimer = setTimeout(() => search(text), 120);
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.target.id !== "askInput") return;
    const n = results.length + 1;
    if (ev.key === "ArrowDown") { ev.preventDefault(); active = (active + 1) % n; paintSuggest(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); active = (active - 1 + n) % n; paintSuggest(); }
    else if (ev.key === "Escape") { el("askSuggest").hidden = true; }
  });

  document.addEventListener("submit", (ev) => {
    if (ev.target.id !== "askForm") return;
    ev.preventDefault();
    choose(active);
  });

  document.addEventListener("mousedown", (ev) => {
    const row = ev.target.closest("#askSuggest [data-row]");
    if (row) { ev.preventDefault(); return choose(Number(row.dataset.row)); }
    if (!ev.target.closest(".ask-wrap")) {
      const list = el("askSuggest");
      if (list) list.hidden = true;
    }
  });

  document.addEventListener("focusin", (ev) => {
    if (ev.target.id === "askInput" && ev.target.value.trim()) paintSuggest();
  });

  // ---- suggestions -------------------------------------------------------------
  // Four problems from the same ranker the study queue uses: near the level
  // where you solve about 85%, prerequisites mostly held, not seen recently.
  // It samples from a band, so "Show others" really does show others.

  let shown = [];

  function fitLabel(p) {
    const s = p.predicted_success;
    if (s == null) return "";
    return s >= 0.8 ? "easy start" : s >= 0.55 ? "your level" : "reach";
  }

  function suggestCard(p) {
    const title = p.concept_label || p.section_title || p.label || "Problem";
    return `
      <a class="suggest-card" href="${itemsHash([p.id], p.domain, p.domain)}">
        <span class="suggest-meta">
          <span>${esc(p.domain ?? "")}</span>
          ${fitLabel(p) ? `<span class="suggest-fit">${esc(fitLabel(p))}</span>` : ""}
        </span>
        <b class="suggest-title">${esc(title)}</b>
        <span class="suggest-text">${esc(p.text ?? "")}</span>
        <span class="suggest-cite">${esc(p.cite ?? "")}</span>
      </a>`;
  }

  async function paintSuggestions() {
    const box = el("homeSuggest");
    const exclude = shown.length ? `&exclude=${encodeURIComponent(shown.join(","))}` : "";
    const picks = await get(`/next?limit=4${exclude}`).catch(() => []);
    if (!picks.length && shown.length) {
      shown = [];                            // ran through the band: start over
      return paintSuggestions();
    }
    shown = [...shown, ...picks.map((p) => p.id)].slice(-40);
    box.innerHTML = picks.length ? picks.map(suggestCard).join("")
      : `<p class="dim">Nothing to suggest yet.</p>`;
    window.Lattice.typeset(box);
  }

  document.addEventListener("click", (ev) => {
    if (ev.target.closest("#homeShuffle")) paintSuggestions();
  });

  // ---- history -----------------------------------------------------------------

  const OUTCOME = {
    solved: ["Solved", "ok"], partial: ["Partial", "part"],
    failed: ["Missed", "bad"], skipped: ["Skipped", "skip"],
  };

  function historyRow(h) {
    const [word, tone] = OUTCOME[h.outcome] ?? [h.outcome, "skip"];
    const title = h.concept_label || h.section_title || h.label || h.item_id;
    const meta = [h.domain, ago(h.ts), h.tries > 1 ? `${h.tries} tries` : null]
      .filter(Boolean).join(" · ");
    const again = h.outcome === "solved" ? "Open" : "Try again";
    return `
      <li class="history-row">
        <span class="history-outcome o-${tone}">${esc(word)}</span>
        <span class="history-body">
          <b>${esc(title)}</b>
          ${h.text ? `<span class="history-text">${esc(h.text)}</span>` : ""}
          <span class="history-meta">${esc(meta)}</span>
        </span>
        ${h.openable
          ? `<a class="ghost-btn" href="${itemsHash([h.item_id], h.domain, title)}">${again}</a>`
          : ""}
      </li>`;
  }

  /** One line that knows whether you have been here before. "Last time" is the
   *  run of attempts within half a day of the most recent one. */
  function greet(rows) {
    if (!rows.length) return "Pick anything. It adapts as you go.";
    const last = rows[0].ts;
    const missed = rows.filter((r) => last - r.ts < 12 * 3600e3
      && (r.outcome === "failed" || r.outcome === "partial")).length;
    return missed ? `Welcome back. ${missed} missed last time.` : "Welcome back.";
  }

  async function paintHistory(rows) {
    const box = el("homeHistory");
    box.innerHTML = rows.length ? rows.map(historyRow).join("")
      : `<li class="history-empty dim">Nothing yet. The first problem you try shows up here.</li>`;
    window.Lattice.typeset(box);
  }

  async function render() {
    const [stats, history, p] = await Promise.all([
      get("/stats").catch(() => null),
      get("/history?limit=8").catch(() => []),
      get("/path").catch(() => null),
    ]);
    due = stats?.due ?? 0;
    greeting = greet(history);
    path = p;
    el("homeHero").innerHTML = heroPanel();
    rotatePlaceholder();
    results = [];
    await Promise.all([paintSuggestions(), paintHistory(history)]);
  }

  window.Lattice.register("home", () => render().catch((err) => {
    el("homeHero").innerHTML = `<p class="dim">Home needs the server API
      (${esc(err.message)}).</p>`;
  }));
})();
