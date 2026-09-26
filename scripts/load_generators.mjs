// Load site/generators.js the way the browser does — as a script that defines
// a global — so Node tools can run the same generators the site serves.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const FILES = ['generators.js', 'generators-ml.js', 'generators-einsum.js', 'generators-books.js', 'generators-putnam.js'];

export function loadGenerators() {
  const ctx = { self: {} };
  for (const f of FILES) {
    runInNewContext(readFileSync(new URL(`../site/${f}`, import.meta.url), 'utf8'), ctx);
  }
  return ctx.self.MathGen;
}
