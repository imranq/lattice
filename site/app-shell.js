// The shell: one page, several views, each booted the first time it is opened.
//
// Modules register themselves rather than running on load. The graph, the problem
// feed and the Putnam bank are all expensive to start — the bank alone pulls a
// 4.3 MB data bundle — so nothing initialises until you actually look at it.
window.Lattice = (() => {
  const inits = new Map();
  const started = new Set();

  const VIEWS = {
    explore: ["The graph", "Every concept, ordered by what it needs first"],
    problems: ["Problems", "Every exercise in the graph, filtered how you like"],
    practice: ["Practice", "Generated drills, one problem at a time"],
    test: ["Test", "A scored session aimed at your weakest concepts"],
    progress: ["Stats", "What the evidence says you know"],
    putnam: ["Putnam bank", "492 contest problems, 1985–2025"],
  };

  /** Load a script once, resolving when it has run. */
  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-lazy="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.dataset.lazy = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });

  async function boot(name) {
    if (started.has(name)) return;
    // Do not mark a view started if nothing has registered for it yet, or a race
    // during load would leave it permanently blank.
    if (name !== "putnam" && !inits.has(name)) return;
    started.add(name);
    // The Putnam bank is a separate app with its own data bundle; pull it in only
    // when the view is first opened rather than on every page load.
    if (name === "putnam") {
      try {
        await loadScript("putnam-data.js");
        await loadScript("app.js");
        await loadScript("memory.js");
      } catch (err) {
        document.getElementById("detail").innerHTML =
          `<h2>Could not load the bank</h2><p class="dim">${err.message}</p>`;
      }
      return;
    }
    const fn = inits.get(name);
    if (fn) {
      try { await fn(); } catch (err) { console.error(`${name} failed to start:`, err); }
    }
  }

  function show(name) {
    if (!VIEWS[name]) name = "explore";
    for (const el of document.querySelectorAll(".view")) {
      el.classList.toggle("active", el.id === name);
    }
    for (const b of document.querySelectorAll(".nav-button")) {
      b.classList.toggle("active", b.dataset.view === name);
    }
    const [title, subtitle] = VIEWS[name];
    document.getElementById("view-title").textContent = title;
    document.getElementById("view-subtitle").textContent = subtitle;
    document.title = `Lattice — ${title}`;
    boot(name);
    // Views measure themselves on activation (the graph canvas especially), so
    // tell anyone who cares that they are now visible and have real dimensions.
    window.dispatchEvent(new CustomEvent("lattice:view", { detail: { view: name } }));
  }

  function route() {
    // Deep links keep working: #explore, but also #concept:… straight to a node.
    const raw = decodeURIComponent(location.hash.slice(1));
    const [head] = raw.split("|");
    show(VIEWS[head] ? head : (raw.includes(":") ? "explore" : "explore"));
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
