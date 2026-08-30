// Lattice → Cadence.
//
// Cadence runs timed card sequences: "an agent writes the files; you press play".
// Lattice knows what you should study and for how long, so it writes the file.
// A `render: "site"` card opens Lattice itself, already filtered, for a fixed
// block of time — the schedule lives in Cadence, the choice of problems here.
import { writeFile, mkdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CADENCE = process.env.CADENCE_DIR ?? join(homedir(), 'projects', 'cadence');
const SESSION_ID = 'lattice-today';

const card = ({ id, duration, title, body, url, target, tags = [] }) => ({
  id,
  render: url ? 'site' : 'text',
  ends: 'timed',
  duration,
  measure: target ? { kind: 'count', target } : { kind: 'elapsed' },
  confirm: false,
  tags,
  payload: url
    ? { task: title, description: body, url, title: 'Lattice',
        activityApp: 'lattice', activityKind: 'attempt', launch: true }
    : { title, body },
  cues: [{ at: 'start', sound: 'start' }, { at: 'end', sound: 'next' }],
});

/** Build the plan without writing it, so the UI can show the same thing. */
export function buildPlan({ due, weakest, ability, minutes = 45 }) {
  const blocks = [];
  const warm = Math.max(5, Math.round(minutes * 0.15));
  const review = due > 0 ? Math.max(5, Math.round(minutes * 0.2)) : 0;
  const core = minutes - warm - review;

  blocks.push({
    id: 'lattice-warmup', duration: warm * 60, tags: ['drill'],
    title: `Warm up — ${warm} min of mental math`,
    body: 'Generated drills only. Get the arithmetic moving before the hard problems.',
    url: 'http://lattice.localhost/#study',
    target: warm * 3,
  });

  if (review) {
    blocks.push({
      id: 'lattice-review', duration: review * 60, tags: ['review'],
      title: `Review — ${due} item${due === 1 ? '' : 's'} due`,
      body: 'Spaced repetition has these scheduled for today. They come first in the queue.',
      url: 'http://lattice.localhost/#study',
      target: Math.min(due, review),
    });
  }

  const field = weakest?.domain ?? 'probability';
  blocks.push({
    id: 'lattice-core', duration: core * 60, tags: ['study'],
    title: `${field} — ${core} min at your edge`,
    body: weakest?.rating
      ? `Rating ${weakest.rating} in ${field}; problems are picked around ${
          weakest.target_rating}, where you should solve roughly 85%.`
      : `No attempts in ${field} yet — the first few will calibrate it.`,
    url: 'http://lattice.localhost/#study',
    target: Math.max(3, Math.round(core / 6)),
  });

  return { minutes, blocks, field, due, ability };
}

export async function writeSession(plan) {
  const dir = join(CADENCE, 'content', 'sessions');
  await access(join(CADENCE, 'content'));   // throws if Cadence is not there
  await mkdir(dir, { recursive: true });

  const session = {
    kind: 'session',
    id: SESSION_ID,
    title: `Lattice — ${plan.minutes} minutes, ${plan.field} at the edge`,
    note: 'Written by Lattice from the current concept graph and attempt history. '
      + 'Regenerate it whenever your ratings move.',
    root: {
      id: 'root',
      driver: 'sequence',
      children: plan.blocks.map(card),
    },
  };
  const path = join(dir, `${SESSION_ID}.json`);
  await writeFile(path, `${JSON.stringify(session, null, 1)}\n`);
  return { path, session_id: SESSION_ID, url: `http://cadence.localhost/#${SESSION_ID}` };
}
