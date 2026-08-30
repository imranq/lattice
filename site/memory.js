// Practice memory: attempt logging, spaced-repetition state, per-concept mastery,
// and the warm-up ladder for the open problem.
//
// Degrades quietly: if the API is unreachable (the site opened as plain static
// files), every panel hides itself and the browser keeps working as before.
(() => {
  const API = "/api";
  let online = false;
  let statesById = new Map();

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function api(path, opts) {
    const res = await fetch(API + path, {
      headers: { "content-type": "application/json" },
      ...opts,
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  const post = (path, body) =>
    api(path, { method: "POST", body: JSON.stringify(body) });

  // ---------- global panel: streak, due count, weakest concepts ----------

  async function refreshPanel() {
    const panel = $("#memoryPanel");
    if (!panel) return;
    try {
      const [stats, mastery, weak] = await Promise.all([
        api("/stats"), api("/mastery"), api("/weak-edges"),
      ]);
      online = true;

      const bars = mastery.slice(0, 5).map((m) => `
        <div class="mastery-row">
          <span class="mastery-label" title="${esc(m.label)}">${esc(m.label)}</span>
          <span class="mastery-track">
            <span class="mastery-fill" style="width:${Math.round(m.mastery * 100)}%"></span>
          </span>
          <span class="mastery-num">${Math.round(m.mastery * 100)}%</span>
          <span class="mastery-conf" title="confidence in this estimate">±${
            Math.round((1 - m.confidence) * 100)}</span>
        </div>`).join("");

      const gap = weak[0];
      const gapHtml = gap ? `
        <div class="weak-edge">
          <span class="weak-tag ${gap.status}">${gap.status} gap</span>
          <strong>${esc(gap.src_label)}</strong> → ${esc(gap.dst_label)}
          <span class="weak-hint">fix the prerequisite first</span>
        </div>` : "";

      panel.innerHTML = `
        <div class="memory-head">
          <span class="memory-title">Memory</span>
          <span class="memory-stat"><b>${stats.attempts}</b> attempts</span>
          <span class="memory-stat"><b>${stats.solved}</b> solved</span>
          <span class="memory-stat"><b>${stats.due}</b> due</span>
          <span class="memory-stat"><b>${stats.minutes}</b> min</span>
        </div>
        ${mastery.length ? `<div class="mastery-list">${bars}</div>` : `
          <p class="memory-empty">No attempts yet. Mark a problem solved or failed to start
          building a mastery estimate.</p>`}
        ${gapHtml}`;
      panel.hidden = false;
    } catch {
      online = false;
      panel.hidden = true;
    }
  }

  async function loadStates() {
    try {
      const { states } = await api("/state");
      statesById = new Map(states.map((s) => [s.item_id, s]));
      online = true;
    } catch { online = false; }
  }

  // ---------- per-problem: grade buttons, ladder, history ----------

  function gradeButtons(id, state) {
    const status = state?.status ?? "unseen";
    const starred = state?.starred ? "on" : "";
    return `
      <div class="practice-bar" data-problem="${esc(id)}">
        <span class="practice-label">How did it go?</span>
        <button class="grade" data-outcome="solved">Solved</button>
        <button class="grade" data-outcome="partial">Partial</button>
        <button class="grade" data-outcome="failed">Failed</button>
        <button class="star ${starred}" data-star title="Star this problem">★</button>
        <span class="practice-status status-${esc(status)}">${esc(status.replace("_", " "))}</span>
      </div>`;
  }

  function ladderHtml(ladder) {
    if (!ladder || !ladder.rungs?.length) return "";
    const rungs = ladder.rungs.map((r, i) => `
      <li class="rung">
        <span class="rung-tier">${esc(r.tier)}</span>
        <span class="rung-body">
          <span class="rung-meta">${esc(r.section)} · ${esc(r.label)}${
            r.starred ? " · harder" : ""}</span>
          <span class="rung-text">${esc(r.text)}</span>
        </span>
        <button class="rung-grade" data-rung="${esc(r.exercise_id)}"
                data-concept="${esc(r.concept_id)}">done</button>
      </li>`).join("");
    return `
      <details class="ladder-wrap" open>
        <summary>Warm up first — ${ladder.rungs.length} rungs toward
          <em>${esc(ladder.target_concept)}</em></summary>
        <ol class="ladder">${rungs}</ol>
      </details>`;
  }

  async function onProblem({ detail }) {
    const { problem, container } = detail;
    // The first problem renders before init resolves, so wait for it rather than
    // dropping the panel on that render.
    await ready;
    if (!online) return;
    const id = problem.id;

    post("/view", { item_id: id }).catch(() => {});

    const [ladder, history] = await Promise.all([
      api(`/ladder/${encodeURIComponent(id)}`).catch(() => null),
      api(`/attempts/${encodeURIComponent(id)}`).catch(() => []),
    ]);

    const state = statesById.get(id);
    const historyHtml = history.length ? `
      <div class="attempt-history">${history.slice(0, 5).map((h) => `
        <span class="attempt-chip outcome-${esc(h.outcome)}">${esc(h.outcome)}
          <em>${new Date(h.ts).toLocaleDateString()}</em></span>`).join("")}
      </div>` : "";

    const block = document.createElement("div");
    block.className = "memory-block";
    block.innerHTML = gradeButtons(id, state) + historyHtml + ladderHtml(ladder);

    const heading = container.querySelector("h2");
    if (heading?.nextSibling) heading.parentNode.insertBefore(block, heading.nextSibling);
    else container.appendChild(block);

    // Rung statements carry TeX ($\Omega$, fractions); typeset them like the rest
    // of the page. app.js already ran MathJax before this block existed.
    if (window.MathJax?.typesetPromise) window.MathJax.typesetPromise([block]).catch(() => {});

    block.addEventListener("click", async (e) => {
      const grade = e.target.closest(".grade");
      const star = e.target.closest("[data-star]");
      const rung = e.target.closest(".rung-grade");

      if (grade) {
        const hints = container.querySelectorAll(".hints-wrap[open] li").length;
        await post("/attempt", {
          item_id: id, item_type: "putnam", concept_id: ladder?.target_concept_id ?? null,
          outcome: grade.dataset.outcome, hints_used: hints,
        }).catch(() => {});
        await loadStates();
        const st = statesById.get(id);
        const badge = block.querySelector(".practice-status");
        if (badge) {
          badge.textContent = (st?.status ?? "in progress").replace("_", " ");
          badge.className = `practice-status status-${st?.status ?? "in_progress"}`;
        }
        grade.classList.add("flash");
        setTimeout(() => grade.classList.remove("flash"), 600);
        refreshPanel();
      }

      if (star) {
        const on = !star.classList.contains("on");
        star.classList.toggle("on", on);
        await post("/star", { item_id: id, item_type: "putnam", starred: on }).catch(() => {});
      }

      if (rung) {
        await post("/attempt", {
          item_id: rung.dataset.rung, item_type: "exercise",
          concept_id: rung.dataset.concept, outcome: "solved",
        }).catch(() => {});
        rung.textContent = "✓";
        rung.disabled = true;
        refreshPanel();
      }
    });
  }

  const ready = loadStates().then(refreshPanel);
  document.addEventListener("lattice:problem", onProblem);
  if (window.latticeCurrent) onProblem({ detail: window.latticeCurrent });
})();
