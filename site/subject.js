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
        <a class="topic-name" href="#explore|${encodeURIComponent(t.id)}"
           title="Open in the graph">${esc(t.label)}</a>
        <span class="topic-meta">${t.exercises} problem${t.exercises === 1 ? "" : "s"}${
          t.page ? ` · p.${t.page}` : ""}</span>
        <span class="topic-bar">${bar}</span>
        <span class="topic-actions">
          <a class="ghost-btn" href="${studyHref({ domains: [DOMAIN], concepts: [t.id],
             count: Math.min(t.exercises, 8), label: t.label })}"
             title="Practise only this topic">Practise</a>
          <a class="ghost-btn" href="#explore|${encodeURIComponent(t.id)}"
             title="Open this topic on the graph">Graph</a>
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
          <p class="dim">${data.books.length} source${data.books.length === 1 ? "" : "s"} ·
            ${totalTopics} topics · ${totalEx.toLocaleString()} problems ·
            ${assessed} assessed</p>
        </div>
        <div class="subject-actions">
          ${a ? `<div class="stat-tile"><b>${a.rating}</b>
            <span>${a.attempts ? (a.confident ? "rating" : "provisional") : "unrated"}</span>
          </div>` : ""}
          <a class="btn-primary" href="${studyHref({ domains: [domain], count: 10,
             label: domain })}">Study this field</a>
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
                  target="_blank" rel="noopener">local PDF</a>` : ""}
                <span>${esc(b.book_id)}</span></p>
            </div>
            <span class="data-count">${b.exercises.toLocaleString()} problems ·
              ${b.topics.length} topics
              <a class="ghost-btn" href="#course|${encodeURIComponent(b.book_id)}"
                >Open as a course</a>
              <a class="ghost-btn" href="${studyHref({ domains: [domain], books: [b.book_id],
                 count: 10, label: b.title })}">Practise this book</a></span>
          </div>
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
      root().innerHTML = `<p class="dim">Could not load that field (${esc(err.message)}).</p>`;
    });
  });

  window.Lattice.register("subject", () => {});
})();
