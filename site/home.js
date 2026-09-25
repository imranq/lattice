// Home: where you are, what to do today, and the map beside it.
//
// Every mastery figure is shown against its denominator — 3 of 387 concepts
// assessed is not "94% of probability", it is almost no evidence — and the plan
// is the same one Lattice writes into Cadence, so the two never disagree.
(() => {
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;

  const get = (p) => fetch(`/api${p}`).then((r) => {
    if (!r.ok) throw new Error(`${p} → ${r.status}`);
    return r.json();
  });

  /** The last 18 weeks of attempts, one cell a day. Shared shape with Stats;
   *  Home shows it because a streak you cannot see is a streak you forget. */
  function heatmap(days) {
    const byDay = new Map(days.map((d) => [d.day, d]));
    const max = Math.max(1, ...days.map((d) => d.n));
    const start = new Date();
    start.setDate(start.getDate() - 125 - start.getDay());
    const cells = [];
    for (let i = 0; i < 126; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const rec = byDay.get(key);
      const level = rec ? Math.min(4, 1 + Math.floor((rec.n / max) * 3)) : 0;
      cells.push(`<i class="cell l${level}" title="${key}: ${rec ? rec.n : 0} attempts"></i>`);
    }
    return `<div class="heatmap-wrap"><div class="heatmap">${cells.join("")}</div></div>
      <div class="heatmap-key"><span>less</span>
        ${[0, 1, 2, 3, 4].map((l) => `<i class="cell l${l}"></i>`).join("")}
        <span>more</span></div>`;
  }

  /** The frontier: concepts whose prerequisites you hold and which you do not.
   *  This is the graph doing its job — the ordered list of what to learn next. */
  function frontierPanel(front) {
    if (!front.length) {
      return `<div class="panel-heading"><div><p class="eyebrow">Next</p>
        <h2>Ready to learn</h2></div></div>
        <p class="dim">Answer a few problems and the graph will start pointing
          at what you have earned the prerequisites for.</p>`;
    }
    return `
      <div class="panel-heading">
        <div><p class="eyebrow">Next</p><h2>Ready to learn</h2></div>
        <span class="data-count">prerequisites met · not yet held</span>
      </div>
      <p class="panel-note">Each of these sits just past what you already know:
        everything it builds on is held, and it is not. Working outward from here
        is the shortest route to depth.</p>
      <ol class="frontier">${front.slice(0, 6).map((f) => `
        <li>
          <a class="frontier-name" href="#explore|${encodeURIComponent(f.concept_id)}"
             title="Show it on the graph">${esc(f.label)}</a>
          <span class="frontier-meta">${esc(f.domain ?? "")} ·
            ${f.exercises} problem${f.exercises === 1 ? "" : "s"}${
              f.prereqs_total ? ` · ${f.prereqs_met}/${f.prereqs_total} prerequisites known` : ""}</span>
          <span class="frontier-state">${f.mastery === null
            ? `<span class="tag">new</span>`
            : `<span class="tag tag-part">${Math.round(f.mastery * 100)}% so far</span>`}</span>
          <a class="ghost-btn" href="${blockHash({ kind: "study", concepts: [f.concept_id],
             domains: f.domain ? [f.domain] : [], count: Math.min(f.exercises || 6, 8),
             title: f.label })}" title="Practise exactly this concept">Practise</a>
        </li>`).join("")}</ol>`;
  }

  function activityPanel(activity, stats) {
    const last30 = activity.filter((d) => d.n > 0).length;
    return `
      <div class="panel-heading">
        <div><p class="eyebrow">Activity</p><h2>The last 18 weeks</h2></div>
        <span class="data-count">${last30} active day${last30 === 1 ? "" : "s"} ·
          ${stats.minutes ?? 0} min logged</span>
      </div>
      ${activity.length
        ? heatmap(activity)
        : `<p class="dim">Nothing logged yet. One attempt fills the first square.</p>`}`;
  }

  function levelsPanel(ability) {
    const rows = (ability.domains ?? []).filter((d) => d.pool).slice(0, 7);
    return `
      <div class="panel-heading"><div><p class="eyebrow">Level</p>
        <h2>Where you sit</h2></div>
        <a class="link-btn" href="#stats">all stats →</a></div>
      ${rows.length ? rows.map((d) => `
        <div class="cov-row">
          <span class="cov-label"><a href="#subject|${encodeURIComponent(d.domain)}">${
            esc(d.domain)}</a></span>
          <span class="cov-track"><span class="cov-fill" style="width:${
            Math.max(3, Math.min(100, ((d.rating - 700) / 1400) * 100))}%"></span></span>
          <span class="cov-num">${d.rating}</span>
          <span class="cov-sub">${d.attempts
            ? `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}${
                d.confident ? "" : " · provisional"}`
            : "not started"}</span>
        </div>`).join("")
        : `<p class="dim">No field has a rating yet.</p>`}`;
  }

  // ---- today's plan --------------------------------------------------------
  // The schedule used to be advice: three lines of prose and a Start link that
  // dropped you into whatever the study sidebar was last set to. Now each block
  // *is* a set — a kind, an exact list of fields, books or drills, and a count —
  // and Start opens precisely that. The recommendation is the starting point;
  // every block is editable, and the plan you edit is the plan that is kept.
  const PLAN_KEY = "lattice_plan_v2";
  let plan = { blocks: [] };
  let recommended = { blocks: [] };
  let editing = false;
  let sets = { domains: [], books: [], skills: [] };
  let challenge = null;   // the mastery-challenge gate, as the server reports it
  let nextset = null;     // the single set the server recommends running now
  let lastStats = null;   // the counts the quick-action row reads

  const KINDS = {
    drill:  ["Drills", "generated mental-math, auto-graded"],
    review: ["Review", "only items spaced repetition has scheduled"],
    study:  ["Problems", "book problems at the edge of what you can do"],
  };

  const loadPlan = () => {
    try { return JSON.parse(localStorage.getItem(PLAN_KEY)); } catch { return null; }
  };
  const savePlan = () => {
    try { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); } catch { /* private mode */ }
  };

  /** The block as the study view wants it: `#study|kind=…&count=…`. */
  function blockHash(b) {
    const q = new URLSearchParams();
    q.set("kind", b.kind ?? "study");
    for (const k of ["domains", "books", "skills", "concepts"]) {
      if (b[k]?.length) q.set(k, b[k].join(","));
    }
    if (b.count) q.set("count", String(b.count));
    if (b.title) q.set("label", b.title);
    return `#study|${q}`;
  }

  /** Server blocks (from /plan) → the editable shape kept in localStorage. */
  const toEditable = (b) => ({
    id: b.id,
    kind: b.session?.kind ?? "study",
    title: b.title,
    body: b.body ?? b.description ?? "",
    minutes: Math.round(b.duration / 60),
    count: b.session?.count ?? b.target ?? 0,
    domains: b.session?.domains ?? [],
    books: b.session?.books ?? [],
    skills: b.session?.skills ?? [],
    concepts: b.session?.concepts ?? [],
  });

  const setLabel = (key, id) =>
    sets[key].find((x) => x.id === id)?.label ?? id;

  /** What a block actually contains, in words, so a set is never a mystery. */
  function blockScope(b) {
    const parts = [];
    if (b.count) parts.push(`${b.count} item${b.count === 1 ? "" : "s"}`);
    if (b.kind === "drill") {
      parts.push(b.skills.length
        ? b.skills.map((id) => setLabel("skills", id)).join(", ")
        : "every drill skill");
    } else if (b.kind === "review") {
      parts.push("whatever is due");
    } else {
      parts.push(b.domains.length
        ? b.domains.map((id) => setLabel("domains", id)).join(", ")
        : "every field");
      if (b.books.length) {
        parts.push(`${b.books.length} book${b.books.length === 1 ? "" : "s"}: ${
          b.books.map((id) => setLabel("books", id)).join(", ")}`);
      }
    }
    return parts.join(" · ");
  }

  const pickerRow = (b, i, key, label) => `
    <label class="block-field">
      <span>${label}</span>
      <span class="block-chips">${sets[key].map((x) => `
        <button type="button" class="chip-toggle${b[key].includes(x.id) ? " on" : ""}"
          data-block="${i}" data-key="${esc(key)}" data-id="${esc(x.id)}"
          title="${esc(x.hint ?? "")}">${esc(x.label)}</button>`).join("")
        || `<span class="dim">none available</span>`}
      <button type="button" class="link-btn" data-block="${i}" data-clear="${esc(key)}"
        >${b[key].length ? "clear" : "all"}</button></span>
    </label>`;

  function blockEditor(b, i) {
    return `
      <div class="block-edit">
        <div class="block-row">
          <label class="block-field"><span>Name</span>
            <input type="text" value="${esc(b.title)}" data-block="${i}" data-set="title" /></label>
          <label class="block-field short"><span>Minutes</span>
            <input type="number" min="1" max="240" value="${b.minutes}"
              data-block="${i}" data-set="minutes" /></label>
          <label class="block-field short"><span>Items</span>
            <input type="number" min="0" max="200" value="${b.count}"
              data-block="${i}" data-set="count" /></label>
          <label class="block-field short"><span>Kind</span>
            <select data-block="${i}" data-set="kind">${Object.entries(KINDS)
              .map(([k, [name]]) => `<option value="${k}"${
                b.kind === k ? " selected" : ""}>${name}</option>`).join("")}</select></label>
        </div>
        ${b.kind === "drill" ? pickerRow(b, i, "skills", "Drill skills")
          : b.kind === "study" ? `${pickerRow(b, i, "domains", "Fields")}
              ${pickerRow(b, i, "books", "Books")}`
          : `<p class="dim block-note">${esc(KINDS.review[1])}</p>`}
        <div class="block-tools">
          <button type="button" class="link-btn" data-move="${i}" data-dir="-1">↑</button>
          <button type="button" class="link-btn" data-move="${i}" data-dir="1">↓</button>
          <button type="button" class="link-btn danger" data-remove="${i}">Remove</button>
        </div>
      </div>`;
  }

  /** The interleaved review, and — when it is locked — exactly what unlocks it.
   *  A card that only appears when available teaches nobody the rule. */
  function challengePanel(ch) {
    if (!ch) return "";
    return `
      <div class="challenge-card${ch.available ? " open" : " shut"}">
        <div>
          <p class="eyebrow">Mixed review</p>
          <h3>Mastery challenge</h3>
          <p class="dim">${ch.available
            ? `Six questions across three topics from different books, interleaved.
               A clean answer is the only way to move a topic to <b>mastered</b>.`
            : `Needs ${esc(ch.reason)}.`}</p>
          <p class="challenge-meta">${ch.familiar}/${ch.need_familiar} familiar ·
            ${ch.proficient}/${ch.need_proficient} proficient${
            ch.next_ts ? ` · opens ${new Date(ch.next_ts).toLocaleTimeString([],
              { hour: "numeric", minute: "2-digit" })}` : ""}</p>
        </div>
        ${ch.available
          ? `<a class="btn-primary" href="#study|kind=assess&assess=mastery">Start</a>`
          : `<span class="ghost-btn is-off">Locked</span>`}
      </div>`;
  }

  /** The one-button answer to "what should I do now".
   *
   *  The plan below it is a schedule you curate; this is a single set the server
   *  committed to, with the reason attached. The reason is the point — a
   *  recommendation you cannot check is one you cannot disagree with, and
   *  everything behind this comes from the graph and the attempt log, so it can
   *  always be spelled out. */
  function nextSetPanel(ns) {
    if (!ns) return "";
    if (ns.kind === "none") {
      return `<div class="nextset-card empty">
        <div><p class="eyebrow">Next</p><h3>${esc(ns.label)}</h3>
        <p class="dim">${esc(ns.reason)}</p></div></div>`;
    }
    return `
      <div class="nextset-card">
        <div class="nextset-body">
          <p class="eyebrow">Next · ${esc(ns.kind === "review" ? "review" : "practice")}</p>
          <h3>${esc(ns.label)}</h3>
          <p class="dim">${esc(ns.reason)}</p>
          ${ns.why.length ? `<ul class="nextset-why">${ns.why.map((w) =>
            `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
        </div>
        <div class="nextset-go">
          <span class="data-count">${ns.count} problem${ns.count === 1 ? "" : "s"}</span>
          <a class="btn-primary" href="#study|${ns.spec}">Start</a>
        </div>
      </div>`;
  }


  // ---- the ask box ---------------------------------------------------------
  // "What do you want to practice?" — a sentence in, a runnable set out.
  //
  // The model never reads the corpus for this. One call parses the *request*
  // (~370ms, $0.000043 measured) into tags, a field, a difficulty offset and a
  // count; the server then filters the pre-computed tags with ordinary SQL.
  // Scoring 4,104 exercises per keystroke would cost about $0.12 and minutes of
  // wall time per press, which is a bill rather than a feature.
  //
  // The quick actions beneath it exist because most sessions are one of five
  // things, and a person who knows what they want should not have to type it.

  const EXAMPLES = [
    "Give me probability practice for 20 minutes",
    "Help me review quotient groups",
    "Drill my weakest prerequisite",
  ];

  let asking = false;   // a request is in flight

  function quickActions(ns) {
    // "Weak spot" runs whatever /next-set decided, so the button and the card
    // below it can never disagree about what the weakest thing is.
    const weakHref = ns?.spec ? `#study|${ns.spec}` : "#study";
    const items = [
      ["Continue", "Pick up where you left off", "#study", "primary"],
      ["Reviews", `${lastStats?.due ?? 0} due`, "#study|kind=review&count=12", ""],
      ["Weak spot", "Focus your practice", weakHref, ""],
      ["Quick 5", "5 problems, now", "#study|kind=study&count=5&difficulty=target", ""],
      ["Surprise me", "Let Lattice choose", "#study|kind=study&count=8&difficulty=adaptive", ""],
    ];
    return `<div class="quick-row">${items.map(([name, sub, href, tone]) => `
      <a class="quick-card ${tone}" href="${href}">
        <b>${esc(name)}</b><span>${esc(sub)}</span>
      </a>`).join("")}</div>`;
  }

  function heroPanel(ns) {
    return `
      <h1 class="hero-title">What do you want to practice?</h1>
      <form class="ask" id="askForm" autocomplete="off">
        <input id="askInput" class="ask-input" type="text"
               placeholder="Describe what you want to practice…"
               aria-label="Describe what you want to practice" />
        <button class="ask-go" type="submit" aria-label="Build this set">→</button>
      </form>
      <div class="ask-examples">${EXAMPLES.map((e) =>
        `<button class="ask-eg" data-eg="${esc(e)}">“${esc(e)}”</button>`).join("")}</div>
      <div id="askPreview" class="ask-preview" hidden aria-live="polite"></div>
      <div id="askStatus" class="ask-status" hidden></div>
      ${quickActions(ns)}`;
  }

  function paintHero() { el("homeHero").innerHTML = heroPanel(nextset); }

  function askStatus(html, tone = "") {
    const box = el("askStatus");
    if (!box) return;
    box.hidden = !html;
    box.className = `ask-status ${tone}`;
    box.innerHTML = html;
  }

  // A tiny, truthful animation: it visualises the parsed route returned by
  // Jev, rather than simulating model thought. The same component works for a
  // skill, a concept/tag, or a weakness request, and disappears as soon as the
  // study set opens.
  function askPreview(stage, text, parsed = null) {
    const box = el("askPreview");
    if (!box) return;
    if (stage === "hide") { box.hidden = true; box.innerHTML = ""; return; }
    const labels = new Map((window.MathGen?.SKILLS ?? []).map((s) => [s.id, s.name]));
    const middle = parsed?.skills?.length
      ? labels.get(parsed.skills[0].id) ?? parsed.skills[0].id
      : parsed?.tags?.length ? parsed.tags[0].name
      : parsed?.domains?.length ? parsed.domains[0].name
      : parsed?.needs_weakness > 0.5 ? "your weak areas" : "your practice frontier";
    const end = parsed
      ? `${parsed.count ?? 5} problems · ${parsed.kind === "computations" ? "computed answers" : "written solutions"}`
      : "reading your intent…";
    box.hidden = false;
    box.innerHTML = `<div class="ask-route ${stage === "ready" ? "is-ready" : ""}">
      <span class="ask-route-node"><i></i><b>${stage === "reading" ? "Understanding" : "You want"}</b><small>${esc(text.length > 42 ? `${text.slice(0, 41)}…` : text)}</small></span>
      <span class="ask-route-line"></span>
      <span class="ask-route-node"><i></i><b>${esc(middle)}</b><small>${stage === "reading" ? "finding the right path" : "selected from your map"}</small></span>
      <span class="ask-route-line"></span>
      <span class="ask-route-node"><i></i><b>${stage === "reading" ? "Building a set" : "Ready"}</b><small>${esc(end)}</small></span>
    </div>`;
  }

  /** What the parse actually decided, in words. A box that silently reinterprets
   *  what you typed is worse than a set of filters; showing the reading is what
   *  makes it correctable. */
  function readBack(d) {
    const p = d.parsed;
    const bits = [];
    if (p.skills?.length) {
      const labels = new Map((window.MathGen?.SKILLS ?? []).map((s) => [s.id, s.name]));
      bits.push(p.skills.map((s) => esc(labels.get(s.id) ?? s.id)).join(", "));
    }
    if ((p.tags ?? []).length) bits.push(p.tags.map((t) => esc(t.name)).join(", "));
    if ((p.domains ?? []).length && !(p.tags ?? []).length) bits.push(esc(p.domains[0].name));
    if ((p.needs_weakness ?? 0) > 0.5) bits.push("your weakest concepts");
    bits.push(["easier", "at your level", "harder", "contest pace"][p.difficulty_level] ?? "");
    if (p.kind !== "either") bits.push(esc(p.kind));
    bits.push(`${p.count} problems`);
    return bits.filter(Boolean).join(" · ");
  }

  async function ask(text) {
    if (asking || !text.trim()) return;
    asking = true;
    askPreview("reading", text);
    askStatus("Reading that…");
    try {
      const r = await fetch("/api/practice-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!r.ok) {
        // 503 is the honest case: no key, so the box cannot work at all.
        askStatus(esc(d.error ?? "That did not work."), "bad");
        return;
      }
      if (!d.understood) {
        askPreview("hide");
        askStatus("That did not read as a practice request — try naming a topic, "
          + "a difficulty, or how long you have.", "bad");
        return;
      }
      if (d.empty) {
        askPreview("hide");
        askStatus(`Nothing in the corpus is tagged for that yet. `
          + `${d.tagged_corpus.toLocaleString()} exercises are tagged so far.`, "bad");
        return;
      }
      askPreview("ready", text, d.parsed);
      askStatus(`${esc(readBack(d))} — starting…`, "ok");
      // Give the route one quiet beat to be perceived; this is intentionally
      // short enough that it never feels like a loading screen.
      await new Promise((resolve) => setTimeout(resolve, 520));
      askPreview("hide");
      location.hash = `#study|${d.spec}`;
    } catch (err) {
      askPreview("hide");
      askStatus(esc(err.message), "bad");
    } finally {
      asking = false;
    }
  }

  document.addEventListener("submit", (ev) => {
    if (ev.target.id !== "askForm") return;
    ev.preventDefault();
    ask(el("askInput").value);
  });

  document.addEventListener("click", (ev) => {
    const eg = ev.target.closest("[data-eg]");
    if (!eg) return;
    el("askInput").value = eg.dataset.eg;
    ask(eg.dataset.eg);
  });

  function planPanel() {
    const total = plan.blocks.reduce((a, b) => a + (Number(b.minutes) || 0), 0);
    return `
      <div class="panel-heading">
        <div><p class="eyebrow">Today</p><h2>${editing ? "Curate the sets" : "Your sets"}</h2></div>
        <div class="plan-actions">
          <span class="data-count">${plan.blocks.length} block${
            plan.blocks.length === 1 ? "" : "s"} · ${total} min</span>
          <button id="editPlan" class="ghost-btn">${editing ? "Done" : "Edit"}</button>
          ${editing ? `<button id="addBlock" class="ghost-btn">Add block</button>
            <button id="resetPlan" class="ghost-btn">Reset</button>` : ""}
        </div>
      </div>
      <p class="panel-note">Each block is an exact set — a kind, its sources and a
        count. Start runs that set and nothing else, and stops when the count is
        met.</p>
      ${nextSetPanel(nextset)}
      ${challengePanel(challenge)}
      <ol class="plan">${plan.blocks.map((b, i) => `
        <li>
          <span class="plan-dur">${b.minutes}<small>min</small></span>
          <span class="plan-body">
            <b>${esc(b.title)}</b>
            <span class="dim">${esc(blockScope(b))}</span>
            ${b.body && !editing ? `<span class="dim">${esc(b.body)}</span>` : ""}
            ${editing ? blockEditor(b, i) : ""}
          </span>
          <a class="ghost-btn" href="${blockHash(b)}">Start</a>
        </li>`).join("") || `<li class="dim">No blocks. Add one, or reset to the
          recommendation.</li>`}</ol>`;
  }

  /** The choices an editor offers: fields and books from the server, drill
   *  skills from the generator bundle the study view uses. */
  async function loadPickSets(ability) {
    const books = await get("/books").catch(() => []);
    sets.domains = (ability.domains ?? []).filter((d) => d.pool)
      .map((d) => ({ id: d.domain, label: d.domain, hint: `${d.pool} problems` }));
    sets.books = books.filter((b) => b.exercises > 0)
      .sort((a, b) => b.exercises - a.exercises)
      .map((b) => ({ id: b.id, label: b.title.length > 26 ? `${b.title.slice(0, 25)}…` : b.title,
                     hint: `${b.authors || b.id} — ${b.exercises} problems` }));
    sets.skills = (window.MathGen?.SKILLS ?? [])
      .map((sk) => ({ id: sk.id, label: sk.name, hint: sk.blurb ?? sk.domain }));
  }

  function paintPlan() { el("homePlan").innerHTML = planPanel(); }

  // ---- plan editing --------------------------------------------------------

  document.addEventListener("click", (ev) => {
    if (!ev.target.closest("#homePlan")) return;
    const t = ev.target;

    if (t.closest("#editPlan")) { editing = !editing; return paintPlan(); }
    if (t.closest("#addBlock")) {
      plan.blocks.push({ id: `block-${Date.now()}`, kind: "study", title: "New set",
                         body: "", minutes: 15, count: 5, domains: [], books: [], skills: [] });
      savePlan();
      return paintPlan();
    }
    if (t.closest("#resetPlan")) {
      plan = { blocks: recommended.blocks.map(toEditable) };
      savePlan();
      return paintPlan();
    }

    const chip = t.closest(".chip-toggle[data-block]");
    if (chip) {
      const b = plan.blocks[Number(chip.dataset.block)];
      const key = chip.dataset.key;
      const set = new Set(b[key]);
      set.has(chip.dataset.id) ? set.delete(chip.dataset.id) : set.add(chip.dataset.id);
      b[key] = sets[key].map((x) => x.id).filter((x) => set.has(x));
      savePlan();
      return paintPlan();
    }
    const clear = t.closest("[data-clear]");
    if (clear) {
      const b = plan.blocks[Number(clear.dataset.block)];
      const key = clear.dataset.clear;
      b[key] = b[key].length ? [] : sets[key].map((x) => x.id);
      savePlan();
      return paintPlan();
    }
    const move = t.closest("[data-move]");
    if (move) {
      const i = Number(move.dataset.move), j = i + Number(move.dataset.dir);
      if (j < 0 || j >= plan.blocks.length) return;
      [plan.blocks[i], plan.blocks[j]] = [plan.blocks[j], plan.blocks[i]];
      savePlan();
      return paintPlan();
    }
    const rm = t.closest("[data-remove]");
    if (rm) {
      plan.blocks.splice(Number(rm.dataset.remove), 1);
      savePlan();
      return paintPlan();
    }
  });

  // Text and number fields edit in place; only a kind change repaints, because
  // it changes which pickers the block needs.
  document.addEventListener("input", (ev) => {
    const f = ev.target.closest("#homePlan [data-set]");
    if (!f) return;
    const b = plan.blocks[Number(f.dataset.block)];
    const key = f.dataset.set;
    b[key] = key === "minutes" || key === "count" ? Number(f.value) || 0 : f.value;
    savePlan();
  });

  document.addEventListener("change", (ev) => {
    const f = ev.target.closest("#homePlan select[data-set]");
    if (!f) return;
    plan.blocks[Number(f.dataset.block)].kind = f.value;
    savePlan();
    paintPlan();
  });

  async function render() {
    const [stats, subjects, weak, mastery, rec, ability, activity, progress, ch, ns] =
      await Promise.all([
        get("/stats"), get("/subjects"), get("/weak-edges"), get("/mastery"),
        get("/plan?minutes=45"),
        get("/ability").catch(() => ({ domains: [] })),
        get("/activity?days=126").catch(() => []),
        get("/progress?limit=8").catch(() => ({ frontier: [] })),
        get("/challenge?peek=1").catch(() => null),
        get("/next-set?minutes=25").catch(() => null),
      ]);
    challenge = ch;
    nextset = ns;
    lastStats = stats;
    const total = subjects.reduce((a, s2) => a + s2.exercises, 0);
    const assessed = subjects.reduce((a, s2) => a + s2.assessed, 0);
    const concepts = subjects.reduce((a, s2) => a + s2.concepts, 0);
    const rate = stats.attempts ? Math.round((stats.solved / stats.attempts) * 100) : null;

    // Every figure carries its denominator: "94% mastery" over three assessed
    // concepts is not a number anyone should act on.
    el("homeStats").innerHTML = [
      ["Day streak", stats.streak, stats.streak === 1 ? "day" : "days running", "amber"],
      ["Solved", stats.solved, rate === null ? "no attempts yet" : `${rate}% of ${stats.attempts}`, "accent"],
      ["Due now", stats.due, "scheduled reviews", ""],
      ["Assessed", assessed, `of ${concepts.toLocaleString()} concepts`, ""],
      ["Problems", total.toLocaleString(), `across ${subjects.length} fields`, ""],
    ].map(([k, v, foot, tone]) => `
      <div class="stat-tile ${tone}"><b>${v}</b><span>${k}</span>
        <span class="stat-foot">${esc(foot)}</span></div>`).join("");

    paintHero();
    recommended = rec;
    await loadPickSets(ability);
    // A plan you have edited is yours; only a first visit takes the recommendation.
    plan = loadPlan() ?? { blocks: rec.blocks.map(toEditable) };
    paintPlan();
    el("homeFrontier").innerHTML = frontierPanel(progress.frontier ?? []);
    el("homeActivity").innerHTML = activityPanel(activity, stats);
    el("homeLevels").innerHTML = levelsPanel(ability);

    el("homeWeak").innerHTML = `
      <div class="panel-heading"><div><p class="eyebrow">Diagnosis</p>
        <h2>Fix these first</h2></div></div>
      ${weak.length ? `<ul class="gaps">${weak.slice(0, 4).map((w) => `
        <li><span class="weak-tag ${w.status}">${w.status}</span>
          <a href="#explore|${encodeURIComponent(w.src)}">${esc(w.src_label)}</a>
          → ${esc(w.dst_label)}</li>`).join("")}</ul>`
        : `<p class="dim">Gaps appear once a concept and its prerequisite are both weak.</p>`}
      ${mastery.length ? `<h3 class="sub">Weakest concepts</h3>
        <ol class="ranked">${mastery.slice(0, 5).map((m) => `
          <li><a href="#explore|${encodeURIComponent(m.concept_id)}">${esc(m.label)}</a>
            <span class="dim">${pct(m.mastery)}</span></li>`).join("")}</ol>` : ""}`;

    el("subjectMap").innerHTML = subjects.map((sub) => `
      <a class="subject-card" href="#subject|${encodeURIComponent(sub.domain)}">
        <span class="subject-name">${esc(sub.domain)}</span>
        <span class="subject-count">${sub.exercises.toLocaleString()} problems ·
          ${sub.concepts} topic${sub.concepts === 1 ? "" : "s"} ·
          ${sub.books.length} source${sub.books.length === 1 ? "" : "s"}</span>
        <span class="subject-bar">
          <span class="subject-fill" style="width:${
            Math.max(2, Math.round((sub.coverage ?? 0) * 100))}%"></span>
        </span>
        <span class="subject-foot">
          ${sub.attempts
            ? `rating ${sub.rating}`
            : `<span class="dim">not started</span>`}
          <span class="dim">${sub.assessed}/${sub.concepts} assessed</span>
        </span>
      </a>`).join("");

    // Concept and section labels are lifted straight from the books, and plenty
    // of them carry TeX.
    window.Lattice.typeset(document.getElementById("v-home"));
  }

  window.Lattice.register("home", () => render().catch((err) => {
    el("homeStats").innerHTML = `<p class="dim">Home needs the server API
      (${esc(err.message)}). Start it with <code>npm start</code>.</p>`;
  }));
})();
