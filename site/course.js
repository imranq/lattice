// A book as a course: chapters you can collapse, topics that are locked, ready,
// in progress or learned.
//
// The graph answers "how does everything relate". This answers the question you
// actually have when you sit down: what am I allowed to work on right now. The
// state comes from the prerequisite edges, not from the page order — a topic in
// chapter 7 whose prerequisites you have done is open, and a chapter 2 topic
// resting on something you have not touched is not.
(() => {
  const root = () => document.getElementById("courseRoot");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
  const get = (p) => fetch(`/api${p}`).then((r) => (r.ok ? r.json()
    : Promise.reject(new Error(`${p} → ${r.status}`))));

  const STATE_LABEL = { learned: "learned", started: "in progress",
                        ready: "ready", locked: "locked", upcoming: "upcoming" };
  // The ladder. `level` is how well you know a topic; `state` is whether the
  // course is offering it today. They are different questions and the row shows
  // both — a topic can be locked and familiar, or ready and untouched.
  const LEVEL_LABEL = { none: "not started", attempted: "attempted", familiar: "familiar",
                        proficient: "proficient", mastered: "mastered" };

  /** Which chapters are open, per course, so a reload does not fold everything. */
  const OPEN_KEY = "lattice_course_open_v1";
  const openSet = (() => {
    try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]")); }
    catch { return new Set(); }
  })();
  const saveOpen = () => {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openSet])); } catch { /* private mode */ }
  };

  /** A unit test or course challenge: the only route to `mastered`. */
  function assessHref({ book, chapter = null, kind = "unit_test" }) {
    const q = new URLSearchParams({ kind: "assess", book });
    if (chapter !== null && chapter !== undefined) q.set("chapter", String(chapter));
    if (kind === "challenge") q.set("assess", "challenge");
    return `#study|${q}`;
  }

  function studyHref({ book, concepts = [], count = 0, label = "" }) {
    const q = new URLSearchParams({ kind: "study" });
    if (book) q.set("books", book);
    if (concepts.length) q.set("concepts", concepts.join(","));
    if (count) q.set("count", String(count));
    if (label) q.set("label", label);
    return `#study|${q}`;
  }

  // ---- the shelf ----------------------------------------------------------

  async function renderIndex() {
    root().innerHTML = `<p class="dim">Loading courses…</p>`;
    const rows = await get("/courses");
    root().innerHTML = `
      <div class="subject-head">
        <div>
          <h1 class="subject-title">Courses</h1>
          <p class="dim">${rows.length} books · each one a tree of topics you unlock
            by finishing what they rest on</p>
        </div>
      </div>
      <div class="course-shelf">
        ${rows.map((c) => `
          <a class="course-card" href="#course|${encodeURIComponent(c.id)}">
            <p class="eyebrow">${esc(c.domain ?? "")}</p>
            <h3>${esc(c.title)}</h3>
            ${c.authors ? `<p class="book-meta">${esc(c.authors)}</p>` : ""}
            <span class="cov-track"><span class="cov-fill"
              style="width:${pct(c.progress)}"></span></span>
            <p class="course-card-meta">${pct(c.mastery_pct)} mastery ·
              ${c.points.toLocaleString()}/${c.points_max.toLocaleString()} points ·
              ${c.ready} ready · ${c.exercises.toLocaleString()} problems</p>
          </a>`).join("")}
      </div>`;
    window.Lattice.typeset(root());
  }

  // ---- one course ---------------------------------------------------------

  function topicRow(t, bookId) {
    const bar = t.mastery === null ? ""
      : `<span class="cov-track"><span class="cov-fill"
           style="width:${pct(t.mastery)}"></span></span>
         <span class="cov-num">${pct(t.mastery)}</span>`;
    // A lock says what it is waiting on; "upcoming" says why it is not offered,
    // which is a softer claim and worth wording differently.
    const why = t.state === "locked"
      ? `<p class="topic-blocked">needs ${t.blocking.slice(0, 3).map(esc).join(", ")}${
          t.blocking.length > 3 ? ` +${t.blocking.length - 3}` : ""}</p>`
      : t.state === "upcoming"
      ? `<p class="topic-blocked">further into the book than you have worked</p>`
      // The rule for the next rung, stated rather than implied. A ladder whose
      // steps you have to guess at is just a score with extra words.
      : t.next_step ? `<p class="topic-blocked">${esc(t.next_step)}</p>` : "";
    return `
      <li class="course-topic is-${t.state} lvl-${t.level ?? "none"}">
        <span class="state-dot" title="${STATE_LABEL[t.state]}"></span>
        <span class="course-topic-main">
          <a class="topic-name" href="#explore|${encodeURIComponent(t.id)}"
             title="Open on the graph">${esc(t.label)}</a>
          <span class="topic-meta">
            <span class="level-pill lvl-${t.level ?? "none"}">${esc(
              t.level_label ?? LEVEL_LABEL[t.level] ?? "not started")}</span>
            ${t.exercises} problem${t.exercises === 1 ? "" : "s"}${
            t.page ? ` · p.${t.page}` : ""} · ${STATE_LABEL[t.state]}</span>
          ${why}
        </span>
        <span class="topic-bar">${bar}</span>
        <span class="topic-actions">
          ${t.exercises ? `<a class="ghost-btn" href="${studyHref({ book: bookId,
             concepts: [t.id], count: Math.min(t.exercises, 8), label: t.label })}"
             >${t.state === "learned" ? "Review" : "Practise"}</a>` : ""}
        </span>
      </li>`;
  }

  function chapterBlock(c, bookId) {
    const key = `${bookId}:${c.chapter}`;
    // A chapter with something to do opens by default; finished ones stay shut.
    const open = openSet.has(key) || (!openSet.size && Boolean(c.ready || c.started));
    return `
      <section class="course-chapter${open ? " open" : ""}" data-chapter="${esc(key)}">
        <div class="course-chapter-row">
          <button type="button" class="course-chapter-head" aria-expanded="${open}">
            <span class="chev">▸</span>
            <span class="course-chapter-title">${esc(c.title)}</span>
            <span class="cov-track"><span class="cov-fill"
              style="width:${pct(c.progress)}"></span></span>
            <span class="course-chapter-meta">${c.counts.mastered + c.counts.proficient}/${
              c.topics.length} mastered · ${c.exercises} problems</span>
          </button>
          ${c.unit_test
            ? `<a class="ghost-btn is-ok" href="${assessHref({ book: bookId, chapter: c.chapter })}"
                 title="One question per topic. A clean answer promotes a proficient topic to mastered."
                 >Unit test</a>`
            : `<span class="ghost-btn is-off"
                 title="A unit test opens once a topic in this chapter reaches familiar"
                 >Unit test</span>`}
        </div>
        <ul class="course-topics">${c.topics.map((t) => topicRow(t, bookId)).join("")}</ul>
      </section>`;
  }

  async function renderCourse(bookId) {
    root().innerHTML = `<p class="dim">Loading course…</p>`;
    const d = await get(`/course?book=${encodeURIComponent(bookId)}`);
    const b = d.book, tt = d.totals;

    root().innerHTML = `
      <div class="subject-head">
        <div>
          <p class="eyebrow"><a href="#course">← all courses</a>
            ${b.domain ? ` · <a href="#subject|${encodeURIComponent(b.domain)}">${esc(b.domain)}</a>` : ""}</p>
          <h1 class="subject-title">${b.local_url || b.url
            ? `<a class="book-out" href="${esc(b.local_url ?? b.url)}" target="_blank"
                 rel="noopener">${esc(b.title)}</a>` : esc(b.title)}</h1>
          <p class="dim">${b.authors ? `${esc(b.authors)} · ` : ""}${tt.topics} topics ·
            ${tt.exercises.toLocaleString()} problems</p>
        </div>
        <div class="subject-actions">
          <div class="stat-tile"><b>${pct(tt.mastery_pct)}</b><span>mastery</span>
            <span class="stat-foot">proficient or better</span></div>
          <div class="stat-tile accent"><b>${tt.points.toLocaleString()}</b><span>points</span>
            <span class="stat-foot">of ${tt.points_max.toLocaleString()}</span></div>
          <a class="btn-primary" href="${studyHref({ book: b.id, count: 10, label: b.title })}"
            >Study this course</a>
          <a class="ghost-btn" href="${assessHref({ book: b.id, kind: "challenge" })}"
             title="Up to 20 questions across the whole book. Answer one right and you
                    never have to grind that topic."
            >Course challenge</a>
        </div>
      </div>

      <div class="course-legend">
        ${["mastered", "proficient", "familiar", "attempted", "none"].map((l) =>
          `<span class="lvl-${l}"><i class="state-dot"></i>${
            tt.counts[l]} ${esc(LEVEL_LABEL[l])}</span>`).join("")}
        <span class="dim">${tt.locked} locked · ${tt.upcoming} not yet offered</span>
      </div>

      <p class="panel-note course-rule">Mastered is the one rung practice cannot
        reach: it needs a clean, unaided answer on a
        <b>unit test</b> or <b>course challenge</b>. That is also how you test out
        of a topic you already know — one right answer, no grinding.</p>

      ${d.next.length ? `
        <section class="panel">
          <div class="panel-heading">
            <div><p class="eyebrow">Next up</p><h2>What is open to you now</h2></div>
            <a class="ghost-btn" href="${studyHref({ book: b.id,
               concepts: d.next.map((t) => t.id), count: 10,
               label: `${b.title} — next up` })}">Practise these</a>
          </div>
          <ul class="course-topics">${d.next.map((t) => topicRow(t, b.id)).join("")}</ul>
        </section>` : ""}

      <div class="course-tree">
        ${d.chapters.map((c) => chapterBlock(c, b.id)).join("")}
      </div>`;
    window.Lattice.typeset(root());
  }

  // Collapsing is view state, not a route: handled here rather than by re-render.
  document.addEventListener("click", (e) => {
    const head = e.target.closest(".course-chapter-head");
    if (!head) return;
    const sec = head.closest(".course-chapter");
    const on = sec.classList.toggle("open");
    head.setAttribute("aria-expanded", String(on));
    if (on) openSet.add(sec.dataset.chapter); else openSet.delete(sec.dataset.chapter);
    saveOpen();
  });

  let lastArg;
  window.addEventListener("lattice:route", (e) => {
    if (e.detail.view !== "course") return;
    if (e.detail.arg === lastArg && root().children.length) return;
    lastArg = e.detail.arg;
    const p = e.detail.arg ? renderCourse(e.detail.arg) : renderIndex();
    p.catch((err) => {
      root().innerHTML = `<p class="dim">Could not load that course (${esc(err.message)}).</p>`;
    });
  });

  window.Lattice.register("course", () => {});
})();
