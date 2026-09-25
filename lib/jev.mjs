// A second opinion on an attempt, from a model that only returns typed values.
//
// Every number in Lattice descends from a button the learner pressed about their
// own work. Self-grading is optimistic exactly where it matters most, and it
// cannot tell "right answer, broken proof" from "right".
//
// Jev (TypeSafe's System One model) answers a fixed set of typed questions about
// a state in ~400ms and cannot return anything outside the shape we asked for.
// That makes it usable as a *shadow* grader: it writes its opinion next to the
// learner's mark and changes nothing. Whether it is good enough to ever overrule
// the learner is a question for the data it is collecting, not for this file.
//   https://docs.typesafe.ai/primitives
//
// Measured on a 14-case pilot (features/jev_investigation.md): 12/14 three-way
// agreement, and the `correct` noul separated cleanly — 0.92-0.98 on correct
// attempts against 0.02-0.24 on wrong ones. That is a pilot, not a benchmark.

const URL_ = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';
const USER_AGENT = 'lattice/jev-client (https://github.com/imranqureshi/lattice)';

// Grading sits off the request path — the learner has already been shown their
// next problem by the time this returns. A slow call costs nothing but a late
// row; a hanging one would leak a socket, so it is bounded.
const TIMEOUT_MS = 20_000;

// `.env` is gitignored and holds the key. Node loads it for us; a missing file
// is not an error, it just means grading stays off.
try { process.loadEnvFile?.(); } catch { /* no .env - grading disabled */ }

export const jevEnabled = () => Boolean(process.env.TYPESAFE_API_KEY);

/** One request, one state, many independent questions. Returns null on any
 *  failure: a grader that throws would take an attempt down with it, and the
 *  attempt is the thing that actually matters. */
