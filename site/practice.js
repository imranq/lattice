// Levelled drill practice over the generators.
//
// Progression is Khan-style but stricter: three correct in a row moves you up a
// level, two wrong in a row moves you down. Level is per-skill and persists, so
// the drill resumes where you left it rather than restarting at trivial.
//
// Every graded answer is posted to /api/attempt as a `drill`, keyed to the skill
// as its concept — so generated practice feeds the same mastery estimate and
// spaced-repetition schedule as textbook exercises and bank problems.
(() => {
  const LS_KEY = "lattice_practice_v1";
  const UP_STREAK = 3;
  const DOWN_STREAK = 2;

  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let state = load();
  let current = null;      // { problem, startedAt, revealed }
  let skillId = null;
  let correctRun = 0, wrongRun = 0;

  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }
  const forSkill = (id) => (state[id] ??= { level: 1, correct: 0, attempts: 0, best: 1 });

  async function postAttempt(problem, outcome, seconds, revealed) {
    // Fire and forget: the drill must keep working with the API down.
    try {
      await fetch("/api/attempt", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: `drill:${problem.skill}:L${problem.level}:${problem.seed}`,
          item_type: "drill",
          concept_id: `skill:${problem.skill}`,
          outcome, seconds: Math.round(seconds),
          hints_used: revealed ? 1 : 0,
        }),
      });
    } catch { /* offline */ }
  }

  // ---- skill grid ----------------------------------------------------------

  function renderGrid() {
    el("drill").hidden = true;
    const grid = el("skillGrid");
    grid.hidden = false;
    grid.innerHTML = MathGen.SKILLS.map((s) => {
      const st = state[s.id] ?? { level: 1, correct: 0, attempts: 0 };
      const pct = st.attempts ? Math.round((st.correct / st.attempts) * 100) : null;
      return `
        <button class="skill-card" data-skill="${s.id}">
          <span class="skill-top">
            <span class="skill-name">${esc(s.name)}</span>
            <span class="level-chip">L${st.level}</span>
          </span>
          <span class="skill-blurb">${esc(s.blurb)}</span>
          <span class="skill-foot">
            <span class="skill-domain">${esc(s.domain)}</span>
            ${pct === null ? '<span class="skill-stat">new</span>'
              : `<span class="skill-stat">${pct}% of ${st.attempts}</span>`}
          </span>
        </button>`;
    }).join("");
  }

  // ---- drilling ------------------------------------------------------------

  function nextProblem() {
    const st = forSkill(skillId);
    current = {
      problem: MathGen.generate(skillId, st.level),
      startedAt: performance.now(),
      revealed: false,
    };
    el("prompt").textContent = current.problem.prompt;
    el("answer").value = "";
    el("answer").disabled = false;
    el("feedback").textContent = "";
    el("feedback").className = "feedback";
    el("work").hidden = true;
    el("trick").textContent = "";
    el("drillLevel").textContent = `Level ${st.level}`;
    el("drillStreak").textContent = correctRun ? `${correctRun} in a row` : "";
    el("levelFill").style.width = `${(st.level / 5) * 100}%`;
    el("answer").focus();
  }

  function showWork(problem) {
    el("work").hidden = false;
    el("work").innerHTML =
      `<ol class="work-steps">${problem.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`;
    el("trick").textContent = problem.trick ? `Trick: ${problem.trick}` : "";
  }

  function grade(raw) {
    if (!current) return;
    const { problem, startedAt, revealed } = current;
    const seconds = (performance.now() - startedAt) / 1000;
    const right = MathGen.check(problem, raw);
    const st = forSkill(skillId);

    st.attempts += 1;
    if (right) st.correct += 1;
    const fb = el("feedback");

    if (right) {
      correctRun += 1; wrongRun = 0;
      fb.textContent = revealed ? "Correct — but you looked." : "Correct";
      fb.className = "feedback ok";
      postAttempt(problem, revealed ? "partial" : "solved", seconds, revealed);
      if (!revealed && correctRun >= UP_STREAK && st.level < 5) {
        st.level += 1; st.best = Math.max(st.best, st.level); correctRun = 0;
        fb.textContent = `Correct — level ${st.level}`;
      }
      save();
      el("answer").disabled = true;
      setTimeout(nextProblem, 650);
    } else {
      wrongRun += 1; correctRun = 0;
      fb.innerHTML = `Not quite — answer was <b>${esc(problem.answer)}</b>`;
      fb.className = "feedback no";
      showWork(problem);
      postAttempt(problem, "failed", seconds, revealed);
      if (wrongRun >= DOWN_STREAK && st.level > 1) {
        st.level -= 1; wrongRun = 0;
        fb.innerHTML += ` · back to level ${st.level}`;
      }
      save();
      el("drillStreak").textContent = "";
    }
  }

  function openSkill(id, push = true) {
    if (!MathGen.SKILLS.some((s) => s.id === id)) return renderGrid();
    skillId = id;
    // The hash makes a drill linkable: practice.html#multiply opens it directly.
    if (push && location.hash.slice(1) !== id) location.hash = id;
    correctRun = 0; wrongRun = 0;
    const s = MathGen.SKILLS.find((x) => x.id === id);
    el("skillGrid").hidden = true;
    el("drill").hidden = false;
    el("drillName").textContent = s.name;
    nextProblem();
  }

  // ---- wiring --------------------------------------------------------------

  document.addEventListener("click", (e) => {
    const card = e.target.closest(".skill-card");
    if (card) openSkill(card.dataset.skill);
    if (e.target.closest("#drillBack")) { skillId = null; location.hash = ""; renderGrid(); }
    if (e.target.closest("#skipBtn") && current) {
      postAttempt(current.problem, "skipped", 0, false);
      correctRun = 0;
      nextProblem();
    }
    if (e.target.closest("#showBtn") && current) {
      current.revealed = true;
      showWork(current.problem);
    }
  });

  el("answerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (el("answer").disabled) return;
    grade(el("answer").value);
  });

  function route() {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) openSkill(id, false);
    else { skillId = null; renderGrid(); }
  }
  window.addEventListener("hashchange", route);
  route();
})();
