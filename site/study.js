// Study: one problem at a time, chosen at the edge of what you can do.
//
// Browsing, drilling and testing were three tabs doing one thing badly split up.
// This is the single loop: the server ranks every problem by how close it sits to
// your 85% point in that field (Elo per domain, target 301 points below your
// rating), and this hands them to you one at a time.
//
// Generated drills are auto-graded. Textbook and contest problems are self-graded,
// because no string comparison can mark a proof — claiming otherwise would feed
// the ability estimate noise and it would drift for good.
(() => {
  const root = () => document.getElementById("studyRoot");
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TIER = { W1: "warm-up", W2: "bridge", core: "core" };
  const CONTEST_BOOKS = ["putnam"];

  // ---- statement formatting -------------------------------------------------
  // Book text arrives hard-wrapped at the column the extractor found it at, so
  // rendering it pre-wrapped gives a ragged right edge that has nothing to do
  // with the sentence. Reflow into paragraphs and lists instead, and leave the
  // TeX alone for MathJax to pick up.
  function formatStatement(text) {
    if (!text) return "";
    const clean = String(text)
      .replace(/~(?=\$)|(?<=\$)~/g, " ")   // TeX ties, meaningless outside TeX
      .replace(/[ \t]+$/gm, "")
      .trim();
    // Blocks are separated by blank lines; a run of blocks that each open with a
    // bullet is one list, however the extractor spaced them out.
    const blocks = clean.split(/\n\s*\n/).map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const bulleted = lines.length && lines.every((l) => /^[-•*]\s/.test(l));
      return { lines, bullet: /^[-•*]\s/.test(lines[0] ?? ""), bulleted };
    }).filter((b) => b.lines.length);

    const out = [];
    let list = null;
    for (const b of blocks) {
      if (b.bullet || b.bulleted) {
        list ??= [];
        if (b.bulleted) list.push(...b.lines.map((l) => l.replace(/^[-•*]\s+/, "")));
        else list.push(b.lines.join(" ").replace(/^[-•*]\s+/, ""));
        continue;
      }
      if (list) { out.push(renderList(list)); list = null; }
      out.push(`<p>${mathifyPlain(esc(b.lines.join(" ")))}</p>`);
    }
    if (list) out.push(renderList(list));
    return out.join("");
  }

  // Generated drills are short expressions, not prose. Give MathJax an
  // explicit inline-math boundary so powers, fractions, and symbols render as
  // mathematics instead of looking like a tiny text sentence.
  function formatDrillPrompt(text, domain = "arithmetic") {
    const raw = String(text ?? "").trim();
    if (domain === "machine learning") {
      return `<div class="drill-prompt-copy">${esc(raw)}</div>`;
    }
    const tex = raw.replace(/(\d|\))\^(-?\d+)/g, "$1^{$2}");
    return `<div class="drill-math" aria-label="${esc(raw)}">\\(${esc(tex)}\\)</div>`;
  }

  // A lot of OCR and older dataset exports contain useful mathematics without
  // delimiters: `x^2`, `F_5`, or `3^n`. MathJax cannot infer those boundaries.
  // Add only conservative inline boundaries around unmistakable powers, while
  // leaving existing TeX untouched. This is a presentation repair, not a
  // mathematical rewrite; uncertain OCR remains visible as source text.
  function mathifyPlain(html) {
    const parts = html.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g);
    return parts.map((part, i) => {
      if (i % 2) return part;
      return part.replace(/(^|[^\w\\])((?:\d+|[A-Za-z])\s*(?:\^|_)\s*(?:\d+|\{[^}]+\}))(?![\w])/g,
        (_, before, expr) => `${before}\\(${expr}\\)`);
    }).join("");
  }

  function gradeFeedbackHTML(verdict, fallback = null) {
    const g = verdict?.feedback;
    if (!g && fallback) return `<p>${esc(fallback)}</p>`;
    if (!g) return "";
    return `<div class="feedback-head">${esc(verdict.band_label ?? "Review")}</div>
      <p class="feedback-summary">${esc(g.summary ?? "")}</p>
      ${g.strength ? `<p class="feedback-line"><b>What is working</b> ${esc(g.strength.replace(/^What is working:\s*/, ""))}</p>` : ""}
      ${g.next ? `<p class="feedback-line"><b>Next step</b> ${esc(g.next.replace(/^Next step:\s*/, ""))}</p>` : ""}
      ${verdict.gap ? `<p class="feedback-gap"><span>Focus:</span> ${esc(verdict.gap)}</p>` : ""}`;
  }

  const renderList = (items) =>
    `<ol class="statement-list">${items.map((i) => `<li>${mathifyPlain(esc(i))}</li>`).join("")}</ol>`;

  // ---- where a problem actually lives --------------------------------------
  // A citation that cannot be followed is decoration. Every problem carries the
  // full path down to it — field, book, chapter, section, exercise and page —
  // which is shown as a breadcrumb, copied as one line, and pointed at the book
  // itself wherever a canonical edition exists.
  let BOOKS = new Map();

  async function loadBooks() {
    if (BOOKS.size) return;
    const books = await get("/books").catch(() => []);
    BOOKS = new Map(books.map((b) => [b.id, {
      ...b,
      chapterTitles: new Map((b.chapters ?? []).map((c) => [c.chapter, c.title])),
    }]));
  }

  /** The breadcrumb, coarsest first. Missing links are dropped, not faked. */
  function sourceCrumbs(p) {
    const book = BOOKS.get(p.book_id);
    const crumbs = [];
    if (p.domain) crumbs.push({ text: p.domain, cls: "crumb" });
    crumbs.push({ text: book?.title ?? p.book_id, cls: "crumb crumb-book",
                  href: pdfHref(book, p) ?? book?.url,
                  title: book?.authors || undefined });
    const chapter = book?.chapterTitles.get(p.chapter);
    if (chapter) crumbs.push({ text: chapter, cls: "crumb" });
    else if (p.chapter) crumbs.push({ text: `Chapter ${p.chapter}`, cls: "crumb" });
    if (p.section_title && p.section_title !== chapter) {
      crumbs.push({ text: p.section_title, cls: "crumb" });
    }
    const last = [p.label ? `Exercise ${p.label}` : null, p.page ? `p. ${p.page}` : null]
      .filter(Boolean).join(", ");
    if (last) crumbs.push({ text: last, cls: "crumb crumb-last" });
    return crumbs;
  }

  /** The same path as one line of plain text, for the clipboard. */
  const pathText = (p) => {
    const book = BOOKS.get(p.book_id);
    const line = sourceCrumbs(p).map((c) => c.text).join(" > ");
    return book?.authors ? line.replace(book.title, `${book.title} (${book.authors})`) : line;
  };

  /** The page a PDF viewer must open to land on the printed page we cite. */
  const pdfHref = (book, p) => (book?.local_url && p.page
    ? `${book.local_url}#page=${p.page + (book.page_offset ?? 0)}`
    : book?.local_url ?? null);

  function sourcePathHTML(p) {
    const book = BOOKS.get(p.book_id);
    const local = pdfHref(book, p);
    const crumbs = sourceCrumbs(p).map((c) => c.href
      ? `<a class="${c.cls}" href="${esc(c.href)}" target="_blank" rel="noopener"${
          c.title ? ` title="${esc(c.title)}"` : ""}>${esc(c.text)}</a>`
      : `<span class="${c.cls}">${esc(c.text)}</span>`).join('<span class="sep">/</span>');
    return `
      <div class="source-path">
        <span class="source-crumbs">${crumbs}</span>
        <span class="source-tools">
          <button type="button" class="ghost-btn" data-act="copypath">Copy path</button>
          ${local ? `<a class="ghost-btn btn-local" href="${esc(local)}"
             target="_blank" rel="noopener"
             title="The copy on this machine, opened at p.${esc(p.page ?? "")}"
             >Open p.${esc(p.page ?? "?")}</a>` : ""}
          ${book?.url ? `<a class="ghost-btn book-out" href="${esc(book.url)}"
             target="_blank" rel="noopener">${
               book.link_kind === "official" ? "Publisher" : "Catalogue"}</a>` : ""}
        </span>
      </div>`;
  }

  let queue = [];
  let current = null;
  // A set is a fresh draw, not a playlist. Keep a per-session salt so the
  // same set can be reopened without replaying its previous order or drill
  // seeds.
  let sessionSalt = Math.floor(Math.random() * 0x7fffffff);
  const reshuffle = () => { sessionSalt = Math.floor(Math.random() * 0x7fffffff); };
  const shuffle = (items) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  // A curated set: exactly what a plan block (or the set builder) asked for.
  // While one is active it overrides the sidebar entirely — the point of a set
  // is that it is the set, not a hint to the recommender.
  let spec = null;
  const served = new Set();   // ids handed out this session, never repeated
  let ability = [];
  let startedAt = 0;
  let session = { seen: 0, solved: 0 };
  // Test mode is the same queue with a fixed length and a score at the end.
  let test = null;   // { length, index, results }
  // A running assessment. Its attempts are logged with a context the level
  // ladder recognises, which is the only way a concept reaches `mastered` —
  // so this must never be set from anything but a real assessment set.
  let assessment = null;   // { kind, book, chapter, before: Map, meta }
  // An `items` set opens with the problems it names, then carries on as
  // ordinary practice in their field. This records that the opening is done.
  let itemsServed = false;

  // Adaptive difficulty: a weighted up-down staircase over the Elo target.
  //
  // A correct answer nudges the queue harder by a little; a wrong one drops it
  // by a lot. That asymmetry is the whole trick — a 1-up/1-down rule settles at
  // step_down / (step_up + step_down) success, so 40 up against 220 down
  // converges on ~85%, which is the same point the fixed "On target" setting
  // aims at. The difference is that this one finds it from your answers instead
  // of from your rating, so it tracks a good day or a bad one within a session.
  const ADAPT_UP = 40, ADAPT_DOWN = -220, ADAPT_MIN = -300, ADAPT_MAX = 500;
  let adaptiveShift = 0;
  const adaptiveHistory = [];   // one entry per answer, for the end-of-test chart

  const get = (p) => fetch(`/api${p}`).then((r) => (r.ok ? r.json()
    : Promise.reject(new Error(`${p} → ${r.status}`))));
  const post = (p, body) => fetch(`/api${p}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});

  // ---- what to practise ----------------------------------------------------
  // Three independent multi-selects, remembered across reloads. Fields filter
  // the pool; books and drill skills *are* the pool, so clearing a group removes
  // that content rather than widening the search.
  const PICK_KEY = "lattice_picks_v2";
  let picks = { domains: [], books: [], skills: [], difficulty: "adaptive" };
  let picksLoaded = false;

  function loadPicks() {
    try { Object.assign(picks, JSON.parse(localStorage.getItem(PICK_KEY)) || {}); }
    catch { /* private mode */ }
    // Migrate the old five-way control. "On target" was the old static default;
    // the new default follows the learner within a session.
    if (!["easier", "adaptive", "harder"].includes(picks.difficulty)) {
      picks.difficulty = "adaptive";
    }
  }
  function savePicks() {
    try { localStorage.setItem(PICK_KEY, JSON.stringify(picks)); } catch { /* */ }
  }

  /** `#study|kind=drill&skills=a,b&count=21&label=Warm+up` */
  function parseSpec(arg) {
    if (!arg) return null;
    const q = new URLSearchParams(arg);
    const list = (k) => (q.get(k) || "").split(",").map((x) => x.trim()).filter(Boolean);
    const kind = q.get("kind");
    if (!kind) return null;
    return { kind, domains: list("domains"), books: list("books"), skills: list("skills"),
             concepts: list("concepts"), items: list("items"),
             // An assessment names its own scope: one book, optionally one unit.
             book: q.get("book") || "", chapter: q.get("chapter"),
             assessKind: ["challenge", "mastery"].includes(q.get("assess"))
               ? q.get("assess") : "unit_test",
             difficulty: q.get("difficulty") || "",
             maxDifficulty: q.get("max_difficulty") || "",
             count: Number(q.get("count")) || 0, label: q.get("label") || "" };
  }

  const chipsOn = (sel) =>
    [...document.querySelectorAll(`${sel} .chip-toggle.on`)].map((b) => b.dataset);

  /** No field chosen means every field — a filter nobody set should not empty
   *  the queue. Books and skills are the opposite: they are the content. */
  const allIds = (key) => pickSets[key].map((x) => x.id);
  const selectedDomains = () => (spec ? spec.domains : picks.domains);
  // Inside a set, an empty list means "everything of this kind" — a warm-up
  // block that names no skills wants all the drills, not none of them.
  const selectedBooks = () => (spec
    ? (spec.kind === "drill" ? [] : (spec.books.length ? spec.books : allIds("books")))
    : picks.books);
  const selectedSkills = () => (spec
    ? (spec.kind === "study" || spec.kind === "review" || spec.kind === "items" ? []
       : (spec.skills.length ? spec.skills : allIds("skills")))
    : picks.skills);

  // ---- queue ---------------------------------------------------------------

  async function refill() {
    // An assessment is not a queue that refills - it is a fixed paper, fetched
    // once, one question per concept. Running out of it ends it.
    if (spec?.kind === "assess") {
      if (assessment) return;                      // already served this paper
      let paper = null;
      if (spec.assessKind === "mastery") {
        // The mastery challenge picks its own scope: it is not about one book.
        paper = await get("/challenge").catch(() => null);
      } else {
        const q = new URLSearchParams({ book: spec.book });
        if (spec.chapter) q.set("chapter", spec.chapter);
        if (spec.assessKind === "challenge") q.set("kind", "challenge");
        paper = await get(`/assessment?${q}`).catch(() => null);
      }
      const items = paper?.items ?? [];
      assessment = {
        kind: paper?.kind ?? "unit_test",
        book: spec.book, chapter: spec.chapter ?? null, meta: paper,
        before: new Map(items.map((i) => [i.concept_id, i.level_before])),
      };
      // A challenge that is not yet unlocked says so rather than serving an
      // empty paper - the gate is part of the design, not an error state.
      if (!items.length && paper?.reason) assessment.blocked = paper.reason;
      queue = shuffle(items.map((p) => ({ kind: "problem", problem: p })));
      test = { length: items.length, index: 0, results: [] };
      return;
    }
    if (spec?.kind === "items" && !itemsServed) {
      itemsServed = true;
      const picked = spec.items.length
        ? await get(`/items?ids=${encodeURIComponent(spec.items.join(","))}`).catch(() => [])
        : [];
      if (picked.length) {
        picked.forEach((p) => served.add(p.id));
        queue = picked.map((p) => ({ kind: "problem", problem: p }));
        return;
      }
    }
    const domains = selectedDomains();
    const books = selectedBooks();
    const skills = selectedSkills();
    const reviewOnly = spec?.kind === "review";
    const params = new URLSearchParams({ limit: "12" });
    if (domains.length) params.set("domains", domains.join(","));
    // The server already filters by book id; the client used to pull everything
    // and throw most of it away, which made a narrow selection return nothing.
    if (books.length) params.set("sources", books.join(","));
    // Nothing already handed out this session comes back — the server samples
    // its band, but only this side knows what you have just been shown.
    if (served.size) params.set("exclude", [...served].slice(-60).join(","));
    // One topic, when the set came from a subject page or the graph.
    if (spec?.concepts?.length) params.set("concepts", spec.concepts.join(","));
    // An absolute ceiling on the difficulty rubric, when the request asked for
    // easy material rather than merely easier-than-me.
    if (spec?.maxDifficulty) params.set("max_difficulty", spec.maxDifficulty);
    // Where to aim. A set can carry its own difficulty; otherwise the sidebar's.
    // A test overrides both — it was configured before it started.
    const diff = test?.difficulty || spec?.difficulty || picks.difficulty || "adaptive";
    if (diff === "adaptive") params.set("shift", String(Math.round(adaptiveShift)));
    else params.set("difficulty", diff);

    // A topic request may be phrased as "review quotient groups" even when
    // nothing is due yet. Due-only review is useful, but it must not turn a
    // valid new-topic set into an empty screen.
    const chosen = books.length ? await get(`/next?${params}`).catch(() => []) : [];
    queue = shuffle(chosen.map((p) => ({ kind: "problem", problem: p })));

    // Spaced repetition earns its keep only if the reviews actually surface. Due
    // items go to the front: a scheduled review is worth more than a new problem.
    const due = books.length ? await get("/due?n=6").catch(() => []) : [];
    const dueProblems = [];
    for (const d of due) {
      if (d.item_type === "drill") continue;          // regenerated below, not stored
      const full = await get(`/exercises?limit=1&concept=${
        encodeURIComponent(d.concept_id ?? "")}`).catch(() => null);
      const match = full?.items?.find((x) => x.id === d.item_id);
      if (match) dueProblems.push({ kind: "problem", problem: match, due: true });
    }
    // Reviews lead, but they do not *stack*: opening the app to six scheduled
    // reviews in a row is a chore, and it made the first card feel fixed even
    // once the scheduler stopped returning them in a fixed order. One review
    // first, the rest folded in every third slot.
    if (reviewOnly) {
      queue = shuffle([...dueProblems, ...chosen.map((p) => ({ kind: "problem", problem: p }))]);
    } else if (dueProblems.length) {
      const [lead, ...rest] = dueProblems;
      queue = [lead, ...shuffle(queue)];
      rest.forEach((d, i) => queue.splice(Math.min(queue.length, 3 * (i + 1)), 0, d));
    }

    // Generated drills are interleaved rather than appended: a run of ten proofs
    // with the arithmetic all at the end is not what "mixed practice" means.
    if (skills.length && window.MathGen) {
      const mm = ability.find((a) => a.domain === "mental math");
      let levels = {};
      try { levels = JSON.parse(localStorage.getItem("lattice_practice_v1")) || {}; } catch { /* */ }
      // Least-practised skill first, so a drill selection is worked evenly.
      // Least-practised first, but jittered: a strict order over a stable set of
      // skills served the same handful of drills every single refill.
      const pool = MathGen.SKILLS.filter((sk) => skills.includes(sk.id))
        .map((sk) => ({ sk, k: (levels[sk.id]?.attempts ?? 0) + Math.random() * 3 }))
        .sort((a, b) => a.k - b.k).map((x) => x.sk);
      const remaining = spec?.count ? Math.max(1, spec.count - session.seen) : 8;
      const want = queue.length ? Math.max(2, Math.ceil(queue.length / 3)) : Math.min(8, remaining);
      // `pool` contains skill types, not questions. A single selected skill
      // still needs to produce a full set, so cycle through it and vary the
      // seed for every item rather than slicing it down to one problem.
      const drillSkills = pool.length
        ? Array.from({ length: want }, (_, i) => pool[i % pool.length]) : [];
      const drills = pool.length ? drillSkills.map((sk, i) => ({
        kind: "drill",
        problem: MathGen.generate(sk.id,
          levels[sk.id]?.level ?? (mm && mm.rating > 1400 ? 3 : 1),
          (sessionSalt + i * 2654435761 + sk.id.length) >>> 0),
      })) : [];
      const mixed = [];
      while (queue.length || drills.length) {
        if (queue.length) mixed.push(queue.shift());
        if (queue.length) mixed.push(queue.shift());
        if (drills.length) mixed.push(drills.shift());
      }
      queue = shuffle(mixed);
    }
    renderQueuePreview();
  }

  function renderQueuePreview() {
    // The queue preview is optional chrome; the sidebar does not always carry it.
    const box = el("queuePreview");
    if (!box) return;
    box.innerHTML = queue.slice(0, 6).map((q) => {
      const label = q.kind === "drill" ? q.problem.skillName
        : (q.problem.section_title || q.problem.label || q.problem.cite);
      const meta = q.kind === "drill" ? `L${q.problem.level}`
        : `${Math.round((q.problem.predicted_success ?? 0) * 100)}%`;
      return `<li><span>${esc(String(label).slice(0, 34))}</span><b>${esc(meta)}</b></li>`;
    }).join("") || `<li class="dim">nothing queued</li>`;
  }

  async function renderAbility() {
    ability = (await get("/ability").catch(() => ({ domains: [] }))).domains ?? [];
    const shown = ability.filter((a) => a.attempts > 0 || a.pool > 100).slice(0, 6);
    el("abilityBox").innerHTML = shown.map((a) => `
      <div class="ability-row" title="${a.attempts} attempts">
        <span>${esc(a.domain)}</span>
        <b class="${a.confident ? "" : "unsure"}">${a.rating}</b>
      </div>`).join("") || `<p class="dim">no attempts yet</p>`;

  }

  // ---- the three pickers ---------------------------------------------------

  /** Paint one group. `key` names the slice of `picks` it edits. */
  function paintChips(boxId, key, items) {
    const box = el(boxId);
    if (!box) return;
    const chosen = new Set(picks[key]);
    box.innerHTML = items.map((it) => `
      <button type="button" class="chip-toggle${chosen.has(it.id) ? " on" : ""}"
        data-pick="${esc(key)}" data-id="${esc(it.id)}"
        title="${esc(it.hint ?? "")}">${esc(it.label)}</button>`).join("")
      || `<span class="dim">none available</span>`;
    const count = el(boxId.replace("Chips", "Count"));
    if (count) {
      count.textContent = `${picks[key].length}/${items.length}`;
      // A group with nothing selected is silently supplying no problems; say so.
      count.classList.toggle("empty", key !== "domains" && picks[key].length === 0);
    }
  }

  let pickSets = { domains: [], books: [], skills: [] };

  async function renderPickers() {
    await loadBooks();
    pickSets.domains = ability.filter((a) => a.pool > 0)
      .map((a) => ({ id: a.domain, label: a.domain, hint: `${a.pool} problems` }));
    const books = [...BOOKS.values()].filter((b) => b.exercises > 0)
      .sort((a, b) => b.exercises - a.exercises);
    // Two of these really are both called "Introduction to Probability", so a
    // clashing title gets its first author's surname to tell them apart.
    const titleCount = new Map();
    for (const b of books) titleCount.set(b.title, (titleCount.get(b.title) ?? 0) + 1);
    const surname = (a) => (a ?? "").split(";")[0].trim().split(/\s+/).pop() || "";
    pickSets.books = books.map((b) => {
      const tag = titleCount.get(b.title) > 1 ? surname(b.authors) : "";
      // Truncate the title, never the surname — the surname is the only part
      // that tells two identically titled books apart.
      const room = tag ? 20 : 26;
      const short = b.title.length > room ? `${b.title.slice(0, room - 1)}…` : b.title;
      return {
        id: b.id,
        label: tag ? `${short} (${tag})` : short,
        hint: `${b.authors || b.id} — ${b.exercises} problems`,
      };
    });
    pickSets.skills = (window.MathGen?.SKILLS ?? [])
      .map((sk) => ({ id: sk.id, label: sk.name, hint: sk.blurb ?? sk.domain }));

    // First run: everything on. Otherwise drop ids that no longer exist, so a
    // removed book cannot leave the queue permanently filtered to nothing.
    for (const key of ["domains", "books", "skills"]) {
      const valid = new Set(pickSets[key].map((x) => x.id));
      if (!picksLoaded) picks[key] = key === "domains" ? [] : [...valid];
      else picks[key] = picks[key].filter((id) => valid.has(id));
    }
    picksLoaded = true;
    savePicks();
    for (const key of ["domains", "books", "skills"]) {
      paintChips(`${key === "domains" ? "domain" : key === "books" ? "book" : "skill"}Chips`,
                 key, pickSets[key]);
    }
  }

  // ---- one problem ---------------------------------------------------------

  async function next() {
    if (test && test.index >= test.length) return renderTestResults();
    if (spec?.count && session.seen >= spec.count) return renderSetComplete();
    if (!queue.length) await refill();
    answerSubmitted = false;
    current = queue.shift();
    renderQueuePreview();
    if (!current) {
      if (assessment?.blocked) {
        root().innerHTML = `${setBar()}<section class="card">
          <h2 class="result-title">Not unlocked yet</h2>
          <p class="dim">A mastery challenge needs ${esc(assessment.blocked)}.</p>
          <div class="card-actions"><a class="btn-primary" href="#home">Back to today</a>
            <button class="ghost-btn" data-act="practice">Free practice</button></div>
        </section>`;
        return;
      }
      root().innerHTML = `${setBar()}<section class="card"><p class="dim">${spec
        ? `Nothing left in this set${spec.kind === "review"
            ? " — nothing is due right now." : "."}`
        : "Nothing matches those sources. Turn one back on in the sidebar."}</p></section>`;
      return;
    }
    startedAt = performance.now();
    if (current.kind === "problem") {
      served.add(current.problem.id);
      // Seeing a problem is evidence too: the recommender uses it to stop
      // offering the same one over and over.
      post("/view", { item_id: current.problem.id });
    }
    current.kind === "drill" ? renderDrill() : renderProblem();
  }

  function paintSession() {
    const solved = el("sessSolved"), seen = el("sessSeen");
    if (solved) solved.textContent = session.solved;
    if (seen) seen.textContent = session.seen;
    const goal = test?.length || spec?.count || 0;
    const progress = goal ? Math.min(100, (session.seen / goal) * 100) : 0;
    const track = el("sideProgressTrack");
    if (track) track.style.width = `${progress}%`;
    const meta = el("sideProgressMeta");
    if (meta) meta.textContent = goal ? `${session.seen} of ${goal}` : "open practice";
  }

  function paintSetChrome() {
    const button = el("generateBtn");
    if (button) button.textContent = spec ? "Next question" : "New question";
  }

  function setBar() {
    if (assessment) {
      const t = assessment.kind === "challenge" ? "Course challenge"
        : assessment.kind === "mastery_challenge" ? "Mastery challenge" : "Unit test";
      const m = assessment.meta ?? {};
      return `<div class="set-bar set-bar-test">
        <span class="chip chip-test">assessment</span>
        <b>${esc(m.chapter_title ? `${t} — ${m.chapter_title}` : `${t} — ${m.book_title ?? ""}`)}</b>
        <span class="dim">${assessment.kind === "mastery_challenge"
          ? "mixed topics, interleaved · a clean answer here is the only way to reach mastered"
          : "one question per topic · a clean answer here is the only way to reach mastered"}
          · hints forfeit that</span>
        <a class="ghost-btn" href="${assessment.book
          ? `#course|${encodeURIComponent(assessment.book)}` : "#home"}">Leave</a>
      </div>`;
    }
    if (!spec) return "";
    const goal = spec.count;
    const pctDone = goal ? Math.min(100, (session.seen / goal) * 100) : 0;
    return `<div class="set-bar">
      <span class="chip chip-set">set</span>
      <b>${esc(spec.label || spec.kind)}</b>
      ${goal ? `<span class="test-track"><span style="width:${pctDone}%"></span></span>
        <span>${session.seen} of ${goal}</span>` : ""}
      <a class="ghost-btn" href="#study">Leave set</a>
    </div>`;
  }

  function renderSetComplete() {
    root().innerHTML = `${setBar()}
      <section class="card">
        <h2 class="result-title">Set complete</h2>
        <p class="dim">${session.solved} of ${session.seen} solved in
          <b>${esc(spec.label || spec.kind)}</b>.</p>
        <div class="card-actions">
          <button class="btn-primary" data-act="againset">Run it again</button>
          <a class="ghost-btn" href="#home">Back to today</a>
          <a class="ghost-btn" href="#study">Free practice</a>
        </div>
      </section>`;
  }

  function sessionBar() {
    if (test) {
      const pctDone = (test.index / test.length) * 100;
      return `<div class="session-bar">
        <span><b>${test.index + 1}</b> of ${test.length}</span>
        <span class="test-track"><span style="width:${pctDone}%"></span></span>
        <button class="ghost-btn" data-act="endtest">End test</button>
      </div>`;
    }
    const move = lastMove ? (() => {
      const d = lastMove.to - lastMove.from;
      return `<span class="rating-move ${d > 0 ? "up" : "down"}"
        title="Your rating in ${esc(lastMove.domain)} after that answer">
        ${esc(lastMove.domain)} <b>${lastMove.to}</b>
        <i>${d > 0 ? "▲" : "▼"}${Math.abs(d)}</i></span>`;
    })() : "";
    return setBar();
  }

  async function renderTestResults() {
    const results = test.results;
    const solved = results.filter((r) => r.outcome === "solved").length;
    const done = results.length;
    const paper = assessment;
    assessment = null;
    test = null;

    // A score is the least interesting thing an assessment produces. What the
    // learner wants to know is which topics moved, and a level only moves when
    // the server says so — so ask it rather than predicting it here.
    let moves = [];
    if (paper) {
      const ids = [...paper.before.keys()];
      const after = await get(`/levels?concepts=${encodeURIComponent(ids.join(","))}`)
        .catch(() => []);
      moves = after.map((a) => ({ ...a, before: paper.before.get(a.concept_id) }))
        .filter((a) => a.before !== a.level);
    }
    const RANK = ["none", "attempted", "familiar", "proficient", "mastered"];

    root().innerHTML = `
      <section class="card">
        <h2 class="result-title">${paper
          ? (paper.kind === "challenge" ? "Course challenge complete" : "Unit test complete")
          : "Test complete"}</h2>
        <div class="stat-row">
          <div class="stat-tile"><b>${done ? Math.round((solved / done) * 100) : 0}%</b>
            <span>Solved</span></div>
          <div class="stat-tile"><b>${solved}/${done}</b><span>Correct</span></div>
          ${paper ? `<div class="stat-tile accent"><b>${moves.filter((mv) =>
            RANK.indexOf(mv.level) > RANK.indexOf(mv.before)).length}</b>
            <span>Levels gained</span></div>` : ""}
        </div>

        ${paper ? (moves.length ? `
          <h3 class="sub">What moved</h3>
          <ul class="level-moves">${moves.map((mv) => {
            const up = RANK.indexOf(mv.level) > RANK.indexOf(mv.before);
            return `<li class="${up ? "up" : "down"}">
              <span class="mark">${up ? "▲" : "▼"}</span>
              <span class="level-move-name">${esc(mv.label)}</span>
              <span class="dim">${esc(mv.before)} → <b>${esc(mv.level_label)}</b></span>
            </li>`;
          }).join("")}</ul>`
          : `<p class="dim">No topic changed level. Reaching mastered needs a clean,
               unaided answer here on a topic already at proficient.</p>`) : ""}

        ${!paper && results.length ? testStats() : ""}

        <h3 class="sub">Answers</h3>
        <ol class="test-review">${test_results_html()}</ol>
        <div class="card-actions">
          ${paper
            ? `<a class="btn-primary" href="${paper.book
                 ? `#course|${encodeURIComponent(paper.book)}` : "#home"}"
                 >${paper.book ? "Back to the course" : "Back to today"}</a>
               <button class="ghost-btn" data-act="practice">Free practice</button>`
            : `<button class="btn-primary" data-act="newtest">New test</button>
               <button class="ghost-btn" data-act="practice">Back to practice</button>`}
        </div>
      </section>`;

    /** What the test actually measured. A percentage on its own says nothing
     *  about what was asked — these say how hard it was and where it went. */
    function testStats() {
      const rated = results.filter((r) => r.rating);
      const avgRating = rated.length
        ? Math.round(rated.reduce((a, r) => a + r.rating, 0) / rated.length) : null;
      const predicted = results.filter((r) => r.predicted !== null);
      const expectedPct = predicted.length
        ? Math.round(100 * predicted.reduce((a, r) => a + r.predicted, 0) / predicted.length)
        : null;
      const actualPct = done ? Math.round((solved / done) * 100) : 0;
      const totalSecs = results.reduce((a, r) => a + (r.seconds || 0), 0);
      const hinted = results.filter((r) => r.hints > 0).length;

      const byDomain = new Map();
      for (const r of results) {
        const d = byDomain.get(r.domain ?? "—") ?? { n: 0, ok: 0 };
        d.n += 1;
        if (r.outcome === "solved") d.ok += 1;
        byDomain.set(r.domain ?? "—", d);
      }

      // The adaptive path: where the staircase took you, in words rather than a
      // chart nobody would read at this size.
      const path = adaptiveHistory.length
        ? `<p class="panel-note">Adaptive path: started on target, finished
             ${adaptiveHistory.at(-1).shift > 40 ? `<b>${adaptiveHistory.at(-1).shift} points harder</b>`
               : adaptiveHistory.at(-1).shift < -40 ? `<b>${-adaptiveHistory.at(-1).shift} points easier</b>`
               : "<b>back on target</b>"}
             — the queue followed your answers.</p>`
        : "";

      return `
        <h3 class="sub">How it went</h3>
        <div class="stat-row">
          ${avgRating !== null ? `<div class="stat-tile"><b>${avgRating}</b>
            <span>Avg difficulty</span><span class="stat-foot">Elo rating asked</span></div>` : ""}
          ${expectedPct !== null ? `<div class="stat-tile ${
            actualPct >= expectedPct ? "accent" : ""}"><b>${actualPct - expectedPct > 0 ? "+" : ""}${
            actualPct - expectedPct}</b><span>vs expected</span>
            <span class="stat-foot">${expectedPct}% predicted</span></div>` : ""}
          <div class="stat-tile"><b>${Math.round(totalSecs / 60)}<small>m</small></b>
            <span>Time</span><span class="stat-foot">${done
              ? Math.round(totalSecs / done) : 0}s per question</span></div>
          ${hinted ? `<div class="stat-tile"><b>${hinted}</b><span>With hints</span>
            <span class="stat-foot">of ${done}</span></div>` : ""}
        </div>
        ${path}
        ${byDomain.size > 1 ? `<ul class="test-domains">${[...byDomain.entries()]
          .sort((a, b) => b[1].n - a[1].n).map(([d, v]) => `
          <li><span class="test-domain-name">${esc(d)}</span>
            <span class="cov-track"><span class="cov-fill"
              style="width:${Math.round((v.ok / v.n) * 100)}%"></span></span>
            <span class="cov-num">${v.ok}/${v.n}</span></li>`).join("")}</ul>` : ""}`;
    }

    function test_results_html() {
      return results.map((r) => `
          <li class="mark-${esc(r.outcome)}">
            <span class="mark">${r.outcome === "solved" ? "✓"
              : r.outcome === "partial" ? "~" : r.outcome === "skipped" ? "·" : "✗"}</span>
            ${esc(r.label)}
            ${r.expected && r.given && r.outcome !== "solved"
              ? `<span class="dim">you said ${esc(r.given)}, answer ${esc(r.expected)}</span>` : ""}
          </li>`).join("");
    }
  }

  function renderDrill() {
    const p = current.problem;
    root().innerHTML = `
      ${sessionBar()}
      <div class="problem-frame">
      <section class="card problem-card">
        <header class="card-head">
          <span class="chip chip-drill">generated</span>
          <span class="chip">${esc(p.skillName)}</span>
          <span class="chip">level ${p.level}</span>
        </header>
        <p class="drill-kicker">Solve this one thing</p>
        <div class="statement statement-drill">${formatDrillPrompt(p.prompt, p.domain)}</div>
        <div class="answer-head drill-answer-head">
          <label class="answer-label" for="drillAnswer">Your answer</label>
          <span class="answer-hint">Exact answer · checked instantly</span>
        </div>
        <form id="drillForm" class="answer-row drill-answer-row" autocomplete="off">
          <input id="drillAnswer" type="text" placeholder="Answer" aria-label="Answer" />
          <button type="submit" class="btn-primary">Submit answer</button>
          <button type="button" class="ghost-btn" data-act="show">Show me</button>
          <button type="button" class="ghost-btn" data-act="skip">Skip</button>
        </form>
        <div id="drillFeedback" class="feedback"></div>
        <div id="drillWork" class="work" hidden></div>
        <p class="drill-shortcuts"><kbd>Enter</kbd> submit · <kbd>G</kbd> next</p>
      </section>
      </div>`;
    paintCurrentContext(p);
    const answer = el("drillAnswer");
    answer.value = "";
    answer.defaultValue = "";
    window.Lattice.typeset(root());
    answer.focus();
  }

  function paintCurrentContext(p) {
    const box = el("currentContext");
    if (!box) return;
    const tags = p.tags?.length ? p.tags.map((t) =>
      `<a class="rail-tag" href="#study|kind=study&count=8&label=${encodeURIComponent(t.name)}&concepts=${encodeURIComponent(p.concept_id ?? "")}">${esc(t.name)}</a>`).join("") : "";
    box.innerHTML = `<p class="field-label">This problem</p>
      <p class="context-title">${esc(p.skillName ?? p.section_title ?? p.label ?? "Current problem")}</p>
      <p class="context-note">${p.auto_gradable || p.skillName ? "Exact answer · checked instantly" : "Write a complete solution with reasoning."}</p>
      ${tags ? `<div class="rail-tags">${tags}</div>` : p.concept_id ? `<a class="context-link" href="#explore|${encodeURIComponent(p.concept_id)}">Open concept map →</a>` : ""}`;
  }


  /** The right rail: what this problem is about, how far through the set you
   *  are, and the keys that move it along.
   *
   *  "Focus areas" is the first thing in Lattice that can say what a problem
   *  actually exercises. It comes from the tag pass, and only tags the pass was
   *  confident about are shown — a 0.4 is a maybe, and a maybe rendered as a
   *  chip reads as a fact. */
  function problemRail(p) {
    const goal = spec?.count || test?.length || 0;
    const done = test ? test.index : session.seen;
    const pctDone = goal ? Math.min(100, (done / goal) * 100) : 0;
    const remaining = goal ? Math.max(0, goal - done) : null;

    return `<aside class="problem-rail">
      <section class="rail-card rail-tools">
        <p class="rail-head">Session tools</p>
        <p class="rail-note">Adjust the difficulty for your next problem.</p>
        <div class="rail-difficulty">${["easier", "adaptive", "harder"].map((d) =>
          `<button type="button" data-diff="${d}" class="rail-diff ${(picks.difficulty || "adaptive") === d ? "active" : ""}">${d[0].toUpperCase() + d.slice(1)}</button>`).join("")}</div>
      </section>

      ${goal ? `<section class="rail-card">
        <p class="rail-head">Session</p>
        <div class="rail-nums">
          <span><b>${session.seen}</b>Complete</span>
          <span><b>${session.solved}</b>Correct</span>
          <span><b>${remaining}</b>Left</span>
        </div>
        <span class="test-track"><span style="width:${pctDone}%"></span></span>
        <p class="rail-note">${esc(DIFF_NOTE[picks.difficulty || "adaptive"]
          ?? DIFF_NOTE.adaptive)}</p>
      </section>` : ""}

      ${p.tags?.length ? `<section class="rail-card">
        <p class="rail-head">This problem</p>
        <p class="rail-note">Concepts you are practising.</p>
        <div class="rail-tags">${p.tags.map((t) => `
          <a class="rail-tag" href="#study|kind=study&count=8&label=${
            encodeURIComponent(t.name)}&concepts=${encodeURIComponent(p.concept_id ?? "")}"
            title="${Math.round(t.p * 100)}% confident">${esc(t.name)}</a>`).join("")}</div>
      </section>` : ""}

      <p class="rail-shortcuts"><kbd>Enter</kbd> submit · <kbd>G</kbd> next · <kbd>H</kbd> hint</p>
    </aside>`;
  }

  async function renderProblem() {
    const p = current.problem;
    await loadBooks();
    const contest = CONTEST_BOOKS.includes(p.book_id);
    root().innerHTML = `
      ${sessionBar()}
      <div class="problem-frame">
      <section class="card">
        <header class="card-head">
          <span class="chip chip-${esc(p.tier)}">${esc(TIER[p.tier] ?? p.tier)}</span>
          ${p.concept_id && p.section_title ? `<a class="chip chip-link"
            href="#explore|${encodeURIComponent(p.concept_id)}"
            title="Open this concept in the graph">${esc(p.section_title)}</a>` : ""}
          ${current.due ? '<span class="chip chip-due">review due</span>' : ""}
          <span class="chip chip-fit" title="predicted chance you solve it">${
            Math.round((p.predicted_success ?? 0) * 100)}% fit</span>
        </header>
        ${sourcePathHTML(p)}
        <div class="statement${p.text ? "" : " missing"}">${p.text
          ? formatStatement(p.text)
          : `<p>Text not available locally — follow the path above to the book.</p>`}</div>
        <div class="answer-head">
          <label class="answer-label" for="freeAnswer">Your answer</label>
          <span class="answer-hint">${p.auto_gradable
            ? "This one has an exact answer — write it in."
            : "Write a complete solution with clear reasoning."}</span>
        </div>
        <textarea id="freeAnswer" class="free-answer${p.auto_gradable ? " answer-compact" : ""}" rows="${p.auto_gradable ? 2 : 8}"
          placeholder="Write your answer, or the key steps of your argument…  $x^2$ renders"></textarea>
        <div id="answerPreview" class="answer-preview" hidden></div>
        <div id="answerFeedback" class="feedback" aria-live="polite"></div>
        <footer class="card-actions">
          <span class="self-label">How did it go?</span>
          <button class="btn-primary" data-grade="solved">Submit answer</button>
          <button class="ghost-btn" data-grade="partial">Partial</button>
          <button class="ghost-btn" data-grade="failed">Failed</button>
          <button class="ghost-btn" data-act="hint">Hint</button>
          <button class="ghost-btn" data-act="solution">Show solution</button>
          <button class="ghost-btn" data-act="skip">Skip</button>
          <button class="ghost-btn" data-act="copy">Copy for review</button>
      <span class="key-note"><kbd>⌘↵</kbd> submit · <kbd>G</kbd> next</span>
        </footer>
        <div id="ladder" class="ladder-slot"></div>
        <div id="whereami" class="where-slot"></div>
        <div id="extras" class="extras"></div>
      </section>
      </div>`;
    window.Lattice.typeset(root());
    paintCurrentContext(p);
    wireAnswerPreview();
    loadLadder(p);
    loadWhereAmI(p);
  }

  /** Render what the learner is typing, so TeX in the answer box is readable
   *  before they commit to it.
   *
   *  This is not an equation editor and is not trying to be one. MathJax is
   *  already loaded for the statements; pointing it at the answer box costs
   *  nothing and covers the case that actually matters — checking that what you
   *  wrote says what you meant. Whether a real editor is worth its weight is a
   *  question the collected answers can settle later. */
  const PREVIEW_DELAY = 400;   // long enough not to typeset mid-word

  function wireAnswerPreview() {
    const box = el("freeAnswer");
    const out = el("answerPreview");
    if (!box || !out) return;
    let timer = null;

    const paint = () => {
      const text = box.value;
      // Nothing to preview until there is maths in it. Plain prose is already
      // legible in the textarea, and echoing it underneath is just noise.
      if (!/\$|\\\(|\\\[|\\frac|\\sum|\\int|\\sqrt|\^|_\{/.test(text)) {
        out.hidden = true;
        out.innerHTML = "";
        return;
      }
      out.hidden = false;
      out.innerHTML = esc(text).replace(/\n/g, "<br>");
      window.Lattice.typeset(out);
    };

    box.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(paint, PREVIEW_DELAY);
    });
  }

  /** Locate the problem in the graph: what stands behind this concept, and what
   *  it opens up. A problem you cannot place is a problem you cannot build on. */
  async function loadWhereAmI(p) {
    const slot = el("whereami");
    if (!slot || !p.concept_id) return;
    const c = await get(`/concept/${encodeURIComponent(p.concept_id)}`).catch(() => null);
    if (!c) return;
    const seq = c.sequence ?? { prev: [], next: [] };
    if (!c.needs.length && !c.unlocks.length && !seq.prev.length && !seq.next.length
        && c.mastery === null) return;

    const pill = (x) => `<a class="node-pill${
      x.mastery === null ? " unseen" : x.mastery >= 0.6 ? " held" : " weak"}"
      href="#explore|${encodeURIComponent(x.concept_id)}"
      title="${x.mastery === null ? "not assessed"
        : `mastery ${Math.round(x.mastery * 100)}%`}">${esc(x.label)}</a>`;

    slot.innerHTML = `
      <details class="whereami"${c.needs.length ? "" : " open"}>
        <summary>
          <span class="where-title">Why this problem?</span>
          <span class="where-now">${esc(c.label)}${c.position
            ? ` <span class="where-pos">${c.position.index} of ${c.position.of}</span>` : ""}${
            c.mastery === null
            ? ` <em>new</em>`
            : ` <b>${Math.round(c.mastery * 100)}%</b> over ${c.attempts} attempt${
                c.attempts === 1 ? "" : "s"}`}</span>
        </summary>
        <div class="where-body">
          ${c.needs.length ? `<div class="where-row">
            <span class="where-label">Builds on</span>
            <span class="where-nodes">${c.needs.map(pill).join("")}</span></div>` : ""}
          ${c.unlocks.length ? `<div class="where-row">
            <span class="where-label">Opens up</span>
            <span class="where-nodes">${c.unlocks.map(pill).join("")}</span></div>` : ""}
          ${seq.prev.length ? `<div class="where-row">
            <span class="where-label">Comes after</span>
            <span class="where-nodes">${seq.prev.map(pill).join("")}</span></div>` : ""}
          ${seq.next.length ? `<div class="where-row">
            <span class="where-label">Leads to</span>
            <span class="where-nodes">${seq.next.map(pill).join("")}</span></div>` : ""}
          <p class="where-key"><i class="dot held"></i>held
            <i class="dot weak"></i>weak <i class="dot unseen"></i>not assessed
            ${c.needs.length ? "" : `<em>— no recorded prerequisites; the order
              shown is the book's own</em>`}</p>
        </div>
      </details>`;
    window.Lattice.typeset(slot);
  }

  /** A hard problem gets its rungs offered underneath it — the founding idea of
   *  the project, and until now built but never surfaced. */
  async function loadLadder(p) {
    const slot = el("ladder");
    if (!slot || (p.predicted_success ?? 1) > 0.5) return;
    const ladder = await get(`/ladder/${encodeURIComponent(p.id)}`).catch(() => null);
    if (!ladder?.rungs?.length) return;
    slot.innerHTML = `
      <details class="ladder">
        <summary>Warm up first — ${ladder.rungs.length} rungs toward
          <em>${esc(ladder.target_concept)}</em></summary>
        <ol class="ladder-rungs">${ladder.rungs.map((r) => `
          <li><span class="chip chip-${esc(r.tier)}">${esc(r.tier)}</span>
            <span class="rung-meta">${esc(r.section)} · ${esc(r.label)}</span>
            <span class="rung-text">${formatStatement(r.text)}</span></li>`).join("")}</ol>
      </details>`;
    window.Lattice.typeset(slot);
  }

  /** Copy, and say so on the button. Falls back to a selectable box when the
   *  clipboard is blocked — over plain http it always is. */
  async function copyToClipboard(text, btn, restore) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        btn.textContent = "Copied";
        btn.classList.add("is-ok");
        setTimeout(() => { btn.textContent = restore; btn.classList.remove("is-ok"); }, 1400);
      }
      return true;
    } catch {
      const box = el("extras");
      if (box) {
        box.innerHTML = `<label class="answer-label">Copy this by hand</label>
          <textarea class="free-answer" rows="8" readonly>${esc(text)}</textarea>`;
        box.querySelector("textarea").select();
      }
      return false;
    }
  }

  // ---- grading -------------------------------------------------------------

  let hintsShown = 0;
  let answerSubmitted = false;

  // The Elo already moves on every attempt; nothing ever showed it. A rating you
  // cannot see going up is not a progression system.
  let lastMove = null;   // { domain, from, to }

  async function record(outcome, given, machineGrade = null) {
    const seconds = Math.round((performance.now() - startedAt) / 1000);
    const movedDomain = current.kind === "drill" ? "mental math" : current.problem.domain;
    const before = ability.find((a) => a.domain === movedDomain)?.rating ?? null;
    session.seen += 1;
    if (outcome === "solved") session.solved += 1;
    paintSession();
    if (test) {
      test.results.push({
        label: current.kind === "drill"
          ? `${current.problem.skillName} — ${current.problem.prompt}`
          : `${current.problem.cite ?? ""} ${current.problem.section_title ?? ""}`.trim(),
        outcome,
        given: given ?? null,
        expected: current.kind === "drill" ? current.problem.answer : null,
        // Kept per answer so the results screen can say what you were actually
        // asked, not just how you did: a 60% on stretch is not a 60% on easier.
        domain: current.kind === "drill" ? "mental math" : current.problem.domain,
        rating: current.problem.rating ?? null,
        predicted: current.problem.predicted_success ?? null,
        seconds, hints: hintsShown,
      });
      test.index += 1;
    }
    if (current.kind === "drill") {
      const p = current.problem;
      await post("/attempt", {
        item_id: `drill:${p.skill}:L${p.level}:${p.seed}`, item_type: "drill",
        concept_id: `skill:${p.skill}`, outcome, seconds, hints_used: hintsShown,
      });
    } else {
      await post("/attempt", {
        item_id: current.problem.id, item_type: "exercise",
        concept_id: current.problem.concept_id, outcome, seconds, hints_used: hintsShown,
        context: assessment ? assessment.kind : "practice",
        // What was actually written. The server keeps it and grades it in the
        // background; nothing on this screen waits for that or changes because
        // of it.
        answer: given ?? null,
        machine_grade: machineGrade,
      });
    }
    // Step the staircase before the next refill asks for its offset. Hints count
    // as a partial success: you got there, but not unaided.
    const diffNow = test?.difficulty || spec?.difficulty || picks.difficulty || "adaptive";
    if (diffNow === "adaptive") {
      const step = outcome === "solved" ? (hintsShown ? ADAPT_UP / 2 : ADAPT_UP)
        : outcome === "partial" ? 0
        : outcome === "skipped" ? ADAPT_DOWN / 3
        : ADAPT_DOWN;
      adaptiveShift = Math.max(ADAPT_MIN, Math.min(ADAPT_MAX, adaptiveShift + step));
      adaptiveHistory.push({ outcome, shift: Math.round(adaptiveShift) });
      // The queue was built for the old level, so it is no longer the right
      // queue. Dropping it is the point of adapting.
      queue = [];
    }

    hintsShown = 0;
    await renderAbility();
    const after = ability.find((a) => a.domain === movedDomain)?.rating ?? null;
    lastMove = (before !== null && after !== null && after !== before)
      ? { domain: movedDomain, from: before, to: after } : null;
  }

  root() && document.addEventListener("click", async (ev) => {
    if (!window.Lattice.visible("study")) return;
    const grade = ev.target.closest("[data-grade]");
    const act = ev.target.closest("[data-act]")?.dataset.act;
    // Most actions are about the problem on screen. These are not: they run from
    // the setup and results cards, when there is no current problem at all.
    const CARD_ACTS = new Set(["starttest", "newtest", "practice", "againset", "endtest"]);
    if (!current && !CARD_ACTS.has(act)) return;

    if (act === "next") return next();

    if (grade) {
      if (answerSubmitted) return;
      answerSubmitted = true;
      const given = document.getElementById("freeAnswer")?.value ?? null;
      let outcome = grade.dataset.grade;
      let machineGrade = null;
      if (current.kind !== "drill" && current.problem.auto_gradable && given?.trim()) {
        const verdict = await fetch("/api/check-answer", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ item_id: current.problem.id, answer: given }),
        }).then((r) => r.json()).catch(() => null);
        if (verdict?.decided) {
          outcome = verdict.outcome;
          const box = el("answerFeedback");
          if (box) {
            box.innerHTML = verdict.correct
              ? `<div class="feedback-head">Correct</div><p class="feedback-summary">Exact answer. Nice work.</p>`
              : `<div class="feedback-head">Not quite</div><p class="feedback-summary">That does not match the accepted answer. Check the operation and try the problem again.</p>`;
            box.className = `feedback ${verdict.correct ? "ok" : "no"}`;
          }
        }
      } else if (current.kind !== "drill" && !current.problem.auto_gradable && given?.trim()) {
        // Free-response work is graded by Jev using the same standardized
        // bands as the server's assessment log. If Jev abstains, preserve the
        // learner's explicit self-assessment rather than inventing certainty.
        const verdict = await fetch("/api/grade-answer", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ item_id: current.problem.id, answer: given,
            seconds: Math.round((performance.now() - startedAt) / 1000), hints: hintsShown }),
        }).then((r) => r.json()).catch(() => null);
        if (verdict?.grade) machineGrade = verdict.grade;
        if (verdict?.decided) {
          outcome = verdict.outcome;
          const box = el("answerFeedback");
          if (box) {
            box.innerHTML = gradeFeedbackHTML(verdict);
            box.className = `feedback ${outcome === "solved" ? "ok" : outcome === "partial" ? "partial" : "no"}`;
          }
        } else {
          const box = el("answerFeedback");
          if (box) {
            const uncertain = verdict?.grade;
            box.innerHTML = verdict?.reason === "jev_unavailable"
              ? `<p class="feedback-summary">Saved. Jev is unavailable, so your self-assessment was kept.</p>`
              : uncertain
                ? `<div class="feedback-head">Jev is not fully sure yet</div>
                   ${gradeFeedbackHTML(uncertain)}
                   <p class="feedback-note">Your self-assessment was saved. You can use the hint or show the solution to compare.</p>`
                : `<p class="feedback-summary">Saved. Add a little reasoning if you want a useful review.</p>`;
            box.className = "feedback partial";
          }
        }
      }
      if (!given?.trim()) {
        const box = el("answerFeedback");
        if (box) {
          box.textContent = "Saved as a self-assessment. Write an answer if you want Jev to review it.";
          box.className = "feedback";
        }
      }
      await record(outcome, given, machineGrade);
      document.querySelectorAll("[data-grade]").forEach((button) => {
        button.disabled = true;
      });
      const actions = document.querySelector(".card-actions");
      if (actions && !actions.querySelector('[data-act="next"]')) {
        actions.insertAdjacentHTML("beforeend",
          '<button class="btn-primary next-answer" data-act="next">Next problem →</button>');
      }
      return;
    }
    // A skip with working in the box is not an empty skip. `ability.mjs` throws
    // skips away, but the shadow grader can still say whether they stopped
    // because they were stuck — which is the part worth keeping.
    if (act === "skip") {
      await record("skipped", document.getElementById("freeAnswer")?.value ?? null);
      return next();
    }
    if (act === "endtest") return renderTestResults();
    if (act === "newtest") { pendingTest = true; return renderTestSetup(); }
    if (act === "starttest") {
      pendingTest = false;
      reshuffle();
      test = { length: testLength, index: 0, results: [], difficulty: testDifficulty,
               startedAt: Date.now() };
      // Adaptive starts every test from the target, not from wherever the last
      // one drifted to.
      adaptiveShift = 0;
      adaptiveHistory.length = 0;
      session = { seen: 0, solved: 0 };
      paintSession();
      served.clear();
      queue = [];
      return next();
    }
    if (act === "againset") {
      itemsServed = false;
      session = { seen: 0, solved: 0 };
      reshuffle();
      paintSession();
      queue = [];
      return next();
    }

    if (act === "practice") {
      setMode("practice");
      queue = [];
      return next();
    }

    if (act === "copypath") {
      const btn = ev.target.closest("[data-act]");
      await copyToClipboard(pathText(current.problem), btn, "Copy path");
      return;
    }

    if (act === "copy") {
      const p = current.problem;
      const extras = await get(`/extras/${encodeURIComponent(p.id)}`)
        .catch(() => ({ hints: [], solution: null }));
      const mine = document.getElementById("freeAnswer")?.value?.trim() || "(left blank)";
      const payload = [
        "Mark this answer. Say whether it is correct, partially correct, or wrong, and why.",
        "",
        `SOURCE: ${pathText(p)}`,
        "",
        "PROBLEM:",
        p.text ?? "",
        "",
        "MY ANSWER:",
        mine,
        ...(extras.solution ? ["", "OFFICIAL SOLUTION:", extras.solution] : []),
      ].join("\n");
      await copyToClipboard(payload, ev.target.closest("[data-act]"), "Copy for review");
      return;
    }

    if (act === "show" && current.kind === "drill") {
      hintsShown = 1;
      const w = el("drillWork");
      w.hidden = false;
      w.innerHTML = `<ol class="work-steps">${current.problem.steps
        .map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        <p class="trick">${esc(current.problem.trick ?? "")}</p>`;
    }

    if (act === "hint" || act === "solution") {
      const extras = current.problem.solution
        ? { hints: [], solution: current.problem.solution }
        : await get(`/extras/${encodeURIComponent(current.problem.id)}`)
          .catch(() => ({ hints: [], solution: null }));
      const box = el("extras");
      if (act === "hint") {
        hintsShown = Math.min(hintsShown + 1, extras.hints.length);
        box.innerHTML = `<ol class="hint-list">${extras.hints.slice(0, hintsShown)
          .map((h) => `<li>${esc(h)}</li>`).join("")}</ol>`;
        } else {
          hintsShown = 3;
          box.innerHTML = extras.solution
          ? `<details class="solution" open><summary>${extras.solution_source === "published" ? "Published solution" : "Worked solution"}</summary>
             <div class="statement">${formatStatement(extras.solution)}</div></details>`
          : `<div class="solution-empty"><b>No worked solution is available yet.</b>
             <p class="dim">${esc(extras.message ?? "This source does not include a published solution.")}</p>
             <p class="dim">Try a hint, or copy your attempt for review.</p></div>`;
        }
      window.Lattice.typeset(box);
    }
  });

  document.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "drillForm") return;
    ev.preventDefault();
    const p = current.problem;
    const correct = MathGen.check(p, el("drillAnswer").value);
    const fb = el("drillFeedback");
    fb.textContent = correct ? "Correct" : `Answer: ${p.answer}`;
    fb.className = `feedback ${correct ? "ok" : "no"}`;
    await record(correct ? (hintsShown ? "partial" : "solved") : "failed",
                 el("drillAnswer").value);
    setTimeout(next, correct ? 550 : 1500);
  });

  let testLength = 10;
  let testDifficulty = "adaptive";
  // True while the setup card is on screen: the mode is Test, but no test is
  // running yet, so nothing should serve a question.
  let pendingTest = false;

  /** Keep the segmented control and the session state in step.
   *
   *  Switching to Test no longer *starts* one. It opens a setup card, because a
   *  test you did not get to configure is just practice that stops counting
   *  after ten questions. */
  function setMode(mode) {
    for (const b of document.querySelectorAll("[data-mode]")) {
      b.classList.toggle("active", b.dataset.mode === mode);
    }
    test = null;
    reshuffle();
    session = { seen: 0, solved: 0 };
    paintSession();
    if (mode === "test") { pendingTest = true; renderTestSetup(); }
    else { pendingTest = false; }
  }

  /** The setup card: how long, how hard, over what. */
  function renderTestSetup() {
    const sources = selectedBooks().length;
    const skills = selectedSkills().length;
    root().innerHTML = `
      <section class="card test-setup">
        <p class="eyebrow">Test</p>
        <h2 class="result-title">Set up your test</h2>
        <p class="dim">A fixed number of questions, scored at the end. Nothing is
          hidden from your history — a test attempt counts like any other.</p>

        <div class="field">
          <p class="field-label">Questions</p>
          <div class="seg seg-sm" role="group" aria-label="Test length">
            ${[5, 10, 20, 30].map((n) => `<button type="button" data-len="${n}"
              class="${n === testLength ? "active" : ""}">${n}</button>`).join("")}
          </div>
        </div>

        <div class="field">
          <p class="field-label">Difficulty</p>
          <div class="seg seg-sm" role="group" aria-label="Test difficulty">
            ${["easier", "adaptive", "harder"].map((d) =>
              `<button type="button" data-testdiff="${d}"
                class="${d === testDifficulty ? "active" : ""}">${
                d[0].toUpperCase() + d.slice(1)}</button>`).join("")}
          </div>
          <p class="shortcut-note">${esc(testDifficulty === "adaptive"
            ? "starts on target, then follows your answers — harder when you are right, easier when you are not"
            : DIFF_NOTE[testDifficulty] ?? DIFF_NOTE.adaptive)}</p>
        </div>

        <div class="field">
          <p class="field-label">Drawn from</p>
          <p class="dim">${sources} book${sources === 1 ? "" : "s"}${
            skills ? ` and ${skills} drill skill${skills === 1 ? "" : "s"}` : ""},
            filtered by the fields you have on. Change them in the sidebar.</p>
        </div>

        <div class="card-actions">
          <button class="btn-primary" data-act="starttest">Start test</button>
          <button class="ghost-btn" data-act="practice">Back to practice</button>
        </div>
      </section>`;
  }

  const DIFF_NOTE = {
    easier: "aiming below your level — consolidation",
    adaptive: "follows your answers — easier when you need support, harder when you are ready",
    harder: "aiming at about 60% — expect to be stretched",
  };

  /** Paint the difficulty segment from `picks`, and say what it means. */
  function paintDifficulty() {
    const d = picks.difficulty || "adaptive";
    for (const b of document.querySelectorAll("#diffSeg [data-diff]")) {
      b.classList.toggle("active", b.dataset.diff === d);
    }
    const note = el("diffNote");
    if (note) note.textContent = DIFF_NOTE[d] ?? DIFF_NOTE.adaptive;
  }

  const KEY_OF_BOX = { domainChips: "domains", bookChips: "books", skillChips: "skills" };
  const BOX_OF_KEY = { domains: "domainChips", books: "bookChips", skills: "skillChips" };

  document.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip-toggle[data-pick]");
    if (chip) {
      const key = chip.dataset.pick, id = chip.dataset.id;
      const set = new Set(picks[key]);
      set.has(id) ? set.delete(id) : set.add(id);
      // Keep the stored order stable so the chips do not reshuffle on toggle.
      picks[key] = pickSets[key].map((x) => x.id).filter((x) => set.has(x));
      savePicks();
      // Touching the sidebar is how you leave a set: the pickers are the
      // free-practice controls, and a set ignores them.
      if (spec) {
        spec = null; assessment = null; test = null;
        location.hash = "study";
        el("sideStudy")?.classList.remove("set-active");
      }
      paintChips(BOX_OF_KEY[key], key, pickSets[key]);
      queue = [];
      return next();
    }

    // "all" toggles the whole group: everything on, or everything off if it was
    // already full.
    const all = e.target.closest("[data-all]");
    if (all) {
      const box = all.dataset.all, key = KEY_OF_BOX[box];
      if (!key) return;
      const ids = pickSets[key].map((x) => x.id);
      picks[key] = picks[key].length === ids.length ? [] : ids;
      savePicks();
      paintChips(box, key, pickSets[key]);
      queue = [];
      return next();
    }

    const diff = e.target.closest("[data-diff]");
    if (diff) {
      picks.difficulty = diff.dataset.diff;
      savePicks();
      paintDifficulty();
      // The change has to show up in the next card, not the next refill, or the
      // control feels broken for the length of a queue.
      queue = [];
      served.clear();
      reshuffle();
      return next();
    }

    const mode = e.target.closest("[data-mode]");
    if (mode) {
      setMode(mode.dataset.mode);
      queue = [];
      // Test opens its setup card and waits; practice starts straight away.
      if (!pendingTest) return next();
      return;
    }

    const len = e.target.closest("[data-len]");
    if (len) {
      for (const b of len.parentElement.children) b.classList.toggle("active", b === len);
      testLength = Number(len.dataset.len);
      if (test) test.length = testLength;
      return;
    }

    const tdiff = e.target.closest("[data-testdiff]");
    if (tdiff) {
      testDifficulty = tdiff.dataset.testdiff;
      renderTestSetup();
      return;
    }

    if (e.target.closest("#generateBtn")) return next();
  });

  // G for a new question, matching the sidebar hint.
  document.addEventListener("keydown", (e) => {
    if (!window.Lattice.visible("study")) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && current
        && !/^(INPUT|SELECT)$/.test(e.target.tagName)) {
      e.preventDefault();
      document.querySelector('[data-grade="solved"]')?.click();
      return;
    }
    if (e.key.toLowerCase() === "h" && current && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      e.preventDefault();
      document.querySelector('[data-act="hint"]')?.click();
      return;
    }
    if (e.key.toLowerCase() === "g" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      e.preventDefault();
      next();
    }
  });

  window.Lattice.register("study", async () => {
    loadPicks();
    picksLoaded = Boolean(localStorage.getItem(PICK_KEY));
    spec = parseSpec(decodeURIComponent(location.hash.slice(1)).split("|")[1]);
    await renderAbility();
    await renderPickers();
    paintDifficulty();
    el("sideStudy")?.classList.toggle("set-active", Boolean(spec));
    paintSetChrome();
    await next();
  });

  /** Entering `#study|…` starts that set; a bare `#study` leaves it. */
  window.addEventListener("lattice:route", async (ev) => {
    if (ev.detail?.view !== "study") return;
    const next_ = parseSpec(ev.detail.arg);
    const same = JSON.stringify(next_) === JSON.stringify(spec);
    if (same) return;
    spec = next_;
    session = { seen: 0, solved: 0 };
    reshuffle();
    served.clear();
    queue = [];
    itemsServed = false;
    // Leaving or changing a set abandons any paper in progress; an assessment
    // must never outlive the route that started it.
    assessment = null;
    test = null;
    paintSession();
    const side = el("sideStudy");
    if (side) side.classList.toggle("set-active", Boolean(spec));
    paintSetChrome();
    // The very first route fires before study has booted; register() handles it.
    if (root() && window.Lattice.visible("study") && pickSets.books.length) await next();
  });

})();
