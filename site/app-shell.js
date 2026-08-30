// The shell: one page, several views, each booted the first time it is opened.
//
// Modules register themselves rather than running on load. The graph, the problem
// feed and the Putnam bank are all expensive to start — the bank alone pulls a
// 4.3 MB data bundle — so nothing initialises until you actually look at it.
window.Lattice = (() => {
  const inits = new Map();
  const started = new Set();

  const VIEWS = {
    study: ["Study", "One problem at a time, at the edge of what you can do"],
    explore: ["The graph", "Every concept, ordered by what it needs first"],
    progress: ["Stats", "What the evidence says you know"],
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
    if (!VIEWS[name]) name = "study";
    for (const el of document.querySelectorAll(".view")) {
      el.classList.toggle("active", el.id === name);
    }
    for (const b of document.querySelectorAll(".nav-button")) {
      b.classList.toggle("active", b.dataset.view === name);
    }
    const [title] = VIEWS[name];
    document.title = `Lattice — ${title}`;
    // The sidebar is Study's control panel; Graph and Stats take the full width
    // and carry their own controls.
    document.querySelector(".shell").dataset.view = name;
    boot(name);
    // Views measure themselves on activation (the graph canvas especially), so
    // tell anyone who cares that they are now visible and have real dimensions.
    window.dispatchEvent(new CustomEvent("lattice:view", { detail: { view: name } }));
  }

  function route() {
    // Deep links keep working: #explore, but also #concept:… straight to a node.
    const raw = decodeURIComponent(location.hash.slice(1));
    const [head] = raw.split("|");
    show(VIEWS[head] ? head : (raw.includes(":") ? "explore" : "study"));
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

  // Deferred scripts execute at readyState "interactive", and microtasks drain
  // between them — routing from a microtask therefore runs before the modules
  // that follow this file have registered. DOMContentLoaded fires after all of
  // them, which is the only safe point to route from.
  if (document.readyState === "complete") setTimeout(route, 0);
  else document.addEventListener("DOMContentLoaded", route);

  return {
    register: (name, init) => inits.set(name, init),
    show,
    /** True when a view is on screen — modules skip work while hidden. */
    visible: (name) => document.getElementById(name)?.classList.contains("active"),
  };
})();