export async function systemOne(state, questions) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({ model: MODEL, state, questions }),
    });
    if (!res.ok) {
      console.warn(`jev: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`jev: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---- grading ---------------------------------------------------------------

// The decomposition matters more than the wording. A single "grade this" question
// would hide the reasoning we actually want: whether the *method* was right is a
// different fact from whether the *execution* was, and a learner who picked the
// right approach and slipped on algebra needs the opposite response from one who
// picked the wrong approach and executed it perfectly. So they are asked apart
// and combined below, in code, where the policy is visible and changeable.
const GAPS = {
  'nothing — it is correct': null,
  'circular, or assumes what is to be proved': null,
  'verified examples instead of proving the general case': null,
  'an arithmetic or algebraic slip': null,
  'a wrong theorem or wrong formula was applied': null,
  'the argument stops before the conclusion': null,
  'a case or a condition is missing': null,
  'the answer is asserted with no working shown': null,
};

// These are deliberately typed classifications rather than a request for prose.
// Jev is strongest when it makes several small judgements; Lattice composes them
// into feedback that is stable, actionable, and easy to improve without parsing
// model-written text.
const STRENGTHS = {
  'no usable work shown': null,
  'the answer is correct and complete': null,
  'the main method is appropriate': null,
  'the setup or definitions are correct': null,
  'the computation is correct so far': null,
  'some relevant progress, but the method is not yet valid': null,
};

const NEXT_STEPS = {
  'show the relevant formula or theorem': null,
  'define the variables and dimensions': null,
  'substitute the given values carefully': null,
  'check the arithmetic or algebra': null,
  'handle the missing case or condition': null,
  'carry the argument through to a conclusion': null,
  'write the reasoning, not only the final answer': null,
  'nothing — the solution is complete': null,
};

const QUESTIONS = {
  correct: {
    type: 'noul',
    instructions: "Is the student's attempt a correct and complete solution to the problem?",
    criteria: {
      true: 'The reasoning is valid and reaches the required conclusion with no gap that '
          + 'changes the result.',
      false: 'There is a logical error, an unjustified step that carries the argument, or '
           + 'the conclusion is never reached.',
    },
  },
  right_idea: {
    type: 'noul',
    instructions: 'Does the attempt use a method that would work if it were carried out '
                + 'properly, even if this execution is flawed?',
  },
  grade: {
    type: 'score',
    instructions: 'How much of this problem has the student actually solved?',
    criteria: [
      'nothing usable, or the method is fundamentally wrong',
      'the right method is identified but the argument does not get there',
      'essentially right, with a gap or an unjustified step',
      'a complete and correct solution',
    ],
  },
  gap: {
    type: 'choice',
    instructions: 'What is the main thing wrong with the attempt?',
    criteria: GAPS,
  },
  strength: {
    type: 'choice',
    instructions: 'What is the strongest useful part of the student attempt? Choose '
                + 'the most specific description supported by the work shown.',
    criteria: STRENGTHS,
  },
  next_step: {
    type: 'choice',
    instructions: 'What single next step would most help the student turn this attempt '
                + 'into a correct solution? Choose the most actionable missing step.',
    criteria: NEXT_STEPS,
  },
  // The two that earn their place by feeding something Lattice already computes.
  // `prereq_gap` is the signal `weakEdges` currently has to *infer* from a pattern
  // across many attempts; here it can be read off a single failure.
  prereq_gap: {
    type: 'noul',
    instructions: 'Does the error indicate a missing prerequisite from earlier material, '
                + 'rather than a slip within the concept this problem is about?',
  },
  // `ability.mjs` drops skipped attempts because a skip carries no information.
  // It carries some: stopping because you were stuck is not stopping because you
  // ran out of patience.
  stuck: {
    type: 'noul',
    instructions: 'Did the student stop because they did not know how to proceed, rather '
                + 'than because they ran out of time or patience?',
  },
};

// Six questions in one round trip. Measured: question count is very nearly free
// in latency (1 question 352ms, 61 questions 356ms) and linear in tokens, so the
// shape to aim for is one request per state with everything worth knowing on it.
const GRADE_LEVELS = 3;   // score runs 0..3 over the four criteria above

// Where "solved" begins, and how decided an answer has to be before we record an
// opinion at all. Both numbers are measured, not chosen, and the measurement is
// worth writing down because the obvious guess is wrong.
//
// On 36 Putnam cases with objective ground truth (the official solution as the
// attempt, a 40% truncation of it, and a different problem's solution), grading
// *with* the reference put verbatim-correct solutions at 0.43-0.88 and incomplete
// ones at 0.03-0.46. So the populations separate a little above 0.5 — not at the
// 0.85 an elementary-problem pilot suggested. A threshold set from easy problems
// would have marked most correct Putnam work as unsolved, which is precisely the
// false-failed error this whole design is trying to avoid.
//
// These still only cover two populations. Refit them from the shadow log before
// anything is allowed to act on them.
const SOLVED_AT = 0.55;
const DECIDED_BY = 0.20;   // |P(correct) - 0.5|; below this the grader abstains

/** Grade one attempt. `null` means "no opinion" — no key, no answer, or the call
 *  failed — and every caller must treat that as ordinary.
 *
 *  `reference` is the published solution where Lattice holds one. It is worth
 *  passing: on the 36-case set above, accuracy went 25/36 without it to 31/36
 *  with it, and mean P(correct) on genuinely correct work rose 0.547 -> 0.710,
 *  while truncated attempts stayed flat (0.128 -> 0.142) and mismatched ones fell
 *  (0.036 -> 0.015). It sharpens the judgement rather than biasing it toward
 *  agreement. Costs ~600 extra input tokens and no measurable latency. */
export async function gradeAttempt({ problem, answer, concept, seconds, hints, reference }) {
  if (!jevEnabled()) return null;
  if (!problem || !answer || answer.trim().length < 2) return null;

  const state = {
    problem,
    concept: concept ?? null,
    student_attempt: answer,
    time_spent_seconds: seconds ?? null,
    hints_revealed: hints ?? 0,
  };
  // Only when we actually hold one — Lattice has solution text for 372 Putnam
  // problems and for no textbook exercise at all. An absent key is better than a
  // null one: there is nothing for the model to read into its absence.
  if (reference) state.official_solution = reference;

  const res = await systemOne(state, QUESTIONS);
  if (!res?.answers) return null;

  const a = res.answers;
  const correct = a.correct.noul;
  const score = a.grade.score;

  // The policy, in one place, so it can be argued with. Conservative on the
  // failure side: calling a correct proof wrong is the error that makes someone
  // stop trusting the product, and spaced repetition already catches the opposite
  // mistake by asking again.
  const outcome = correct > SOLVED_AT ? 'solved'
    : score >= 1.2 ? 'partial'
    : a.right_idea.noul > 0.6 ? 'partial'
    : 'failed';

  // Stable learner-facing bands. The underlying scores stay continuous for
  // calibration, but the product should not expose a new prose judgement on
  // every answer. A/B/C/D is compact enough for tests and descriptive enough
  // for practice feedback.
  const band = correct > 0.75 && score >= 2.5
    ? { code: 'A', key: 'correct', label: 'Correct' }
    : score >= 1.8 || (correct > 0.45 && a.right_idea.noul > 0.6)
      ? { code: 'B', key: 'almost_there', label: 'Almost there' }
      : a.right_idea.noul > 0.6
        ? { code: 'C', key: 'right_idea', label: 'Right idea, incomplete' }
        : { code: 'D', key: 'incorrect', label: 'Not yet' };

  // Abstain unless the model is both decided and internally consistent. A `grade`
  // spread across levels, or a `correct` sitting near 0.5, is the model saying it
  // cannot tell — and an undecided grader should say nothing rather than guess.
  // The aggregate score-confidence is not the only useful confidence signal.
  // Short, clearly wrong answers often produce a low-confidence score band
  // while Jev is very sure both that the answer is wrong and what the gap is
  // (for example, "probably O(n)" for a pooling-cost derivation). Do not make
  // those learners self-grade just because one auxiliary question was unsure.
  const clearlyWrong = correct <= 0.30 && a.gap.confidence >= 0.80;
  const confident = clearlyWrong
    || (a.grade.confidence > 0.6 && Math.abs(correct - 0.5) > DECIDED_BY);

  return {
    outcome,
    band: band.code,
    band_key: band.key,
    band_label: band.label,
    confident,
    // Graded-with-reference and graded-blind are different tasks with different
    // calibration. Pooling them would hide that, so the log keeps them apart.
    has_reference: Boolean(reference),
    correct: +correct.toFixed(3),
    right_idea: +a.right_idea.noul.toFixed(3),
    score: +(score / GRADE_LEVELS).toFixed(3),     // normalised 0..1 for storage
    grade_confidence: +a.grade.confidence.toFixed(3),
    gap: a.gap.choice,
    gap_confidence: +a.gap.confidence.toFixed(3),
    strength: a.strength?.choice ?? null,
    strength_confidence: +(a.strength?.confidence ?? 0).toFixed(3),
    next_step: a.next_step?.choice ?? null,
    next_step_confidence: +(a.next_step?.confidence ?? 0).toFixed(3),
    prereq_gap: +a.prereq_gap.noul.toFixed(3),
    stuck: +a.stuck.noul.toFixed(3),
    model: res.model,
    input_tokens: res.usage?.input_tokens ?? null,
  };
}

// ---- turning a sentence into a practice set --------------------------------

// Jev never touches the corpus for this. It reads *the request* — one call,
// measured at ~370ms and $0.000043 — and ordinary SQL does the filtering against
// the tags computed once by scripts/tag_exercises_jev.py. Asking it to score
// 4,104 exercises per query would cost ~$0.12 and minutes of wall time for every
// press of the button, which is not a feature, it is a bill.
//
// Measured on five phrasings: it recovers the difficulty adverb ("easy" -> 0.08,
// "harder" -> 2.00 on a 0-3 scale), the time budget ("15 minutes" -> 0.46), the
// negation ("not computation" -> proofs), and the one that earns its place —
// "the stuff I keep getting wrong" -> target_weakness 0.58, which is the branch
// that tells the caller to ignore the named topic and hand over to `frontier`.

const DIFFICULTY_OFFSETS = [-200, 0, 200, 400];   // matches ability.mjs RUNGS
const SET_SIZES = [5, 12, 25];

/** Parse a practice request. `vocabulary` is the tag list to match against and
 *  `domains` the fields in the graph; both come from the corpus so the answer is
 *  already in the terms the query layer speaks. */
export async function parsePracticeRequest(text, {
  vocabulary = [], domains = [], skills = [],
} = {}) {
  if (!jevEnabled() || !text?.trim()) return null;

  const questions = {};
  for (const t of vocabulary) {
    questions[`want:${t}`] = {
      type: 'noul',
      instructions: `Is the learner asking to practise ${t}?`,
    };
  }
  for (const d of domains) {
    questions[`field:${d}`] = {
      type: 'noul',
      instructions: `Is the learner asking to practise ${d}?`,
    };
  }
  for (const s of skills) {
    questions[`skill:${s.id}`] = {
      type: 'noul',
      instructions: `Is the learner asking for generated mental-math drills in the skill "${s.name}"? `
        + `Treat the skill name, id, and common abbreviations as matches.`,
    };
  }
  Object.assign(questions, {
    difficulty: {
      type: 'score',
      instructions: 'What difficulty is the learner asking for, relative to where they '
                  + 'currently are?',
      criteria: [
        'easier than their current level — consolidation, or a way back in',
        'at their current level',
        'harder than their current level',
        'contest pace, where failing is the normal outcome',
      ],
    },
    length: {
      type: 'score',
      instructions: 'How long a session is the learner asking for?',
      criteria: ['a few minutes', 'a normal session', 'a long deliberate session'],
    },
    kind: {
      type: 'choice',
      instructions: 'What kind of problems does the learner want?',
      criteria: { proofs: null, computations: null, either: null },
    },
    // The branch that makes this more than a search box.
    needs_weakness: {
      type: 'noul',
      instructions: 'Is the learner asking to target their own weak areas specifically, '
                  + 'rather than a topic they named themselves?',
    },
    wants_review: {
      type: 'noul',
      instructions: 'Is the learner asking to revisit material they have already studied, '
                  + 'rather than to start something new?',
    },
    // Asked so the caller can decline rather than silently returning the generic
    // queue. Worded to catch nonsense only — an earlier phrasing ("is this a
    // request to practise mathematics") rejected "something short and easy, I
    // only have 15 minutes", which is a perfectly ordinary thing to type into a
    // practice box and simply names no topic. Naming no subject is not the same
    // as not being a request.
    is_practice_request: {
      type: 'noul',
      instructions: 'The learner typed this into a box that builds a practice session. Could '
                  + 'it plausibly be a description of what they want to work on — including '
                  + 'requests that only mention time, difficulty, or how they feel, and name '
                  + 'no subject at all?',
      criteria: {
        true: 'Any description of a session they want, however vague.',
        false: 'Unrelated chatter, a question about something else, or nonsense.',
      },
    },
  });

  const res = await systemOne({
    learner_request: text,
    routing_rule: 'Prefer a generated drill skill when the request explicitly asks for mental math, speed practice, or a named arithmetic skill. Prefer corpus tags/domains for conceptual study.',
    available_generated_skills: skills.map((s) => ({ id: s.id, name: s.name, domain: s.domain })),
  }, questions);
  if (!res?.answers) return null;
  const a = res.answers;

  const above = (prefix, at = 0.6) => Object.entries(a)
    .filter(([k, v]) => k.startsWith(prefix) && v.noul > at)
    .sort((x, y) => y[1].noul - x[1].noul)
    .map(([k, v]) => ({ name: k.slice(prefix.length), p: +v.noul.toFixed(3) }));
  const skillAnswers = Object.entries(a)
    .filter(([k, v]) => k.startsWith('skill:') && v.noul > 0.6)
    .sort((x, y) => y[1].noul - x[1].noul)
    .map(([k, v]) => ({ id: k.slice('skill:'.length), p: +v.noul.toFixed(3) }));

  const difficulty = Math.round(a.difficulty.score);
  const length = Math.round(a.length.score);

  return {
    understood: a.is_practice_request.noul > 0.5,
    tags: above('want:'),
    skills: skillAnswers,
    domains: above('field:'),
    kind: a.kind.choice,
    kind_confidence: +a.kind.confidence.toFixed(3),
    difficulty_level: difficulty,
    // The offset `suggest` already takes, so nothing downstream needs to learn a
    // new vocabulary for "harder".
    offset: DIFFICULTY_OFFSETS[Math.min(difficulty, 3)],
    length_level: length,
    count: SET_SIZES[Math.min(length, 2)],
    needs_weakness: +a.needs_weakness.noul.toFixed(3),
    wants_review: +a.wants_review.noul.toFixed(3),
    input_tokens: res.usage?.input_tokens ?? null,
  };
}
