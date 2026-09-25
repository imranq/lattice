// Stats: the deeper read, moved off Home so Home can stay a launchpad.
(() => {
  const root = () => document.getElementById("statsRoot");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
  const get = (p) => fetch(`/api${p}`).then((r) => (r.ok ? r.json()
    : Promise.reject(new Error(`${p} → ${r.status}`))));

  function heatmap(days) {
    const byDay = new Map(days.map((d) => [d.day, d]));
    const cells = [];
    const start = new Date();
    start.setDate(start.getDate() - 125 - start.getDay());
    const max = Math.max(1, ...days.map((d) => d.n));
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

  async function render() {
    const [stats, coverage, books, mastery, ability, due] = await Promise.all([
      get("/stats"), get("/coverage"), get("/books"), get("/mastery"),
      get("/ability").catch(() => ({ domains: [] })), get("/due?n=10").catch(() => []),
    ]);
    const activity = await get("/activity?days=126").catch(() => []);
    const assessed = coverage.reduce((a, c) => a + c.assessed, 0);
    const concepts = coverage.reduce((a, c) => a + c.concepts, 0);
    const total = books.reduce((a, b) => a + b.exercises, 0);

    root().innerHTML = `
      <section class="stat-row">
        ${[["Attempts", stats.attempts, `${books.length} sources`, ""],
           ["Solved", stats.solved, stats.attempts
             ? `${Math.round((stats.solved / stats.attempts) * 100)}% of attempts`
             : "no attempts yet", "accent"],
           ["Day streak", stats.streak, "days running", "amber"],
           ["Minutes", stats.minutes, "time on problems", ""],
           ["Due now", stats.due, "scheduled reviews", ""]].map(([k, v, foot, tone]) =>
          `<div class="stat-tile ${tone}"><b>${v}</b><span>${k}</span>
             <span class="stat-foot">${esc(foot)}</span></div>`).join("")}
      </section>

      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Activity</p><h2>The last 18 weeks</h2></div></div>
        ${activity.length ? heatmap(activity) : `<p class="dim">No attempts recorded yet.</p>`}
      </section>

      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Ability</p><h2>Level by field</h2></div></div>
        <p class="panel-note">An Elo rating per field: each attempt is scored as a match
          between you and the problem, which estimates both at once. Study aims one notch
          below your rating, where the predicted success rate is 85% — the point at which
          learning is fastest.</p>
        ${(ability.domains ?? []).filter((d) => d.pool).map((d) => `
          <div class="cov-row">
            <span class="cov-label"><a href="#subject|${encodeURIComponent(d.domain)}">${
              esc(d.domain)}</a></span>
            <span class="cov-track"><span class="cov-fill" style="width:${
              Math.max(3, Math.min(100, ((d.rating - 700) / 1400) * 100))}%"></span></span>
            <span class="cov-num">${d.rating}</span>
            <span class="cov-sub">${d.attempts
              ? `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}${
                  d.confident ? "" : " · provisional"}`
              : "not started"} · aims at ${d.target_rating}</span>
          </div>`).join("")}
      </section>

      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Evidence</p><h2>Coverage</h2></div></div>
        <p class="panel-note">${assessed} of ${concepts} concepts have any evidence
          (${pct(assessed / concepts)}). Mastery is averaged over the assessed ones only —
          a high number on thin coverage means little.</p>
        ${coverage.map((c) => `
          <div class="cov-row">
            <span class="cov-label"><a href="#subject|${encodeURIComponent(c.domain)}">${
              esc(c.domain)}</a></span>
            <span class="cov-track"><span class="cov-fill" style="width:${
              pct(c.coverage)}"></span></span>
            <span class="cov-num">${pct(c.coverage)}</span>
            <span class="cov-sub">${c.assessed}/${c.concepts} concepts · ${
              c.exercises} exercises${c.mastery !== null
                ? ` · mastery ${pct(c.mastery)}` : ""}</span>
          </div>`).join("")}
      </section>

      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Diagnosis</p><h2>Weakest concepts</h2></div></div>
        ${mastery.length ? `<ol class="ranked">${mastery.slice(0, 10).map((m) => `
          <li><a href="#explore|${encodeURIComponent(m.concept_id)}">${esc(m.label)}</a>
            <span class="dim">${pct(m.mastery)} over ${m.attempts} attempt${
              m.attempts === 1 ? "" : "s"}</span></li>`).join("")}</ol>`
          : `<p class="dim">Nothing assessed yet.</p>`}
      </section>

      ${due.length ? `<section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Schedule</p><h2>Due for review</h2></div></div>
        <ul class="ranked">${due.map((d) => `<li>${esc(d.item_id)}
          <span class="dim">${d.reps} rep${d.reps === 1 ? "" : "s"} ·
            ease ${d.ease.toFixed(2)}</span></li>`).join("")}</ul>
      </section>` : ""}

      <section class="panel">
        <div class="panel-heading"><div><p class="eyebrow">Library</p><h2>Sources</h2></div>
          <span class="data-count">every book behind the bank</span></div>
        <div class="table-scroll"><table class="book-table">
          <thead><tr><th>Book</th><th>Field</th><th>Extraction</th>
            <th class="num">Problems</th></tr></thead>
          <tbody>${books.map((b) => `<tr>
            <td>${b.local_url || b.url
                  ? `<a class="book-title book-out" href="${esc(b.local_url ?? b.url)}"
                       target="_blank" rel="noopener">${esc(b.title)}</a>`
                  : `<span class="book-title">${esc(b.title)}</span>`}
              ${b.authors ? `<span class="dim"> ${esc(b.authors)}</span>` : ""}
              ${b.local_url ? `<a class="tag tag-local" href="${esc(b.local_url)}"
                target="_blank" rel="noopener">local PDF</a>` : ""}</td>
            <td><a href="#subject|${encodeURIComponent(b.domain)}">${esc(b.domain)}</a></td>
            <td><span class="tag">${esc(b.extraction ?? "?")}</span></td>
            <td class="num">${b.exercises.toLocaleString()}</td></tr>`).join("")}
            <tr class="total"><td colspan="3">Total</td>
              <td class="num">${total.toLocaleString()}</td></tr>
          </tbody>
        </table></div>
      </section>`;

    window.Lattice.typeset(root());
  }

  window.Lattice.register("stats", () => render().catch((err) => {
    root().innerHTML = `<p class="dim">Stats needs the server API (${esc(err.message)}).</p>`;
  }));
})();
