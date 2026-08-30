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

  function heatmap(days) {
    const byDay = new Map(days.map((d) => [d.day, d]));
    const cells = [];
    const start = new Date();
    start.setDate(start.getDate() - 90 - start.getDay());
    const max = Math.max(1, ...days.map((d) => d.n));
    for (let i = 0; i < 91; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      const rec = byDay.get(key);
      const level = rec ? Math.min(4, 1 + Math.floor((rec.n / max) * 3)) : 0;
      cells.push(`<i class="cell l${level}" title="${key}: ${rec ? rec.n : 0}"></i>`);
    }
    return `<div class="heatmap">${cells.join("")}</div>`;
  }

  function planPanel(plan) {
    return `
      <div class="panel-heading">
        <div><p class="eyebrow">TODAY</p><h2>Recommended schedule</h2></div>
        <div class="plan-actions">
          <select id="planMinutes" aria-label="Session length">
            <option value="20">20 min</option>
            <option value="45" selected>45 min</option>
            <option value="90">90 min</option>
          </select>
          <button id="toCadence" class="btn-primary">Send to Cadence</button>
        </div>
      </div>
      <ol class="plan">${plan.blocks.map((b) => `
        <li>
          <span class="plan-dur">${Math.round(b.duration / 60)}<small>min</small></span>
          <span class="plan-body">
            <b>${esc(b.title)}</b>
            <span class="dim">${esc(b.description ?? b.body ?? "")}</span>
          </span>
          <a class="ghost-btn" href="#study">Start</a>
        </li>`).join("")}</ol>
      <p id="cadenceNote" class="dim"></p>`;
  }

  async function render() {
    const [stats, coverage, books, weak, mastery, ability, plan] = await Promise.all([
      get("/stats"), get("/coverage"), get("/books"), get("/weak-edges"),
      get("/mastery"), get("/ability").catch(() => ({ domains: [] })),
      get("/plan?minutes=45"),
    ]);
    const activity = await get("/activity?days=91").catch(() => []);

    const assessed = coverage.reduce((a, c) => a + c.assessed, 0);
    const concepts = coverage.reduce((a, c) => a + c.concepts, 0);
    const total = books.reduce((a, b) => a + b.exercises, 0);

    el("homeStats").innerHTML = [
      ["Day streak", stats.streak], ["Attempts", stats.attempts],
      ["Solved", stats.solved], ["Due now", stats.due],
      ["Problems", total.toLocaleString()],
    ].map(([k, v]) => `<div class="stat-tile"><b>${v}</b><span>${k}</span></div>`).join("");

    el("homePlan").innerHTML = planPanel(plan);

    el("homeWeak").innerHTML = `
      <div class="panel-heading"><div><p class="eyebrow">DIAGNOSIS</p>
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

    el("homeDeep").innerHTML = `
      <section class="panel">
        <h2>Activity</h2>
        ${activity.length ? heatmap(activity) : `<p class="dim">No attempts yet.</p>`}
      </section>
      <section class="panel">
        <h2>Level by field</h2>
        <p class="panel-note">An Elo rating per field: each attempt is scored as a match
          between you and the problem. Study aims one notch below your rating, where the
          predicted success rate is 85% — the point at which learning is fastest.</p>
        ${(ability.domains ?? []).filter((d) => d.pool).map((d) => `
          <div class="cov-row">
            <span class="cov-label">${esc(d.domain)}</span>
            <span class="cov-track"><span class="cov-fill" style="width:${
              Math.max(3, Math.min(100, ((d.rating - 700) / 1400) * 100))}%"></span></span>
            <span class="cov-num">${d.rating}</span>
            <span class="cov-sub">${d.attempts
              ? `${d.attempts} attempt${d.attempts === 1 ? "" : "s"}${
                  d.confident ? "" : " · provisional"}`
              : "not started"}</span>
          </div>`).join("")}
      </section>
      <section class="panel">
        <h2>Coverage</h2>
        <p class="panel-note">${assessed} of ${concepts} concepts have any evidence
          (${pct(assessed / concepts)}). Mastery is averaged over the assessed ones only —
          a high number on thin coverage means little.</p>
        ${coverage.map((c) => `
          <div class="cov-row">
            <span class="cov-label">${esc(c.domain)}</span>
            <span class="cov-track"><span class="cov-fill" style="width:${
              pct(c.coverage)}"></span></span>
            <span class="cov-num">${pct(c.coverage)}</span>
            <span class="cov-sub">${c.assessed}/${c.concepts} concepts · ${
              c.exercises} exercises</span>
          </div>`).join("")}
      </section>
      <section class="panel">
        <h2>Sources</h2>
        <table class="book-table">
          <thead><tr><th>Book</th><th>Domain</th><th class="num">Exercises</th></tr></thead>
          <tbody>${books.map((b) => `<tr>
            <td>${esc(b.title)}<span class="dim"> ${esc(b.authors ?? "")}</span></td>
            <td>${esc(b.domain)}</td>
            <td class="num">${b.exercises}</td></tr>`).join("")}
            <tr class="total"><td colspan="2">Total</td>
              <td class="num">${total.toLocaleString()}</td></tr>
          </tbody>
        </table>
      </section>`;

    const domains = await window.LatticeGraph?.drawMini(el("miniCanvas"));
    if (domains) {
      el("miniLegend").innerHTML = domains.map((d) =>
        `<span class="legend-item"><i style="background:${
          window.LatticeGraph.colors[d] ?? "#888"}"></i>${esc(d)}</span>`).join("");
    }
  }

  document.addEventListener("click", async (ev) => {
    if (!ev.target.closest("#toCadence")) return;
    const btn = ev.target.closest("#toCadence");
    const minutes = Number(el("planMinutes").value);
    btn.disabled = true;
    btn.textContent = "Writing…";
    try {
      const r = await fetch("/api/cadence", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      const data = await r.json();
      el("cadenceNote").innerHTML = r.ok
        ? `Written to Cadence as <code>${esc(data.session_id)}</code> —
           <a href="${esc(data.url)}" target="_blank" rel="noopener">press play</a>.`
        : `<span class="warn">${esc(data.error)}</span>`;
    } catch (err) {
      el("cadenceNote").textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Send to Cadence";
    }
  });

  document.addEventListener("change", (ev) => {
    if (ev.target.id !== "planMinutes") return;
    get(`/plan?minutes=${ev.target.value}`).then((plan) => {
      el("homePlan").innerHTML = planPanel(plan);
      el("planMinutes").value = ev.target.value;
    });
  });

  window.Lattice.register("home", () => render().catch((err) => {
    el("homeStats").innerHTML = `<p class="dim">Home needs the server API
      (${esc(err.message)}). Start it with <code>npm start</code>.</p>`;
  }));
})();
