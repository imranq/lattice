// The concept graph, drawn as a partial order.
//
// Layout is a small Sugiyama: layer by longest path over prerequisite edges, then
// reduce crossings with barycentre sweeps, then place. A force layout was tried
// first and was wrong for this data — it spreads a DAG into an even cloud and
// hides the one relation that matters. Layering puts "needed first" above
// "unlocks", so the picture *is* the partial order the product is named for.
//
// Connected components are packed side by side, which naturally separates the
// books and domains without hard-coding lanes.
//
// The learning plan follows Metacademy: choose a goal, get the prerequisites in
// topological order, with everything you have already mastered pruned out.
(() => {
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const inspector = document.getElementById("inspector");

  const DOMAIN_COLORS = {
    "probability": "#d05b2d",
    "abstract algebra": "#1c6e6a",
    "real analysis": "#5a6fb8",
    "linear algebra": "#8a5bb0",
    "number theory": "#b08a2d",
    "unknown": "#8a8a8a",
  };
  // A chapter can hold 20+ sections; laid out in one line the whole graph becomes
  // a few pixels tall and a mile wide. Wrapping long layers keeps the aspect
  // readable without breaking the top-to-bottom prerequisite reading.
  const ROW = 128, COL = 76, COMPONENT_GAP = 130, WRAP = 11, SUBROW = 30;

  let nodes = [], edges = [], byId = new Map(), mastery = new Map();
  let prereqIn = new Map(), prereqOut = new Map();
  let view = { x: 0, y: 0, k: 0.7 };
  let hover = null, selected = null, panning = null;
  let bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };

  const css = (v, f) =>
    getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- load ---------------------------------------------------------------

  async function load() {
    const [g, m, stats] = await Promise.all([
      fetch("/api/graph").then((r) => r.json()),
      fetch("/api/mastery").then((r) => r.json()).catch(() => []),
      fetch("/api/stats").then((r) => r.json()).catch(() => null),
    ]);
    mastery = new Map(m.map((x) => [x.concept_id, x]));

    const keep = new Set(["concept", "domain_part"]);
    nodes = g.nodes.filter((n) => keep.has(n.kind))
      .map((n) => ({ ...n, x: 0, y: 0, layer: 0, deg: 0 }));
    byId = new Map(nodes.map((n) => [n.id, n]));
    edges = g.edges.filter((e) => byId.has(e.src) && byId.has(e.dst))
      .map((e) => ({ ...e, s: byId.get(e.src), t: byId.get(e.dst) }));

    for (const e of edges) { e.s.deg++; e.t.deg++; }
    prereqIn = new Map(nodes.map((n) => [n.id, []]));
    prereqOut = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edges) {
      if (e.type !== "prerequisite") continue;
      prereqIn.get(e.dst).push(e);
      prereqOut.get(e.src).push(e);
      // Layering uses only *inferred* prerequisites. `textbook_order` alone just
      // chains every section to the next, which layers the book into a single
      // column one node deep per layer - true, and useless to look at.
      e.inferred = (e.evidence_types ?? []).some((t) => t !== "textbook_order");
    }

    layout();

    document.getElementById("graphCount").textContent =
      `${nodes.length} concepts · ${edges.filter((e) => e.type === "prerequisite").length} prerequisites`
      + (stats ? ` · ${stats.attempts} attempts logged` : "");

    const domains = [...new Set(nodes.map((n) => n.domain).filter(Boolean))].sort();
    const sel = document.getElementById("domainFilter");
    for (const d of domains) {
      const o = document.createElement("option");
      o.value = d; o.textContent = d;
      sel.appendChild(o);
    }
    document.getElementById("legend").innerHTML =
      domains.map((d) => `<span class="legend-item"><i style="background:${
        DOMAIN_COLORS[d] ?? "#888"}"></i>${d}</span>`).join("")
      + `<span class="legend-item legend-note">top → bottom = prerequisite order · hollow = unassessed</span>`;
    fit();
  }

  // ---- layered layout -----------------------------------------------------

  function structuralEdges() {
    // `contains` keeps a chapter next to its sections; `prerequisite` sets the order.
    return edges.filter((e) => e.type === "prerequisite" || e.type === "contains");
  }

  function layout() {
    const inferredIn = (id) => prereqIn.get(id).filter((e) => e.inferred);
    const inferredOut = (id) => prereqOut.get(id).filter((e) => e.inferred);

    // 1. layer assignment. The book's own chapter number is the floor - it is a
    //    real statement about curriculum depth - and inferred prerequisites push
    //    a concept further down from there.
    const indeg = new Map(nodes.map((n) => [n.id, inferredIn(n.id).length]));
    const queue = nodes.filter((n) => indeg.get(n.id) === 0);
    for (const n of nodes) n.layer = Math.max(0, (n.chapter ?? 1) - 1);
    const seen = new Set();
    while (queue.length) {
      const n = queue.shift();
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      for (const e of inferredOut(n.id)) {
        e.t.layer = Math.max(e.t.layer, n.layer + 1);
        indeg.set(e.dst, indeg.get(e.dst) - 1);
        if (indeg.get(e.dst) === 0) queue.push(e.t);
      }
    }
    // Any node left unvisited sits in a cycle; place it below its deepest parent
    // rather than dropping it from the picture.
    for (const n of nodes) {
      if (!seen.has(n.id)) {
        n.layer = Math.max(n.layer, ...inferredIn(n.id).map((e) => e.s.layer + 1));
      }
    }

    // 2. connected components over structural edges, packed left to right.
    const adj = new Map(nodes.map((n) => [n.id, []]));
    for (const e of structuralEdges()) {
      adj.get(e.src).push(e.dst);
      adj.get(e.dst).push(e.src);
    }
    const comp = new Map();
    let cid = 0;
    for (const n of nodes) {
      if (comp.has(n.id)) continue;
      const stack = [n.id];
      comp.set(n.id, cid);
      while (stack.length) {
        const u = stack.pop();
        for (const v of adj.get(u)) if (!comp.has(v)) { comp.set(v, cid); stack.push(v); }
      }
      cid++;
    }

    // 3. within each component: order nodes per layer, then sweep barycentres to
    //    cut edge crossings.
    let xCursor = 0;
    const components = [...new Set(comp.values())].map((c) =>
      nodes.filter((n) => comp.get(n.id) === c));
    components.sort((a, b) => b.length - a.length);

    for (const group of components) {
      const layers = new Map();
      for (const n of group) {
        if (!layers.has(n.layer)) layers.set(n.layer, []);
        layers.get(n.layer).push(n);
      }
      const keys = [...layers.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        layers.get(k).sort((a, b) => (a.book_id ?? "").localeCompare(b.book_id ?? "")
          || (a.order ?? 0) - (b.order ?? 0));
        layers.get(k).forEach((n, i) => { n.pos = i; });
      }
      for (let sweep = 0; sweep < 6; sweep++) {
        const order = sweep % 2 ? [...keys].reverse() : keys;
        for (const k of order) {
          const row = layers.get(k);
          for (const n of row) {
            const nbrs = (sweep % 2 ? prereqOut.get(n.id).map((e) => e.t)
                                    : prereqIn.get(n.id).map((e) => e.s))
              .filter((x) => comp.get(x.id) === comp.get(n.id));
            n.bary = nbrs.length
              ? nbrs.reduce((s, x) => s + x.pos, 0) / nbrs.length
              : n.pos;
          }
          row.sort((a, b) => a.bary - b.bary);
          row.forEach((n, i) => { n.pos = i; });
        }
      }
      const width = Math.min(WRAP, Math.max(...keys.map((k) => layers.get(k).length)));
      let y = 0;
      for (const k of keys) {
        const row = layers.get(k);
        const lines = Math.ceil(row.length / WRAP);
        row.forEach((n, i) => {
          const line = Math.floor(i / WRAP);
          const inLine = i % WRAP;
          const count = Math.min(WRAP, row.length - line * WRAP);
          n.x = xCursor + ((width - count) / 2 + inLine) * COL;
          n.y = y + line * SUBROW;
        });
        y += Math.max(ROW, lines * SUBROW + 58);
      }
      xCursor += width * COL + COMPONENT_GAP;
    }

    bounds = nodes.reduce((b, n) => ({
      minX: Math.min(b.minX, n.x), maxX: Math.max(b.maxX, n.x),
      minY: Math.min(b.minY, n.y), maxY: Math.max(b.maxY, n.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  }

  function fit() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const gw = bounds.maxX - bounds.minX || 1, gh = bounds.maxY - bounds.minY || 1;
    view.k = Math.max(0.12, Math.min(1.4, Math.min(w / (gw + 260), h / (gh + 160))));
    view.x = -((bounds.minX + bounds.maxX) / 2) * view.k;
    view.y = -((bounds.minY + bounds.maxY) / 2) * view.k;
  }

  // ---- drawing ------------------------------------------------------------

  const radius = (n) => n.kind === "domain_part" ? 9 : 5 + Math.min(Math.sqrt(n.deg) * 1.6, 9);

  function masteryColor(n) {
    const m = mastery.get(n.id);
    if (!m) return null;
    const t = Math.max(0, Math.min(1, m.mastery));
    return `hsl(${10 + t * 155} 58% ${document.documentElement.dataset.theme === "dark" ? 56 : 42}%)`;
  }

  const visible = (n) => {
    const d = document.getElementById("domainFilter").value;
    return !d || n.domain === d;
  };

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2 + view.x, h / 2 + view.y);
    ctx.scale(view.k, view.k);

    const useMastery = document.getElementById("showMastery").checked;
    const showLabels = document.getElementById("showLabels").checked;
    const q = document.getElementById("graphSearch").value.trim().toLowerCase();
    const line = css("--line", "#ccc"), ink = css("--ink", "#222");
    const accent = css("--accent", "#d05b2d");

    const focus = selected || hover;
    const near = new Set();
    if (focus) {
      near.add(focus.id);
      for (const e of edges) {
        if (e.s === focus) near.add(e.t.id);
        if (e.t === focus) near.add(e.s.id);
      }
    }

    for (const e of edges) {
      if (!visible(e.s) || !visible(e.t)) continue;
      const lit = focus && (e.s === focus || e.t === focus);
      ctx.strokeStyle = lit ? accent : line;
      ctx.globalAlpha = lit ? 0.95
        : focus ? 0.06
        : e.type === "prerequisite" ? 0.2 + e.confidence * 0.3
        : e.type === "aligns_with" ? 0.5 : 0.12;
      ctx.lineWidth = (lit ? 2 : e.type === "prerequisite" ? 0.6 + e.confidence : 0.7) / view.k;
      if (e.type === "aligns_with") ctx.setLineDash([5 / view.k, 4 / view.k]);
      // Curve edges slightly so parallel prerequisites stay distinguishable.
      const mx = (e.s.x + e.t.x) / 2, my = (e.s.y + e.t.y) / 2;
      ctx.beginPath();
      ctx.moveTo(e.s.x, e.s.y);
      ctx.quadraticCurveTo(mx + (e.t.y - e.s.y) * 0.06, my, e.t.x, e.t.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (lit && e.type === "prerequisite") {
        // Arrowhead only on the highlighted edges: 200 of them would be noise.
        const a = Math.atan2(e.t.y - e.s.y, e.t.x - e.s.x);
        const r = radius(e.t) + 3;
        const tipX = e.t.x - Math.cos(a) * r, tipY = e.t.y - Math.sin(a) * r;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - Math.cos(a - 0.4) * 9 / view.k, tipY - Math.sin(a - 0.4) * 9 / view.k);
        ctx.lineTo(tipX - Math.cos(a + 0.4) * 9 / view.k, tipY - Math.sin(a + 0.4) * 9 / view.k);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Label collision grid: at any zoom, only draw what fits.
    const placed = [];
    const fits = (x, y, wid) => {
      for (const b of placed) {
        if (Math.abs(b.y - y) < 13 / view.k && Math.abs(b.x - x) < (b.w + wid) / 2) return false;
      }
      placed.push({ x, y, w: wid });
      return true;
    };

    const sorted = [...nodes].sort((a, b) => (b.deg - a.deg));
    for (const n of sorted) {
      if (!visible(n)) continue;
      const r = radius(n);
      const match = q && n.label.toLowerCase().includes(q);
      const dim = (focus && !near.has(n.id)) || (q && !match);
      ctx.globalAlpha = dim ? 0.13 : 1;
      const mc = useMastery ? masteryColor(n) : null;
      ctx.fillStyle = mc ?? DOMAIN_COLORS[n.domain] ?? "#888";

      ctx.beginPath();
      if (n.kind === "domain_part") ctx.rect(n.x - r, n.y - r, r * 2, r * 2);
      else ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      if (useMastery && !mc) {
        ctx.globalAlpha = dim ? 0.1 : 0.35;
        ctx.fill();
        ctx.globalAlpha = dim ? 0.15 : 0.75;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1.6 / view.k;
        ctx.stroke();
      } else {
        ctx.fill();
      }

      if (n === selected || match) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2.5 / view.k;
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 5 / view.k, 0, Math.PI * 2); ctx.stroke();
      }

      if (showLabels && !dim) {
        const big = n.kind === "domain_part" || near.has(n.id) || match;
        const size = (big ? 12.5 : 10.5) / view.k;
        if (big || view.k > 0.5) {
          ctx.font = `${size}px "Space Grotesk", system-ui`;
          const label = n.label.length > 30 ? n.label.slice(0, 28) + "…" : n.label;
          const wid = ctx.measureText(label).width;
          if (big || fits(n.x, n.y - r - 6 / view.k, wid)) {
            ctx.globalAlpha = big ? 1 : 0.72;
            ctx.fillStyle = ink;
            ctx.textAlign = "center";
            ctx.fillText(label, n.x, n.y - r - 6 / view.k);
          }
        }
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---- learning plan (Metacademy's idea, pruned by real mastery) -----------

  function learningPlan(goal, threshold = 0.7) {
    const need = [], seen = new Set();
    (function walk(n) {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      for (const e of prereqIn.get(n.id).sort((a, b) => b.confidence - a.confidence).slice(0, 3)) {
        walk(e.s);
      }
      need.push(n);
    })(goal);
    return need.map((n) => {
      const m = mastery.get(n.id);
      return { node: n, mastery: m?.mastery ?? null, done: (m?.mastery ?? 0) >= threshold };
    });
  }

  function inspect(n, push = true) {
    selected = n;
    // The hash makes a concept linkable: graph.html#<concept id> opens its plan.
    if (push) {
      const want = n ? `#${encodeURIComponent(n.id)}` : "";
      if (location.hash !== want) history.replaceState(null, "", want || location.pathname);
    }
    if (!n) { inspector.hidden = true; return; }
    inspector.hidden = false;
    const m = mastery.get(n.id);
    const plan = learningPlan(n);
    const todo = plan.filter((p) => !p.done);
    const unlocks = prereqOut.get(n.id).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    const aligns = edges.filter((e) => e.type === "aligns_with" && (e.s === n || e.t === n));

    inspector.innerHTML = `
      <button class="inspector-close" type="button" aria-label="Close">×</button>
      <h3>${esc(n.label)}</h3>
      <p class="inspector-meta">${esc(n.domain ?? "")}${n.book_id ? ` · ${esc(n.book_id)}` : ""}${
        n.page ? ` · p.${n.page}` : ""} · layer ${n.layer}</p>
      ${m ? `<p class="inspector-mastery">mastery <b>${Math.round(m.mastery * 100)}%</b>
             <span class="dim">from ${m.attempts} attempt${m.attempts === 1 ? "" : "s"}</span></p>`
          : `<p class="inspector-mastery dim">not yet assessed</p>`}

      <h4>Learning plan${todo.length ? ` — ${todo.length} to go` : " — clear"}</h4>
      <ol class="plan">${plan.map((p) => `
        <li class="${p.done ? "done" : ""}">
          <a href="#" data-goto="${esc(p.node.id)}">${esc(p.node.label)}</a>
          ${p.mastery === null ? '<span class="dim">new</span>'
            : `<span class="dim">${Math.round(p.mastery * 100)}%</span>`}
        </li>`).join("")}</ol>

      ${unlocks.length ? `<h4>Unlocks</h4><ul>${unlocks.map((e) =>
        `<li><a href="#" data-goto="${esc(e.t.id)}">${esc(e.t.label)}</a></li>`).join("")}</ul>` : ""}
      ${aligns.length ? `<h4>Also covered by</h4><ul>${aligns.map((e) => (e.s === n ? e.t : e.s))
        .map((o) => `<li><a href="#" data-goto="${esc(o.id)}">${esc(o.label)}</a>
          <span class="dim">${esc(o.book_id ?? "")}</span></li>`).join("")}</ul>` : ""}
      <div class="inspector-actions">
        <a class="ghost-btn" href="/api/exercises?concept=${encodeURIComponent(n.id)}&limit=20"
           target="_blank" rel="noopener">Exercises →</a>
      </div>`;
  }

  // ---- interaction --------------------------------------------------------

  const toWorld = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - rect.width / 2 - view.x) / view.k,
      y: (ev.clientY - rect.top - rect.height / 2 - view.y) / view.k,
    };
  };

  function nodeAt(p) {
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      if (!visible(n)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < radius(n) + 8 / view.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  canvas.addEventListener("mousemove", (ev) => {
    if (panning) {
      view.x += ev.clientX - panning.x; view.y += ev.clientY - panning.y;
      panning = { x: ev.clientX, y: ev.clientY };
      return;
    }
    hover = nodeAt(toWorld(ev));
    canvas.style.cursor = hover ? "pointer" : "grab";
  });
  canvas.addEventListener("mousedown", (ev) => { panning = { x: ev.clientX, y: ev.clientY }; });
  window.addEventListener("mouseup", () => { panning = null; });
  canvas.addEventListener("click", (ev) => inspect(nodeAt(toWorld(ev))));
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const p = toWorld(ev);
    view.k = Math.max(0.1, Math.min(4, view.k * Math.exp(-ev.deltaY * 0.0015)));
    const q = toWorld(ev);
    view.x += (q.x - p.x) * view.k;
    view.y += (q.y - p.y) * view.k;
  }, { passive: false });

  inspector.addEventListener("click", (ev) => {
    if (ev.target.closest(".inspector-close")) return inspect(null);
    const link = ev.target.closest("[data-goto]");
    if (link) {
      ev.preventDefault();
      const n = byId.get(link.dataset.goto);
      if (n) { view.x = -n.x * view.k; view.y = -n.y * view.k; inspect(n); }
    }
  });
  document.getElementById("replay").addEventListener("click", fit);
  window.addEventListener("resize", () => fit());

  function frame() { draw(); requestAnimationFrame(frame); }
  function routeFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const n = id && byId.get(id);
    if (n) { view.x = -n.x * view.k; view.y = -n.y * view.k; inspect(n, false); }
  }

  load().then(() => { routeFromHash(); frame(); }).catch((err) => {
    document.getElementById("graphCount").textContent =
      `graph unavailable (${err.message}) — run the pipeline, then reload`;
  });
})();
