// Progress: the honest version.
//
// Every mastery figure is shown against its denominator — 3 of 191 concepts
// assessed is not "94% mastery of probability", it is almost no evidence. The
// page leads with coverage for that reason.
(() => {
  const el = document.getElementById("content");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;

  const get = (path) => fetch(`/api${path}`).then((r) => {
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  });

  function heatmap(days) {
    // 18 weeks of daily counts, Sunday-first columns.
    const byDay = new Map(days.map((d) => [d.day, d]));
    const cells = [];
    const today = new Date();
    const start = new Date(today);
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

  function bar(value, label, sub) {
    return `
      <div class="cov-row">
        <span class="cov-label">${esc(label)}</span>
        <span class="cov-track"><span class="cov-fill" style="width:${pct(value)}"></span></span>
        <span class="cov-num">${pct(value)}</span>
        <span class="cov-sub">${esc(sub)}</span>
      </div>`;
  }

  async function render() {
    const [stats, coverage, books, weak, rec, due, mastery] = await Promise.all([
      get("/stats"), get("/coverage"), get("/books"), get("/weak-edges"),
      get("/recommend?limit=6"), get("/due?n=8"), get("/mastery"),
    ]);
    const activity = await get("/activity?days=126").catch(() => []);

    const totalExercises = books.reduce((a, b) => a + b.exercises, 0);
    const assessed = coverage.reduce((a, c) => a + c.assessed, 0);
    const concepts = coverage.reduce((a, c) => a + c.concepts, 0);

    el.innerHTML = `
      <section class="stat-row">
        ${[["Attempts", stats.attempts], ["Solved", stats.solved],
           ["Day streak", stats.streak], ["Minutes", stats.minutes],
           ["Due now", stats.due]].map(([k, v]) => `
          <div class="stat-tile"><b>${v}</b><span>${k}</span></div>`).join("")}
      </section>

      <section class="panel">
        <h2>Activity</h2>
        ${activity.length ? heatmap(activity)
          : `<p class="dim">No attempts recorded yet.</p>`}
      </section>

      <section class="panel">
        <h2>Coverage</h2>
        <p class="panel-note">
          ${assessed} of ${concepts} concepts have any evidence
          (${pct(assessed / concepts)}). Mastery below is an average over the
          assessed ones only — a high number on thin coverage means little.
        </p>
        ${coverage.map((c) => bar(
          c.coverage, c.domain,
          `${c.assessed}/${c.concepts} concepts · ${c.exercises} exercises`
          + (c.mastery !== null ? ` · mastery ${pct(c.mastery)}` : "")
        )).join("")}
      </section>

      <section class="panel">
        <h2>Weakest concepts</h2>
        ${mastery.length ? `<ol class="ranked">${mastery.slice(0, 8).map((m) => `
          <li><a href="graph.html#${encodeURIComponent(m.concept_id)}">${esc(m.label)}</a>
            <span class="dim">${pct(m.mastery)} over ${m.attempts} attempt${
              m.attempts === 1 ? "" : "s"}</span></li>`).join("")}</ol>`
          : `<p class="dim">Nothing assessed yet — mark a problem or run a drill.</p>`}
      </section>

      <section class="panel">
        <h2>Gaps worth fixing first</h2>
        ${weak.length ? `<ul class="gaps">${weak.slice(0, 6).map((w) => `
          <li>
            <span class="weak-tag ${w.status}">${w.status}</span>
            <a href="graph.html#${encodeURIComponent(w.src)}">${esc(w.src_label)}</a>
            → <a href="graph.html#${encodeURIComponent(w.dst)}">${esc(w.dst_label)}</a>
            <span class="dim">edge ${w.edge_confidence.toFixed(2)}</span>
          </li>`).join("")}</ul>`
          : `<p class="dim">No gaps yet — they appear once a concept and its
             prerequisite are both weak.</p>`}
      </section>

      <section class="panel">
        <h2>Work on next</h2>
        ${rec.length ? `<ol class="ranked">${rec.map((r) => `
          <li><a href="graph.html#${encodeURIComponent(r.concept_id)}">${esc(r.label)}</a>
            <span class="dim">${esc(r.reason)} · readiness ${pct(r.readiness)}</span></li>`)
          .join("")}</ol>` : `<p class="dim">Nothing to recommend yet.</p>`}
      </section>

      ${due.length ? `<section class="panel">
        <h2>Due for review</h2>
        <ul class="ranked">${due.map((d) => `
          <li>${esc(d.item_id)} <span class="dim">${d.reps} rep${
            d.reps === 1 ? "" : "s"} · ease ${d.ease.toFixed(2)}</span></li>`).join("")}</ul>
      </section>` : ""}

      <section class="panel">
        <h2>Sources</h2>
        <table class="book-table">
          <thead><tr><th>Book</th><th>Domain</th><th>Extraction</th><th class="num">Exercises</th></tr></thead>
          <tbody>${books.map((b) => `<tr>
            <td>${esc(b.title)}<span class="dim"> ${esc(b.authors ?? "")}</span></td>
            <td>${esc(b.domain)}</td>
            <td><span class="tag">${esc(b.extraction ?? "?")}</span></td>
            <td class="num">${b.exercises}</td></tr>`).join("")}
            <tr class="total"><td colspan="3">Total</td><td class="num">${totalExercises}</td></tr>
          </tbody>
        </table>
      </section>`;
  }

  window.Lattice.register("progress", () => render().catch((err) => {
    el.innerHTML = `<p class="dim">Progress needs the server API (${esc(err.message)}).
      Start it with <code>npm start</code>.</p>`;
  }));
})();
