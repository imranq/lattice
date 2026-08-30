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
    const [stats, subjects, weak, mastery, plan] = await Promise.all([
      get("/stats"), get("/subjects"), get("/weak-edges"), get("/mastery"),
      get("/plan?minutes=45"),
    ]);
    const total = subjects.reduce((a, s2) => a + s2.exercises, 0);

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

    el("subjectMap").innerHTML = subjects.map((sub) => `
      <a class="subject-card" href="#subject|${encodeURIComponent(sub.domain)}">
        <span class="subject-name">${esc(sub.domain)}</span>
        <span class="subject-count">${sub.exercises.toLocaleString()} problems ·
          ${sub.concepts} topics · ${sub.books.length} source${
            sub.books.length === 1 ? "" : "s"}</span>
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
