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
  let firstRun = false;
  let savedIn = "machine";
  let path = null;

  // Each of these resolves without a model: a topic the search box finds, a
  // generator named by its alias, or a request about your own history.
  const PLACEHOLDERS = [
    "practice my weakest topic", "convert loop to einsum", "einsum shapes", "attention memory in bf16",
    "conditional probability", "surprise me", "training compute for a 7B model",
    "gradient clipping", "two-digit multiplication", "challenge me", "positional encoding",
    "Bayes rule", "einops rearrange", "review what's due", "log-sum-exp",
    "counting", "early stopping", "number theory", "FLOPs of a matmul",
    "epsilon-delta", "proof practice", "permutations", "residues", "rank-nullity",
  ];
  let placeholderAt = 0;
  // The search box is the product: find the problem worth doing next. One
  // headline per visit, drawn at random so Home doesn't read the same every time.
  const HEADLINES = [
    "What do you want to get better at?",
    "Find the problem worth doing next.",
    "What skill are you building today?",
    "Name a skill. Get the right problems.",
    "What should you practice next?",
    "Search for your next hard problem.",
    "Where do you want to improve?",
  ];
  const HEADLINE = HEADLINES[Math.floor(Math.random() * HEADLINES.length)];
  // Every machine-learning generator (d2l, Bishop, Murphy), for the ML chip.
  const ML_SKILLS = (window.MathGen?.SKILLS ?? [])
    .filter((sk) => /^(ml|dl|bs)-/.test(sk.id)).map((sk) => sk.id).join(",");
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
        <span class="path-dot" aria-hidden="true">${dot(st.status)}</span>
        <span class="sr-only">${{ passed: "Passed:", weak: "Needs work:", started: "Started:", new: "Not started:" }[st.status] ?? ""}</span>
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

  /** What Lattice is, and the ways into it. Open until the first attempt. */
  function introPanel() {
    const pathHref = path?.steps?.length ? `#study|${path.steps[path.current].spec}` : "#study";
    const ways = [
      ["Guided path", "Not sure where to begin? One step at a time, from mental math up to the Putnam.", pathHref],
      ["Study", "Choose fields and books, and get problems matched to your level.", "#study"],
      ["Courses", "Work through one book in order, with unit tests to lock in each chapter.", "#course"],
      ["Graph", "See every concept and what it depends on, then practice any of them.", "#explore"],
    ];
    return `
      <details class="intro"${firstRun ? " open" : ""}>
        <summary>${firstRun ? "New here? How Lattice works" : "How Lattice works"}</summary>
        <div class="intro-body">
          <p>Lattice is a practice tool for university-level math. Its problems come
            from open textbooks, the MATH competition dataset and the Putnam archive.
            Each one is tied to a concept in a graph that records which ideas build on which.</p>
          <p>As you answer, Lattice keeps a rating for each field and a mastery level for
            each concept. It picks your next problem where you should get about 85% right:
            hard enough to learn from.</p>
          <p class="intro-lead">Four ways to start:</p>
          <ul class="intro-ways">${ways.map(([t, d, href]) => `
            <li><a href="${esc(href)}"><b>${esc(t)}</b><span>${esc(d)}</span></a></li>`).join("")}
          </ul>
          <p class="dim">Or type a topic above to jump straight to it.${savedIn === "browser"
            ? " Progress is saved in this browser; there are no accounts." : ""}</p>
        </div>
      </details>`;
  }

  /** Every generated skill whose id matches, so new generators join their chip. */
  const skillsLike = (re) => (window.MathGen?.SKILLS ?? []).filter((sk) => re.test(sk.id)).map((sk) => sk.id).join(",");

  function heroPanel() {
    const chips = [
      due ? [`Reviews (${due})`, "#study|kind=review&count=12"] : null,
      ["5 quick ones", "#study|kind=study&count=5&difficulty=target"],
      ["Mental math", "#study|kind=drill&count=10&label=Mental+math"],
      ["Real-world estimation", `#study|kind=drill&count=6&skills=${skillsLike(/^sf-|^estimate$/)}&label=Real-world+estimation`],
      ["Einsum and shapes", "#study|kind=drill&count=8&skills=es-loop,es-shape,es-which,es-rearrange,es-flops&label=Einsum+and+shapes"],
      ["Machine learning", `#study|kind=drill&count=8&skills=${ML_SKILLS}&label=Machine+learning`],
      ["Probability", `#study|kind=drill&count=8&skills=${skillsLike(/^gs-/)}&label=Probability`],
      ["Proofs", `#study|kind=drill&count=5&skills=${skillsLike(/proof/)}&label=Proofs`],
    ].filter(Boolean);
    return `
      <h1 class="hero-title">${esc(HEADLINE)}</h1>
      ${firstRun ? `<p class="hero-sub">Lattice searches thousands of problems for the ones
        that will improve your skills most right now, and tracks your progress concept by
        concept.</p>` : ""}
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
      ${firstRun ? introPanel() + pathPanel() : pathPanel() + introPanel()}`;
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

  async function paintHistory(rows) {
    const box = el("homeHistory");
    box.innerHTML = rows.length ? rows.map(historyRow).join("")
      : `<li class="history-empty dim">Nothing yet. The first problem you try shows up here.</li>`;
    window.Lattice.typeset(box);
  }

  // ---- progress -----------------------------------------------------------------
  // Everything about how it's going lives here, under the suggestions: ratings
  // by field, the topics you are working on, the last two weeks, and your part
  // of the map. Feedback ("2 missed last time") belongs here, not in the header.

  const pctOf = (x) => `${Math.round((x ?? 0) * 100)}%`;
  const skillName = (id) => (window.MathGen?.SKILLS ?? []).find((sk) => `skill:${sk.id}` === id)?.name;

  async function paintProgress(stats, history) {
    const block = el("homeProgressBlock"), box = el("homeProgress");
    if (!block || !box) return;
    if (!stats?.attempts) { block.hidden = true; return; }
    const [ability, mastery, days] = await Promise.all([
      get("/ability").then((d) => d.domains ?? []).catch(() => []),
      get("/mastery").catch(() => []),
      get("/activity?days=14").catch(() => []),
    ]);

    // Fields you have actually practised, most practised first.
    const fields = ability.filter((a) => a.attempts).sort((a, b) => b.attempts - a.attempts).slice(0, 5);
    const fieldRows = fields.map((a) => {
      const delta = a.rating - 1200;
      return `<li><a href="#subject|${encodeURIComponent(a.domain)}">${esc(a.domain)}</a>
        <b>${a.rating}</b>
        <span class="dim">${delta === 0 ? "±0" : delta > 0 ? `▲ ${delta}` : `▼ ${-delta}`} · ${
          window.Lattice.count(a.attempts, "attempt")}${a.confident ? "" : " · provisional"}</span></li>`;
    }).join("");

    // Topics touched most recently, with where their mastery stands.
    const recent = [...mastery].sort((a, b) => (b.last_ts ?? 0) - (a.last_ts ?? 0)).slice(0, 5);
    const topicRows = recent.map((m) => {
      const name = skillName(m.concept_id) ?? m.label ?? m.concept_id;
      const href = m.concept_id.startsWith("skill:")
        ? `#study|${new URLSearchParams({ kind: "drill", skills: m.concept_id.slice(6), count: "6", label: name })}`
        : `#explore|${encodeURIComponent(m.concept_id)}`;
      return `<li><a href="${href}">${esc(name)}</a>
        <span class="cov-track" aria-hidden="true"><span class="cov-fill" style="width:${pctOf(m.mastery)}"></span></span>
        <span class="dim">${pctOf(m.mastery)} mastery</span></li>`;
    }).join("");

    // The last session's misses, as something to do rather than a greeting.
    const last = history[0]?.ts ?? 0;
    const missed = history.filter((h) => last - h.ts < 12 * 3600e3
      && (h.outcome === "failed" || h.outcome === "partial") && h.openable);
    const retry = missed.length
      ? `<a class="progress-retry" href="${itemsHash(missed.map((h) => h.item_id), missed[0].domain, "Retry last session's misses")}">
          ${window.Lattice.count(missed.length, "problem")} missed last session · retry →</a>` : "";

    // Two weeks of activity, oldest first.
    const byDay = new Map(days.map((d) => [d.day, d.n]));
    const today = new Date();
    const strip = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() - 13 + i);
      const key = d.toISOString().slice(0, 10);
      return { key, n: byDay.get(key) ?? 0 };
    });
    const peak = Math.max(1, ...strip.map((d) => d.n));
    const total14 = strip.reduce((s, d) => s + d.n, 0);

    box.innerHTML = `
      ${fields.length ? `<div class="progress-card"><p class="field-label">Fields</p><ul class="progress-list">${fieldRows}</ul></div>` : ""}
      ${recent.length ? `<div class="progress-card"><p class="field-label">Working on</p><ul class="progress-list">${topicRows}</ul></div>` : ""}
      <div class="progress-card">
        <p class="field-label">Last 14 days · ${window.Lattice.count(total14, "attempt")} · ${stats.streak ?? 0}-day streak</p>
        <div class="progress-strip" role="img" aria-label="${total14} attempts in the last 14 days">
          ${strip.map((d) => `<i title="${d.key}: ${d.n}" style="height:${Math.max(4, (d.n / peak) * 100)}%"
            class="${d.n ? "" : "is-zero"}"></i>`).join("")}
        </div>
        ${retry}
        ${stats.due ? `<a class="progress-retry" href="#study|kind=review&count=12">${
          window.Lattice.count(stats.due, "review")} due →</a>` : ""}
      </div>
      <a class="progress-card progress-map" href="#explore" title="Open the full graph">
        <p class="field-label">Your map</p>
        <canvas id="homeMiniMap" aria-label="Miniature of the concept graph, coloured by mastery"></canvas>
      </a>`;
    block.hidden = false;
    window.Lattice.typeset(box);
    // The miniature needs the graph module's layout; it loads the graph once.
    const mini = el("homeMiniMap");
    if (mini && window.LatticeGraph?.drawMini) window.LatticeGraph.drawMini(mini).catch?.(() => {});
  }

  async function render() {
    const [stats, history, p] = await Promise.all([
      get("/stats").catch(() => null),
      get("/history?limit=8").catch(() => []),
      get("/path").catch(() => null),
    ]);
    due = stats?.due ?? 0;
    firstRun = !stats?.attempts;
    savedIn = stats?.saved_in ?? "machine";
    path = p;
    el("homeHero").innerHTML = heroPanel();
    rotatePlaceholder();
    results = [];
    await Promise.all([paintSuggestions(), paintHistory(history)]);
    paintProgress(stats, history).catch(() => {});
  }

  window.Lattice.register("home", () => render().catch((err) => {
    el("homeHero").innerHTML = `<p class="dim">Home needs the server API
      (${esc(err.message)}).</p>`;
  }));
})();
