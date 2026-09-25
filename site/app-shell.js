// The shell: one page, several views, each booted the first time it is opened.
//
// Modules register themselves rather than running on load. The graph, the problem
// feed and the Putnam bank are all expensive to start — the bank alone pulls a
// 4.3 MB data bundle — so nothing initialises until you actually look at it.
window.Lattice = (() => {
  const inits = new Map();
  const started = new Set();

  const VIEWS = {
    home: ["Home", "Where you are and what to do today"],
    study: ["Study", "One problem at a time, at the edge of what you can do"],
    explore: ["The graph", "Every concept, ordered by what it needs first"],
    stats: ["Stats", "What the evidence says you know"],
    subject: ["Subject", "One field, its books and its topics"],
    course: ["Courses", "A book as a tree: locked, ready, learned"],
  };

  async function boot(name) {
    if (started.has(name)) return;
    // Do not mark a view started if nothing has registered for it yet, or a race
    // during load would leave it permanently blank.
    if (!inits.has(name)) return;
    started.add(name);
    const fn = inits.get(name);
    if (fn) {
      try { await fn(); } catch (err) { console.error(`${name} failed to start:`, err); }
    }
  }

  function show(name) {
    if (!VIEWS[name]) name = "home";
    for (const el of document.querySelectorAll(".view")) {
      el.classList.toggle("active", el.id === `v-${name}`);
    }
    for (const b of document.querySelectorAll(".nav-button")) {
      b.classList.toggle("active", b.dataset.view === name);
    }
    const [title] = VIEWS[name];
    document.title = `Lattice — ${title}`;
    document.body.dataset.view = name;
    // A route change starts at the top of the new view. View ids are prefixed
    // (`v-home`, not `home`) precisely so the hash is never also an anchor the
    // browser would scroll to on its own.
    window.scrollTo({ top: 0, behavior: "instant" });
    boot(name);
    // Views that take an argument re-render on every hash change, not just the
    // first — #subject|probability and #subject|geometry are the same view.
    window.dispatchEvent(new CustomEvent("lattice:route", {
      detail: { view: name, arg: decodeURIComponent(location.hash.slice(1)).split("|")[1] },
    }));
    // Views measure themselves on activation (the graph canvas especially), so
    // tell anyone who cares that they are now visible and have real dimensions.
    window.dispatchEvent(new CustomEvent("lattice:view", { detail: { view: name } }));
  }

  function route() {
    // Deep links keep working: #explore, #subject|probability, or a bare concept
    // id straight to a node on the graph.
    const raw = decodeURIComponent(location.hash.slice(1));
    const [head] = raw.split("|");
    show(VIEWS[head] ? head : (raw.includes(":") ? "explore" : "home"));
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".nav-button");
    if (btn) { location.hash = btn.dataset.view; }
  });
  window.addEventListener("hashchange", route);

  // Theme toggle lives in the shell now that every view shares one header.
  const THEME_KEY = "putnam_theme_v1";
  document.getElementById("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
  });

  // ---- the jump palette ----------------------------------------------------
  // Cmd-K from anywhere. Search is deterministic on the server (substring over
  // 484 nodes plus the tag vocabulary), so it answers inside a keystroke and
  // needs no debounce beyond one that stops in-flight requests overtaking each
  // other.

  const palette = document.getElementById("palette");
  const paletteInput = document.getElementById("paletteInput");
  const paletteResults = document.getElementById("paletteResults");
  let hits = [];
  let cursor = 0;
  let seq = 0;          // request ordering: a slow answer must not overwrite a fast one

  const esc = (x) => String(x ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function openPalette() {
    palette.hidden = false;
    paletteInput.value = "";
    paletteInput.focus();
    render([], "Type to search concepts, fields, books and techniques.");
  }

  function closePalette() {
    palette.hidden = true;
    hits = [];
  }

  function render(rows, empty) {
    hits = rows;
    cursor = 0;
    if (!rows.length) {
      paletteResults.innerHTML = `<li class="palette-empty">${esc(empty ?? "No matches.")}</li>`;
      return;
    }
    paletteResults.innerHTML = rows.map((r, i) => `
      <li class="palette-row${i === 0 ? " on" : ""}" role="option" data-i="${i}">
        <span class="palette-kind k-${esc(r.kind)}">${esc(r.kind)}</span>
        <span class="palette-label">${esc(r.label)}</span>
        <span class="palette-sub">${esc(r.sub ?? "")}</span>
      </li>`).join("");
  }

  function move(delta) {
    if (!hits.length) return;
    cursor = (cursor + delta + hits.length) % hits.length;
    for (const li of paletteResults.children) {
      li.classList.toggle("on", Number(li.dataset.i) === cursor);
    }
    paletteResults.children[cursor]?.scrollIntoView({ block: "nearest" });
  }

  function choose(i = cursor) {
    const r = hits[i];
    if (!r) return;
    closePalette();
    location.hash = r.href;
  }

  async function search(q) {
    const mine = ++seq;
    if (q.trim().length < 2) return render([], "Keep typing…");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
      const data = await res.json();
      if (mine !== seq) return;              // a later keystroke already answered
      render(data.results, `Nothing matches “${q}”.`);
    } catch {
      if (mine === seq) render([], "Search is unavailable.");
    }
  }

  document.getElementById("searchOpen").addEventListener("click", openPalette);
  paletteInput.addEventListener("input", () => search(paletteInput.value));

  paletteInput.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(); }
    else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
  });

  paletteResults.addEventListener("click", (e) => {
    const li = e.target.closest("[data-i]");
    if (li) choose(Number(li.dataset.i));
  });

  // Clicking the backdrop, but not the box itself.
  palette.addEventListener("mousedown", (e) => {
    if (e.target === palette) closePalette();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      palette.hidden ? openPalette() : closePalette();
      return;
    }
    // A bare "/" opens it too, but not while something else is being typed into.
    if (e.key === "/" && palette.hidden) {
      const t = e.target;
      const typing = t instanceof HTMLElement
        && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (!typing) { e.preventDefault(); openPalette(); }
    }
  });

  // Deferred scripts execute at readyState "interactive", and microtasks drain
  // between them — routing from a microtask therefore runs before the modules
  // that follow this file have registered. DOMContentLoaded fires after all of
  // them, which is the only safe point to route from.
  if (document.readyState === "complete") setTimeout(route, 0);
  else document.addEventListener("DOMContentLoaded", route);

  // ---- maths ---------------------------------------------------------------
  // Every view renders TeX, and MathJax may still be downloading when the first
  // one paints. Queue against its startup promise so a render that lands early
  // is typeset rather than silently left as raw source.
  function typeset(target) {
    const el = target ?? document.body;
    const run = () => window.MathJax.typesetPromise([el]).catch(() => {});
    if (!window.MathJax) return;
    if (window.MathJax.startup?.promise) return window.MathJax.startup.promise.then(run);
    if (window.MathJax.typesetPromise) return run();
  }

  return {
    register: (name, init) => inits.set(name, init),
    typeset,
    show,
    /** True when a view is on screen — modules skip work while hidden. */
    visible: (name) => document.getElementById(`v-${name}`)?.classList.contains("active"),
  };
})();
