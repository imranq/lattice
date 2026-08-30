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
    return `<div class="heatmap">${cells.join("")}</div>`;
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
        ${[["Attempts", stats.attempts], ["Solved", stats.solved],
           ["Day streak", stats.streak], ["Minutes", stats.minutes],
           ["Due now", stats.due]].map(([k, v]) =>
          `<div class="stat-tile"><b>${v}</b><span>${k}</span></div>`).join("")}
      </section>

      <section class="panel">
        <h2>Activity</h2>
        ${activity.length ? heatmap(activity) : `<p class="dim">No attempts recorded yet.</p>`}
      </section>

      <section class="panel">
        <h2>Level by field</h2>
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
        <h2>Coverage</h2>
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
        <h2>Weakest concepts</h2>
        ${mastery.length ? `<ol class="ranked">${mastery.slice(0, 10).map((m) => `
          <li><a href="#explore|${encodeURIComponent(m.concept_id)}">${esc(m.label)}</a>
            <span class="dim">${pct(m.mastery)} over ${m.attempts} attempt${
              m.attempts === 1 ? "" : "s"}</span></li>`).join("")}</ol>`
          : `<p class="dim">Nothing assessed yet.</p>`}
      </section>

      ${due.length ? `<section class="panel">
        <h2>Due for review</h2>
        <ul class="ranked">${due.map((d) => `<li>${esc(d.item_id)}
          <span class="dim">${d.reps} rep${d.reps === 1 ? "" : "s"} ·
            ease ${d.ease.toFixed(2)}</span></li>`).join("")}</ul>
      </section>` : ""}

      <section class="panel">
        <h2>Sources</h2>
        <table class="book-table">
          <thead><tr><th>Book</th><th>Domain</th><th>Extraction</th>
            <th class="num">Problems</th></tr></thead>
          <tbody>${books.map((b) => `<tr>
            <td>${esc(b.title)}<span class="dim"> ${esc(b.authors ?? "")}</span></td>
            <td><a href="#subject|${encodeURIComponent(b.domain)}">${esc(b.domain)}</a></td>
            <td><span class="tag">${esc(b.extraction ?? "?")}</span></td>
            <td class="num">${b.exercises.toLocaleString()}</td></tr>`).join("")}
            <tr class="total"><td colspan="3">Total</td>
              <td class="num">${total.toLocaleString()}</td></tr>
          </tbody>
        </table>
      </section>`;
  }

  window.Lattice.register("stats", () => render().catch((err) => {
    root().innerHTML = `<p class="dim">Stats needs the server API (${esc(err.message)}).</p>`;
  }));
})();
