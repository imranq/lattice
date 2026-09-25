// Lattice → Cadence.
//
// Cadence runs timed card sequences: "an agent writes the files; you press play".
// Lattice knows what you should study and for how long, so it writes the file.
// A `render: "site"` card opens Lattice itself, already filtered, for a fixed
// block of time — the schedule lives in Cadence, the choice of problems here.
import { writeFile, mkdir, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildPlan, normalizeBlock, studyUrl } from './plan.mjs';

export { buildPlan, normalizeBlock, studyUrl };

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
