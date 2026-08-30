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
      </li>`;
  }

  async function render(domain) {
    if (!domain) {
      root().innerHTML = `<p class="dim">No field selected. <a href="#home">Back to Home</a>.</p>`;
      return;
    }
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
          <a class="btn-primary" href="#study" data-study="${esc(domain)}">Study this field</a>
        </div>
      </div>

      ${data.books.map((b) => `
        <section class="panel">
          <div class="panel-heading">
            <div><p class="eyebrow">${esc(b.book_id)}</p><h2>${esc(b.title)}</h2></div>
            <span class="data-count">${b.exercises.toLocaleString()} problems ·
              ${b.topics.length} topics</span>
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
  }

  // "Study this field" preselects the field chips before switching view.
  document.addEventListener("click", (ev) => {
    const link = ev.target.closest("[data-study]");
    if (!link) return;
    const want = link.dataset.study;
    for (const c of document.querySelectorAll("#domainChips .chip-toggle")) {
      c.classList.toggle("on", c.dataset.domain === want);
    }
    window.dispatchEvent(new CustomEvent("lattice:refilter"));
  });

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
