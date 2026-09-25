// The recommended study plan: warm-up, review, then work at your edge. Pure
// logic, so both the local server and the cloud API can build it; writing it
// into Cadence (lib/cadence.mjs) is the local-only part.
const SITE = (typeof process !== 'undefined' && process.env?.LATTICE_URL)
  || 'http://lattice.localhost';

/** A block is not a suggestion to go and find something: it is an exact set.
 *  The spec travels in the link, so pressing Start (here or in Cadence) puts
 *  Lattice into precisely that session — drills only, the due queue, or one
 *  field's books — rather than whatever the sidebar was last left on. */
export function studyUrl(session = {}) {
  const q = new URLSearchParams();
  q.set('kind', session.kind ?? 'study');
  for (const k of ['domains', 'books', 'skills']) {
    if (session[k]?.length) q.set(k, session[k].join(','));
  }
  if (session.count) q.set('count', String(session.count));
  if (session.label) q.set('label', session.label);
  return `${SITE}/#study|${q}`;
}

/** Normalise a hand-curated block into the same shape buildPlan produces, so a
 *  plan the user edited is exported exactly like a generated one. */
export function normalizeBlock(b, i = 0) {
  const minutes = Math.max(1, Math.round(Number(b.minutes ?? 10)));
  const session = {
    kind: b.kind ?? 'study',
    domains: b.domains ?? [],
    books: b.books ?? [],
    skills: b.skills ?? [],
    count: Number(b.count) || 0,
    label: b.title ?? '',
  };
  return {
    id: b.id ?? `lattice-block-${i + 1}`,
    duration: minutes * 60,
    tags: [session.kind === 'drill' ? 'drill' : session.kind === 'review' ? 'review' : 'study'],
    title: b.title ?? `${minutes} min`,
    body: b.body ?? '',
    session,
    url: studyUrl(session),
    target: session.count || undefined,
  };
}

/** Build the plan without writing it, so the UI can show the same thing.
 *  `blocks` overrides the recommendation entirely — a curated set wins. */
export function buildPlan({ due, weakest, ability, minutes = 45, blocks: custom }) {
  if (custom?.length) {
    const built = custom.map(normalizeBlock);
    return {
      minutes: Math.round(built.reduce((a, b) => a + b.duration, 0) / 60),
      blocks: built, field: weakest?.domain ?? null, due, ability, curated: true,
    };
  }
  const blocks = [];
  const warm = Math.max(5, Math.round(minutes * 0.15));
  const review = due > 0 ? Math.max(5, Math.round(minutes * 0.2)) : 0;
  const core = minutes - warm - review;

  const warmSession = { kind: 'drill', skills: [], count: warm * 3 };
  blocks.push({
    id: 'lattice-warmup', duration: warm * 60, tags: ['drill'],
    title: `Warm up — ${warm} min of mental math`,
    body: `${warm * 3} generated drills, auto-graded. Get the arithmetic moving `
      + 'before the hard problems.',
    session: warmSession,
    url: studyUrl({ ...warmSession, label: 'Warm up' }),
    target: warm * 3,
  });

  if (review) {
    const reviewSession = { kind: 'review', count: Math.min(due, review) };
    blocks.push({
      id: 'lattice-review', duration: review * 60, tags: ['review'],
      title: `Review — ${due} item${due === 1 ? '' : 's'} due`,
      body: 'Spaced repetition has these scheduled for today. They come first in the queue.',
      session: reviewSession,
      url: studyUrl({ ...reviewSession, label: 'Review' }),
      target: Math.min(due, review),
    });
  }

  const field = weakest?.domain ?? 'probability';
  const coreSession = {
    kind: 'study', domains: [field], count: Math.max(3, Math.round(core / 6)),
  };
  blocks.push({
    id: 'lattice-core', duration: core * 60, tags: ['study'],
    title: `${field} — ${core} min at your edge`,
    body: weakest?.rating
      ? `Rating ${weakest.rating} in ${field}; problems are picked around ${
          weakest.target_rating}, where you should solve roughly 85%.`
      : `No attempts in ${field} yet — the first few will calibrate it.`,
    session: coreSession,
    url: studyUrl({ ...coreSession, label: field }),
    target: coreSession.count,
  });

  return { minutes, blocks, field, due, ability };
}
