// Load site/generators.js the way the browser does — as a script that defines
// a global — so Node tools can run the same generators the site serves.
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const FILES = ['generators.js', 'generators-ml.js', 'generators-einsum.js', 'generators-books.js', 'generators-putnam.js', 'generators-gs.js', 'generators-analysis.js', 'generators-algebra.js', 'generators-mlbooks.js', 'generators-complex.js'];

export function loadGenerators() {
  const ctx = { self: {} };
  // The Putnam step bank loads by fetch in the browser; hand it over directly here.
  const steps = new URL('../site/putnam-steps.json', import.meta.url);
  if (existsSync(steps)) ctx.self.PUTNAM_STEPS = JSON.parse(readFileSync(steps, 'utf8'));
  for (const f of FILES) {
    runInNewContext(readFileSync(new URL(`../site/${f}`, import.meta.url), 'utf8'), ctx);
  }
  return ctx.self.MathGen;
}
