// Marking the problems that do not need a model.
//
// A large part of the corpus asks for a value, not an argument. "From a deck of
// five cards numbered 2, 4, 6, 8 and 10 … what is the probability that the card
// numbered 2 was drawn exactly two times, given that the sum is 12?" has one
// right answer, and comparing a learner's "30%" against it is string handling,
// not judgement. Sending it to a language model is slower, costs money, and is
// *less* reliable than `===`.
//
// So the routing rule is: if we hold an exact answer, mark it here and stop. The
// grader in lib/jev.mjs exists for proofs, which is where reading an argument is
// genuinely the task.
//
// 11,370 of the 15,476 exercises in the graph (73%) carry a boxed answer from the
// MATH dataset, so this path covers most of what gets served.

/** Normalise an answer for comparison.
 *
 *  The hard part is that two people write the same number differently, and none
 *  of the differences are mathematical: `\dfrac{1}{2}`, `\frac12`, `1/2` and
 *  `0.5` are one answer. This strips the presentation and leaves the claim.
 *  It is deliberately conservative — it never rearranges an expression, because
 *  deciding that `x+1` and `1+x` agree is algebra, and algebra belongs to a CAS
 *  or to a person, not to a regex. */
export function normalise(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  s = s
    .replace(/\$+/g, '')                       // TeX delimiters
    .replace(/\\(?:left|right|!|,|;|:|quad|qquad)/g, '')
    .replace(/\\text\s*\{([^}]*)\}/g, '$1')    // \text{ cm} -> cm
    .replace(/\\mbox\s*\{([^}]*)\}/g, '$1')
    .replace(/\\d?frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, '($1)/($2)')
    .replace(/\\d?frac\s*(\d)\s*(\d)/g, '($1)/($2)')   // \frac12
    .replace(/\\[a-zA-Z]+/g, '')               // any surviving command
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '')
    .replace(/−/g, '-')                   // unicode minus
    .replace(/[%]/g, '')                       // "30%" and "30" are one claim here
    .replace(/,(?=\d{3}\b)/g, '')              // 1,000 -> 1000
    .toLowerCase();

  // A bare trailing period is punctuation, not part of the value.
  s = s.replace(/\.$/, '');
  return s || null;
}

/** Numeric value of a normalised answer, if it has one. Handles the two forms
 *  that actually turn up: a plain decimal, and a single fraction. */
function numeric(s) {
  if (s === null) return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const frac = s.match(/^\(?(-?\d+(?:\.\d+)?)\)?\/\(?(-?\d+(?:\.\d+)?)\)?$/);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? null : Number(frac[1]) / d;
  }
  return null;
}

// Two numbers agree if they agree to within this relative slack. A learner who
// writes 0.333 for 1/3 has the right answer; one who writes 0.3 does not.
// Human answers are often rounded to the precision shown by the problem. A
// fixed 1e-4 rejected sensible entries such as 0.333 for 1/3 and 1.386 for
// -ln(0.25)=1.3863. Keep the tolerance tight, but permit ordinary rounding.
const TOLERANCE = 1e-3;

/**
 * Mark an attempt against a stored answer.
 *
 * Returns `null` when we cannot decide — no stored answer, or nothing written —
 * and the caller must treat that as "no opinion" exactly as it does for the
 * model grader. Never guesses: an undecidable comparison is not a failure.
 */
export function checkAnswer(given, expected) {
  const g = normalise(given);
  const e = normalise(expected);
  if (g === null || e === null) return null;

  if (g === e) return { correct: true, how: 'exact' };

  const gn = numeric(g);
  const en = numeric(e);
  if (gn !== null && en !== null) {
    const scale = Math.max(1, Math.abs(en));
    if (Math.abs(gn - en) <= TOLERANCE * scale) return { correct: true, how: 'numeric' };
    // A percentage written as a percentage against an answer stored as a
    // fraction, or the reverse. Common enough to be worth catching, and
    // unambiguous in both directions.
    if (Math.abs(gn / 100 - en) <= TOLERANCE * Math.max(1, Math.abs(en))) {
      return { correct: true, how: 'percent' };
    }
    if (Math.abs(gn - en * 100) <= TOLERANCE * Math.max(1, Math.abs(en * 100))) {
      return { correct: true, how: 'percent' };
    }
    return { correct: false, how: 'numeric' };
  }

  // The learner wrote prose around the value — "the answer is 3/8". Pull out a
  // final value and compare that, rather than failing them on their phrasing.
  const tail = g.match(/(-?\(?\d+(?:\.\d+)?\)?(?:\/\(?-?\d+(?:\.\d+)?\)?)?)$/);
  if (tail) {
    const tn = numeric(tail[1]);
    if (tn !== null && en !== null
        && Math.abs(tn - en) <= TOLERANCE * Math.max(1, Math.abs(en))) {
      return { correct: true, how: 'trailing-value' };
    }
  }

  return { correct: false, how: 'string' };
}

/** The outcome to log, in the vocabulary `recordAttempt` already speaks.
 *  There is no `partial` here on purpose: an exact answer is right or it is not,
 *  and inventing a middle would be pretending to a judgement we did not make. */
export function outcomeFor(result) {
  if (!result) return null;
  return result.correct ? 'solved' : 'failed';
}
