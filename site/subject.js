// A subject page: one field, the books that teach it, and every topic under them.
//
// The full graph answers "how does everything relate"; this answers the far more
// common "what is in probability, and how much of it have I done". Reached by
// clicking a field on Home, or #subject|real analysis directly.
(() => {
  const root = () => document.getElementById("subjectRoot");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;

  const get = (p) => fetch(`/api${p}`).then((r) => (r.ok ? r.json()
    : Promise.reject(new Error(`${p} → ${r.status}`))));

  /** A set link: study exactly this scope, and nothing else. */
  function studyHref({ domains = [], books = [], concepts = [], count = 0, label = "" }) {
    const q = new URLSearchParams({ kind: "study" });
    if (domains.length) q.set("domains", domains.join(","));
    if (books.length) q.set("books", books.join(","));
    if (concepts.length) q.set("concepts", concepts.join(","));
    if (count) q.set("count", String(count));
    if (label) q.set("label", label);
    return `#study|${q}`;
  }

  let DOMAIN = null;

  function topicRow(t) {
    const bar = t.mastery === null
      ? `<span class="topic-unseen">not assessed</span>`
      : `<span class="cov-track"><span class="cov-fill"
           style="width:${pct(t.mastery)}"></span></span>
         <span class="cov-num">${pct(t.mastery)}</span>`;
    return `
      <li class="topic-row">
        ${t.exercises ? `<a class="topic-name" href="#explore|${encodeURIComponent(t.id)}"
           title="Open in the graph">${esc(t.label)}</a>`
          : `<span class="topic-name">${esc(t.label)}</span>`}
        <span class="topic-meta">${t.exercises ? window.Lattice.count(t.exercises, "problem")
          : "no problems here"}${t.page ? ` · p. ${t.page}` : ""}</span>
        <span class="topic-bar">${bar}</span>
        <span class="topic-actions">
          ${t.exercises ? `<a class="ghost-btn" href="${studyHref({ domains: [DOMAIN], concepts: [t.id],
             count: Math.min(t.exercises, 8), label: t.label })}"
             title="Practice only this topic">Practice</a>` : ""}
          ${t.exercises ? `<a class="ghost-btn" href="#explore|${encodeURIComponent(t.id)}"
             title="Open this topic on the graph">Graph</a>` : ""}
        </span>
      </li>`;
  }

  async function render(domain) {
    if (!domain) {
      root().innerHTML = `<p class="dim">No field selected. <a href="#home">Back to Home</a>.</p>`;
      return;
    }
    DOMAIN = domain;
    root().innerHTML = `<p class="dim">Loading ${esc(domain)}…</p>`;
    const data = await get(`/subject?domain=${encodeURIComponent(domain)}`);
    if (!data.books.length) throw new Error("no such field");
    const a = data.ability;
    const totalTopics = data.books.reduce((n, b) => n + b.topics.length, 0);
    const totalEx = data.books.reduce((n, b) => n + b.exercises, 0);
    const assessed = data.books.reduce(
      (n, b) => n + b.topics.filter((t) => t.mastery !== null).length, 0);

    root().innerHTML = `
      <div class="subject-head">
        <div>
          <p class="eyebrow"><a href="#home">← all fields</a></p>
          <h1 class="subject-title">${esc(domain)}</h1>
          <p class="dim">${window.Lattice.count(data.books.length, "book")} ·
            ${window.Lattice.count(totalTopics, "topic")} · ${window.Lattice.count(totalEx, "problem")} ·
            ${assessed} assessed</p>
        </div>
        <div class="subject-actions">
          ${a ? `<div class="stat-tile"><b>${a.rating}</b>
            <span>${a.attempts ? (a.confident ? "rating" : "provisional") : "unrated"}</span>
          </div>` : ""}
          ${totalEx ? `<a class="btn-primary" href="${studyHref({ domains: [domain], count: 10,
             label: domain })}">Study this field</a>` : ""}
          <a class="ghost-btn" href="#explore|${encodeURIComponent(domain)}"
             data-graph-domain="${esc(domain)}">Show on the graph</a>
        </div>
      </div>

      ${data.books.map((b) => `
        <section class="panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Source</p>
              <h2>${b.local_url || b.url
                ? `<a class="book-title book-out" href="${esc(b.local_url ?? b.url)}"
                     target="_blank" rel="noopener">${esc(b.title)}</a>`
                : esc(b.title)}</h2>
              <p class="book-meta">${b.authors ? `<span>${esc(b.authors)}</span>` : ""}
                ${b.local_url ? `<a class="tag tag-local" href="${esc(b.local_url)}"
                  target="_blank" rel="noopener">local PDF</a>` : ""}</p>
            </div>
            <span class="data-count">${b.reference_only ? "reference only"
              : window.Lattice.count(b.exercises, "problem")} ·
              ${window.Lattice.count(b.topics.length, "topic")}
              <a class="ghost-btn" href="#course|${encodeURIComponent(b.book_id)}"
                >Open as a course</a>
              ${b.reference_only ? "" : `<a class="ghost-btn" href="${studyHref({
                 domains: [domain], books: [b.book_id], count: 10, label: b.title })}"
                 >Practice this book</a>`}</span>
          </div>
          ${b.reference_only ? `<p class="panel-note reference-note">Copyrighted, so its
            problems aren't hosted on this site. Its topics are listed for reference.</p>` : ""}
          ${(() => {
            // Group by chapter where the book has them; a flat list otherwise.
            const groups = new Map();
            for (const t of b.topics) {
              const key = t.chapter_title ?? (t.chapter ? `Chapter ${t.chapter}` : "");
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key).push(t);
            }
            return [...groups.entries()].map(([chapter, topics]) => `
              ${chapter ? `<h3 class="sub">${esc(chapter)}</h3>` : ""}
              <ul class="topic-list">${topics.map(topicRow).join("")}</ul>`).join("");
          })()}
        </section>`).join("")}`;

    // Section titles come out of the books verbatim, TeX and all.
    window.Lattice.typeset(root());
  }

  let lastArg = null;
  window.addEventListener("lattice:route", (e) => {
    if (e.detail.view !== "subject") return;
    if (e.detail.arg === lastArg && root().children.length) return;
    lastArg = e.detail.arg;
    render(e.detail.arg).catch((err) => {
      root().innerHTML = `<section class="card empty-set">
        <h2 class="result-title">That field isn't here</h2>
        <p class="dim">The link may be out of date.</p>
        <div class="card-actions"><a class="btn-primary" href="#course">All courses</a>
          <a class="ghost-btn" href="#home">Home</a></div></section>`;
    });
  });

  window.Lattice.register("subject", () => {});
})();
