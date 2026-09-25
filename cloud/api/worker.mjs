// Lattice in the cloud. One Durable Object per learner holds that learner's
// practice history in its own SQLite database. The DO's SQL API is synchronous,
// which is what lets it run lib/api.mjs and everything under it unchanged: the
// scheduling and mastery code was written against node:sqlite's sync calls.
//
// Requests arrive from the Pages project (cloud/pages) through a service
// binding; this Worker has no public route of its own.
import { DurableObject } from 'cloudflare:workers';
import { api, setData } from '../../lib/api.mjs';
import { migrate } from '../../lib/db.mjs';

const COOKIE = 'lattice_uid';
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function learnerId(request) {
  const cookie = request.headers.get('cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m && UID.test(m[1]) ? m[1] : null;
}

/** node:sqlite's prepare/get/all/run over a Durable Object's SqlStorage. */
function sqlDb(sql) {
  return {
    exec(text) {
      // SqlStorage takes one statement per call. WAL and foreign keys are the
      // platform's business here, so those pragmas are dropped.
      for (const stmt of text.split(/;\s*(?:\n|$)/)) {
        if (!stmt.trim() || /^\s*PRAGMA\s+(journal_mode|foreign_keys)\b/i.test(stmt)) continue;
        sql.exec(stmt);
      }
    },
    prepare(text) {
      return {
        all: (...params) => sql.exec(text, ...params).toArray(),
        get: (...params) => sql.exec(text, ...params).toArray()[0],
        run: (...params) => {
          const cursor = sql.exec(text, ...params);
          cursor.toArray();
          return {
            changes: cursor.rowsWritten,
            lastInsertRowid: sql.exec('SELECT last_insert_rowid() AS id').one().id,
          };
        },
      };
    },
  };
}

// The corpus is ~15 MB of JSON: load it once per isolate, not once per learner.
let corpus = null;

function loadCorpus(env) {
  corpus ??= (async () => {
    const asset = async (name) => {
      const res = await env.ASSETS.fetch(new Request(`https://assets.local/${name}`));
      if (!res.ok) throw new Error(`${name}: ${res.status}`);
      return res.json();
    };
    const [graph, ladders, extras] = await Promise.all([
      asset('graph.json'), asset('ladders.json'), asset('extras.json'),
    ]);
    setData({ graph, ladders, putnamExtras: new Map(Object.entries(extras)) });
  })().catch((err) => {
    corpus = null;   // let the next request retry rather than caching a failure
    throw err;
  });
  return corpus;
}

export class Learner extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.db = sqlDb(ctx.storage.sql);
    migrate(this.db);
  }

  async fetch(request) {
    await loadCorpus(this.env);
    const url = new URL(request.url);
    const body = request.method === 'POST'
      ? await request.json().catch(() => ({}))
      : {};
    const r = await api(this.db, { method: request.method, url, body });
    return Response.json(r.body, { status: r.status });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return new Response('not found', { status: 404 });
    const uid = learnerId(request);
    if (!uid) return Response.json({ error: 'missing learner cookie' }, { status: 400 });
    try {
      return await env.LEARNER.get(env.LEARNER.idFromName(uid)).fetch(request);
    } catch (err) {
      console.error(`${request.method} ${url.pathname} failed:`, err.message);
      return Response.json({ error: err.message }, { status: 500 });
    }
  },
};
