// Study: one problem at a time, chosen at the edge of what you can do.
//
// Browsing, drilling and testing were three tabs doing one thing badly split up.
// This is the single loop: the server ranks every problem by how close it sits to
// your 85% point in that field (Elo per domain, target 301 points below your
// rating), and this hands them to you one at a time.
//
// Generated drills are auto-graded. Textbook and contest problems are self-graded,
// because no string comparison can mark a proof — claiming otherwise would feed
// the ability estimate noise and it would drift for good.
(() => {
  const root = () => document.getElementById("studyRoot");
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TIER = { W1: "warm-up", W2: "bridge", core: "core" };
  const CONTEST_BOOKS = ["putnam"];

  let queue = [];
  let current = null;
  let ability = [];
  let startedAt = 0;
  let session = { seen: 0, solved: 0 };

  const get = (p) => fetch(`/api${p}`).then((r) => (r.ok ? r.json()
    : Promise.reject(new Error(`${p} → ${r.status}`))));
  const post = (p, body) => fetch(`/api${p}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});

  const sources = () => ({
    textbook: el("srcTextbook").checked,
    contest: el("srcContest").checked,
    generated: el("srcGenerated").checked,
  });

  // ---- queue ---------------------------------------------------------------

  async function refill() {
    const s = sources();
    const domain = el("studyDomain").value;
    const params = new URLSearchParams({ limit: "12" });
    if (domain) params.set("domain", domain);

    let picks = [];
    if (s.textbook || s.contest) {
      picks = await get(`/next?${params}`).catch(() => []);
      picks = picks.filter((p) => (CONTEST_BOOKS.includes(p.book_id) ? s.contest : s.textbook));
    }
    queue = picks.map((p) => ({ kind: "problem", problem: p }));

    // Generated drills are interleaved rather than appended: a run of ten proofs
    // with the arithmetic all at the end is not what "mixed practice" means.
    if (s.generated && window.MathGen) {
      const mm = ability.find((a) => a.domain === "mental math");
      let levels = {};
      try { levels = JSON.parse(localStorage.getItem("lattice_practice_v1")) || {}; } catch { /* */ }
      const skills = [...MathGen.SKILLS].sort((a, b) =>
        (levels[a.id]?.attempts ?? 0) - (levels[b.id]?.attempts ?? 0));
      const drills = skills.slice(0, Math.max(3, Math.ceil(queue.length / 3))).map((sk) => ({
        kind: "drill",
        problem: MathGen.generate(sk.id, levels[sk.id]?.level ?? (mm && mm.rating > 1400 ? 3 : 1)),
      }));
      const mixed = [];
      while (queue.length || drills.length) {
        if (queue.length) mixed.push(queue.shift());
        if (queue.length) mixed.push(queue.shift());
        if (drills.length) mixed.push(drills.shift());
      }
      queue = mixed;
    }
    renderQueuePreview();
  }

  function renderQueuePreview() {
    el("queuePreview").innerHTML = queue.slice(0, 6).map((q) => {
      const label = q.kind === "drill" ? q.problem.skillName
        : (q.problem.section_title || q.problem.label || q.problem.cite);
      const meta = q.kind === "drill" ? `L${q.problem.level}`
        : `${Math.round((q.problem.predicted_success ?? 0) * 100)}%`;
      return `<li><span>${esc(String(label).slice(0, 34))}</span><b>${esc(meta)}</b></li>`;
    }).join("") || `<li class="dim">nothing queued</li>`;
  }

  async function renderAbility() {
    ability = (await get("/ability").catch(() => ({ domains: [] }))).domains ?? [];
    const shown = ability.filter((a) => a.attempts > 0 || a.pool > 100).slice(0, 6);
    el("abilityBox").innerHTML = shown.map((a) => `
      <div class="ability-row" title="${a.attempts} attempts">
        <span>${esc(a.domain)}</span>
        <b class="${a.confident ? "" : "unsure"}">${a.rating}</b>
      </div>`).join("") || `<p class="dim">no attempts yet</p>`;

    const sel = el("studyDomain");
    if (sel.options.length <= 1) {
      for (const a of ability.filter((x) => x.pool > 0)) {
        const o = document.createElement("option");
        o.value = a.domain;
        o.textContent = `${a.domain} (${a.pool})`;
        sel.appendChild(o);
      }
    }
  }

  // ---- one problem ---------------------------------------------------------

  async function next() {
    if (!queue.length) await refill();
    current = queue.shift();
    renderQueuePreview();
    if (!current) {
      root().innerHTML = `<section class="card"><p class="dim">Nothing matches those
        sources. Turn one back on in the sidebar.</p></section>`;
      return;
    }
    startedAt = performance.now();
    current.kind === "drill" ? renderDrill() : renderProblem();
  }

  function sessionBar() {
    return `<div class="session-bar">
      <span><b>${session.seen}</b> seen</span>
      <span><b>${session.solved}</b> solved</span>
      <span class="dim">aiming at 85% — hard enough to learn from</span>
    </div>`;
  }

  function renderDrill() {
    const p = current.problem;
    root().innerHTML = `
      ${sessionBar()}
      <section class="card">
        <header class="card-head">
          <span class="chip chip-drill">generated</span>
          <span class="chip">${esc(p.skillName)}</span>
          <span class="chip">level ${p.level}</span>
        </header>
        <p class="statement statement-drill">${esc(p.prompt)}</p>
        <form id="drillForm" class="answer-row" autocomplete="off">
          <input id="drillAnswer" type="text" placeholder="Answer" aria-label="Answer" />
          <button type="submit" class="btn-primary">Check</button>
          <button type="button" class="ghost-btn" data-act="show">Show me</button>
          <button type="button" class="ghost-btn" data-act="skip">Skip</button>
        </form>
        <div id="drillFeedback" class="feedback"></div>
        <div id="drillWork" class="work" hidden></div>
      </section>`;
    el("drillAnswer").focus();
  }

  async function renderProblem() {
    const p = current.problem;
    const contest = CONTEST_BOOKS.includes(p.book_id);
    root().innerHTML = `
      ${sessionBar()}
      <section class="card">
        <header class="card-head">
          <span class="chip chip-${esc(p.tier)}">${esc(TIER[p.tier] ?? p.tier)}</span>
          ${p.concept_id ? `<a class="chip chip-link"
            href="#explore|${encodeURIComponent(p.concept_id)}">${esc(p.section_title ?? "concept")}</a>` : ""}
          <span class="chip">${esc(p.cite ?? p.book_id)}</span>
          <span class="chip chip-fit" title="predicted chance you solve it">${
            Math.round((p.predicted_success ?? 0) * 100)}%</span>
        </header>
        <div class="statement">${esc(p.text ?? "")}</div>
        <div id="extras" class="extras"></div>
        <footer class="card-actions">
          <span class="self-label">How did it go?</span>
          <button class="btn-primary" data-grade="solved">Solved</button>
          <button class="ghost-btn" data-grade="partial">Partial</button>
          <button class="ghost-btn" data-grade="failed">Failed</button>
          ${contest ? `<button class="ghost-btn" data-act="hint">Hint</button>
                       <button class="ghost-btn" data-act="solution">Solution</button>` : ""}
          <button class="ghost-btn" data-act="skip">Skip</button>
        </footer>
      </section>`;
    if (window.MathJax?.typesetPromise) MathJax.typesetPromise([root()]).catch(() => {});
  }

  // ---- grading -------------------------------------------------------------

  let hintsShown = 0;

  async function record(outcome) {
    const seconds = Math.round((performance.now() - startedAt) / 1000);
    session.seen += 1;
    if (outcome === "solved") session.solved += 1;
    if (current.kind === "drill") {
      const p = current.problem;
      await post("/attempt", {
        item_id: `drill:${p.skill}:L${p.level}:${p.seed}`, item_type: "drill",
        concept_id: `skill:${p.skill}`, outcome, seconds, hints_used: hintsShown,
      });
    } else {
      await post("/attempt", {
        item_id: current.problem.id, item_type: "exercise",
        concept_id: current.problem.concept_id, outcome, seconds, hints_used: hintsShown,
      });
    }
    hintsShown = 0;
    renderAbility();
  }

  root() && document.addEventListener("click", async (ev) => {
    if (!window.Lattice.visible("study") || !current) return;
    const grade = ev.target.closest("[data-grade]");
    const act = ev.target.closest("[data-act]")?.dataset.act;

    if (grade) { await record(grade.dataset.grade); return next(); }
    if (act === "skip") { await record("skipped"); return next(); }

    if (act === "show" && current.kind === "drill") {
      hintsShown = 1;
      const w = el("drillWork");
      w.hidden = false;
      w.innerHTML = `<ol class="work-steps">${current.problem.steps
        .map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
        <p class="trick">${esc(current.problem.trick ?? "")}</p>`;
    }

    if (act === "hint" || act === "solution") {
      const extras = await get(`/extras/${encodeURIComponent(current.problem.id)}`)
        .catch(() => ({ hints: [], solution: null }));
      const box = el("extras");
      if (act === "hint") {
        hintsShown = Math.min(hintsShown + 1, extras.hints.length);
        box.innerHTML = `<ol class="hint-list">${extras.hints.slice(0, hintsShown)
          .map((h) => `<li>${esc(h)}</li>`).join("")}</ol>`;
      } else {
        hintsShown = 3;
        box.innerHTML = extras.solution
          ? `<details class="solution" open><summary>Solution</summary>
             <div class="statement">${esc(extras.solution)}</div></details>`
          : `<p class="dim">No solution in the archive for this one.</p>`;
      }
      if (window.MathJax?.typesetPromise) MathJax.typesetPromise([box]).catch(() => {});
    }
  });

  document.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "drillForm") return;
    ev.preventDefault();
    const p = current.problem;
    const correct = MathGen.check(p, el("drillAnswer").value);
    const fb = el("drillFeedback");
    fb.textContent = correct ? "Correct" : `Answer: ${p.answer}`;
    fb.className = `feedback ${correct ? "ok" : "no"}`;
    await record(correct ? (hintsShown ? "partial" : "solved") : "failed");
    setTimeout(next, correct ? 550 : 1500);
  });

  for (const id of ["studyDomain", "srcTextbook", "srcContest", "srcGenerated"]) {
    document.addEventListener("change", (e) => {
      if (e.target.id !== id) return;
      queue = [];
      next();
    });
  }

  window.Lattice.register("study", async () => {
    await renderAbility();
    await next();
  });
})();
