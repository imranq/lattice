// Append to the machine-wide activity log.
//
// One append-only file that every local app writes to, so anything can ask "what
// happened between these two timestamps?". Cadence reads it to measure a block it
// cannot watch: a 20-minute Lattice card is whatever Lattice recorded in that
// window. No integration between the two apps — they share a file and a clock.
//
//   ~/.local/share/activity/events.jsonl        (override with $ACTIVITY_LOG)
//
// Reimplemented here rather than imported across projects, as Switchboard's own
// README suggests: it is nine lines, and a relative path into a sibling checkout
// would make Lattice fail to boot whenever that checkout moved.
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const ACTIVITY_LOG = process.env.ACTIVITY_LOG
  ?? join(homedir(), '.local', 'share', 'activity', 'events.jsonl');

let warned = false;

export async function appendActivity(event) {
  if (!event?.app || !event?.kind) return;
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    await mkdir(dirname(ACTIVITY_LOG), { recursive: true });
    // O_APPEND: concurrent writers from different apps interleave safely, no lock.
    await appendFile(ACTIVITY_LOG, `${line}\n`);
  } catch (err) {
    // The log is a convenience for other apps; never fail an attempt over it.
    if (!warned) {
      console.warn(`activity log unavailable (${err.code ?? err.message})`);
      warned = true;
    }
  }
}
