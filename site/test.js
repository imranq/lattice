// Test: a scored session, one problem at a time.
//
// Practice drills let you grind a single skill. A test does the opposite — it
// samples across what the graph says you are weakest at, mixes machine-gradable
// generated problems with real textbook exercises, and gives a score at the end.
//
// Generated problems are checked automatically. Textbook exercises cannot be
// (they are proofs), so those are self-graded — the honest split, rather than
// pretending a string match means anything for "Prove that a finite domain is a
// division ring".
(() => {
  const root = () => document.getElementById("testRoot");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let session = null;   // { items, index, results, startedAt }

  const get = (p) => fetch(`/api${p}`).then((r) => (r.ok ? r.json() : Promise.reject(
    new Error(`${p} → ${r.status}`))));

  async function buildSession({ length, mix }) {
    const [mastery, rec] = await Promise.all([
      get("/mastery").catch(() => []),
      get("/recommend?limit=10").catch(() => []),
    ]);

    const items = [];

    // Generated half: weakest skills first, then anything unseen, at the level the
    // practice page has you on.
    if (mix !== "textbook") {
      const skillMastery = new Map(mastery
        .filter((m) => m.concept_id.startsWith("skill:"))
        .map((m) => [m.concept_id.slice(6), m.mastery]));
      const skills = [...MathGen.SKILLS].sort((a, b) =>
        (skillMastery.get(a.id) ?? 0.5) - (skillMastery.get(b.id) ?? 0.5));
      let levels = {};
      try { levels = JSON.parse(localStorage.getItem("lattice_practice_v1")) || {}; } catch { /* */ }
      const want = mix === "generated" ? length : Math.ceil(length / 2);
      for (let i = 0; i < want; i++) {
        const s = skills[i % skills.length];
        items.push({ kind: "generated", problem: MathGen.generate(s.id, levels[s.id]?.level ?? 1) });
      }
    }

    // Textbook half: exercises from the concepts the recommender puts first.
    if (mix !== "generated") {
      const want = mix === "textbook" ? length : Math.floor(length / 2);
      for (const r of rec) {
        if (items.filter((i) => i.kind === "exercise").length >= want) break;
        const data = await get(
          `/exercises?concept=${encodeURIComponent(r.concept_id)}&unsolved=1&limit=3&sort=easy`
        ).catch(() => ({ items: [] }));
        for (const e of data.items) {
          if (items.filter((i) => i.kind === "exercise").length >= want) break;
          if (e.text) items.push({ kind: "exercise", exercise: e, concept: r.label });
        }
      }
    }

    // Interleave so a run of drills is not followed by a run of proofs.
    const gen = items.filter((i) => i.kind === "generated");
    const ex = items.filter((i) => i.kind === "exercise");
    const mixed = [];
    while (gen.length || ex.length) {
      if (gen.length) mixed.push(gen.shift());
      if (ex.length) mixed.push(ex.shift());
    }
    return { items: mixed.slice(0, length), index: 0, results: [], startedAt: Date.now() };
  }

  function setup() {
    root().innerHTML = `
      <div class="panel-heading standalone">
        <div><p class="eyebrow">SESSION</p><h2>Build a test</h2></div>
        <p class="panel-note">Questions are drawn from your weakest concepts. Generated
          problems are graded automatically; textbook exercises are self-graded, because
          no string match can mark a proof.</p>
      </div>
      <section class="panel test-setup">
        <label>Length
          <select id="testLength">
            <option value="6">6 questions</option>
            <option value="10" selected>10 questions</option>
            <option value="20">20 questions</option>
          </select>
        </label>
        <label>Mix
          <select id="testMix">
            <option value="both" selected>Generated + textbook</option>
            <option value="generated">Generated only</option>
            <option value="textbook">Textbook only</option>
          </select>
        </label>
        <button id="testStart" class="grade">Start test</button>
      </section>`;
  }

  function renderQuestion() {
    const item = session.items[session.index];
    const n = session.index + 1, total = session.items.length;
    if (!item) return renderResults();

    const head = `
      <div class="test-head">
        <span class="test-progress">Question ${n} of ${total}</span>
        <span class="test-track"><span style="width:${(n / total) * 100}%"></span></span>
        <button id="testQuit" class="ghost-btn" type="button">End</button>
      </div>`;

    if (item.kind === "generated") {
      root().innerHTML = `<section class="panel test-panel">${head}
        <p class="test-source">${esc(item.problem.skillName)} · level ${item.problem.level}</p>
        <p class="drill-prompt">${esc(item.problem.prompt)}</p>
        <form id="testForm" class="answer-row" autocomplete="off">
          <input id="testAnswer" type="text" placeholder="Answer" aria-label="Answer" />
          <button type="submit" class="grade">Submit</button>
          <button id="testSkip" type="button" class="ghost-btn">Skip</button>
        </form>
        <div id="testFeedback" class="feedback"></div></section>`;
      document.getElementById("testAnswer").focus();
    } else {
      const e = item.exercise;
      root().innerHTML = `<section class="panel test-panel">${head}
        <p class="test-source">${esc(item.concept ?? "")} · ${esc(e.cite)}
          <span class="p-tier tier-${esc(e.tier)}">${esc(e.tier)}</span></p>
        <div class="p-text">${esc(e.text)}</div>
        <p class="panel-note">Work it out, then say how it went.</p>
        <div class="p-actions">
          <button class="grade" data-self="solved">Solved</button>
          <button class="grade" data-self="partial">Partial</button>
          <button class="grade" data-self="failed">Failed</button>
        </div></section>`;
      if (window.MathJax?.typesetPromise) MathJax.typesetPromise([root()]).catch(() => {});
    }
  }

  async function record(item, outcome, correct) {
    session.results.push({ item, outcome, correct });
    const body = item.kind === "generated"
      ? { item_id: `drill:${item.problem.skill}:L${item.problem.level}:${item.problem.seed}`,
          item_type: "drill", concept_id: `skill:${item.problem.skill}`, outcome }
      : { item_id: item.exercise.id, item_type: "exercise",
          concept_id: item.exercise.concept_id, outcome };
    await fetch("/api/attempt", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  function next() {
    session.index += 1;
    if (session.index >= session.items.length) renderResults();
    else renderQuestion();
  }

  function renderResults() {
    const right = session.results.filter((r) => r.correct === true).length;
    const graded = session.results.filter((r) => r.correct !== null).length;
    const selfSolved = session.results.filter(
      (r) => r.item.kind === "exercise" && r.outcome === "solved").length;
    const exercises = session.results.filter((r) => r.item.kind === "exercise").length;
    const minutes = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));

    root().innerHTML = `
      <section class="panel test-results">
        <div class="panel-heading"><div><p class="eyebrow">RESULT</p><h2>Test complete</h2></div></div>
        <div class="stat-row">
          <div class="stat-tile"><b>${graded ? Math.round((right / graded) * 100) : 0}%</b>
            <span>Auto-graded</span></div>
          <div class="stat-tile"><b>${right}/${graded}</b><span>Generated correct</span></div>
          <div class="stat-tile"><b>${selfSolved}/${exercises}</b><span>Exercises solved</span></div>
          <div class="stat-tile"><b>${minutes}</b><span>Minutes</span></div>
        </div>
        <ol class="test-review">${session.results.map((r) => {
          const label = r.item.kind === "generated"
            ? `${esc(r.item.problem.skillName)} — ${esc(r.item.problem.prompt)}`
            : `${esc(r.item.concept ?? "")} — ${esc(r.item.exercise.cite)}`;
          const mark = r.correct === true ? "✓" : r.correct === false ? "✗" : "·";
          return `<li class="mark-${r.outcome}"><span class="mark">${mark}</span> ${label}
            ${r.item.kind === "generated" && r.correct === false
              ? `<span class="dim">answer ${esc(r.item.problem.answer)}</span>` : ""}</li>`;
        }).join("")}</ol>
        <div class="p-actions">
          <button id="testAgain" class="grade">New test</button>
          <button id="testStats" class="ghost-btn">See stats</button>
        </div>
      </section>`;
  }

  root() && document.addEventListener("click", async (ev) => {
    if (!window.Lattice.visible("test")) return;
    if (ev.target.closest("#testStart")) {
      const length = Number(document.getElementById("testLength").value);
      const mix = document.getElementById("testMix").value;
      root().innerHTML = `<section class="panel"><p class="dim">Building a test from your
        weakest concepts…</p></section>`;
      session = await buildSession({ length, mix });
      if (!session.items.length) {
        root().innerHTML = `<section class="panel"><p class="dim">Not enough material yet —
          the graph needs readable exercises or a drill or two first.</p></section>`;
        return;
      }
      renderQuestion();
    }
    if (ev.target.closest("#testQuit")) { session ? renderResults() : setup(); }
    if (ev.target.closest("#testAgain")) setup();
    if (ev.target.closest("#testStats")) location.hash = "progress";
    if (ev.target.closest("#testSkip")) {
      await record(session.items[session.index], "skipped", null);
      next();
    }
    const self = ev.target.closest("[data-self]");
    if (self) {
      await record(session.items[session.index], self.dataset.self, null);
      next();
    }
  });

  document.addEventListener("submit", async (ev) => {
    if (ev.target.id !== "testForm") return;
    ev.preventDefault();
    const item = session.items[session.index];
    const given = document.getElementById("testAnswer").value;
    const correct = MathGen.check(item.problem, given);
    await record(item, correct ? "solved" : "failed", correct);
    const fb = document.getElementById("testFeedback");
    fb.textContent = correct ? "Correct" : `Answer: ${item.problem.answer}`;
    fb.className = `feedback ${correct ? "ok" : "no"}`;
    setTimeout(next, correct ? 500 : 1400);
  });

  window.Lattice.register("test", setup);
})();
