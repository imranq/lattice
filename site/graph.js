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
    "contest": "#c2571f",
    "mental math": "#3f8f6d",
  };
  // A chapter can hold 20+ sections; laid out in one line the whole graph becomes
  // a few pixels tall and a mile wide. Wrapping long layers keeps the aspect
  // readable without breaking the top-to-bottom prerequisite reading.
  // Chapter labels are centred on their node and run wide, so the gap between book
// cards has to clear a label, not just a node.
const ROW = 128, COL = 78, COMPONENT_GAP = 430, WRAP = 11, SUBROW = 30;

  let nodes = [], edges = [], byId = new Map(), mastery = new Map();
  let prereqIn = new Map(), prereqOut = new Map();
  let view = { x: 0, y: 0, k: 0.7 };
  let hover = null, selected = null, panning = null;
  let bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  let groups = [];
  const BOOK_TITLES = {};

  const css = (v, f) =>
    getComputedStyle(document.documentElement).getPropertyValue(v).trim() || f;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- load ---------------------------------------------------------------

  async function load() {
    const [g, m, stats, books] = await Promise.all([
      fetch("/api/graph").then((r) => r.json()),
      fetch("/api/mastery").then((r) => r.json()).catch(() => []),
      fetch("/api/stats").then((r) => r.json()).catch(() => null),
      fetch("/api/books").then((r) => r.json()).catch(() => []),
    ]);
    for (const b of books) BOOK_TITLES[b.id] = b.title;
    mastery = new Map(m.map((x) => [x.concept_id, x]));

    const keep = new Set(["concept", "domain_part"]);
    nodes = g.nodes.filter((n) => keep.has(n.kind))
      .map((n) => ({ ...n, x: 0, y: 0, layer: 0, deg: 0 }));

    // The generators are a source like any other and belong on the map. They are
    // synthesised here rather than baked into the graph file because the skill
    // list lives in generators.js — one definition, not two.
    if (window.MathGen) {
      const DOMAIN_LAYER = { arithmetic: 0, "number theory": 1, algebra: 2, combinatorics: 3 };
      for (const sk of MathGen.SKILLS) {
        nodes.push({
          id: `skill:${sk.id}`, kind: "concept", label: sk.name,
          domain: "mental math", book_id: "generated", chapter: 1,
          layer: DOMAIN_LAYER[sk.domain] ?? 0,
          generated: true, blurb: sk.blurb, skill_domain: sk.domain,
          x: 0, y: 0, deg: 0,
        });
      }
      BOOK_TITLES.generated = "Generated drills";
    }
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
    for (const n of nodes) {
      if (!n.generated) n.layer = Math.max(0, (n.chapter ?? 1) - 1);
    }
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

    // 2. One block per book. Connected components fragment into dozens of
    //    two-node islands here — every concept without a cross-reference is its
    //    own component — which made the picture a field of tiny overlapping
    //    cards. A book is the grouping a reader actually has in mind.
    const byBook = new Map();
    for (const n of nodes) {
      const key = n.book_id ?? "other";
      if (!byBook.has(key)) byBook.set(key, []);
      byBook.get(key).push(n);
    }
    const components = [...byBook.values()].sort((a, b) => b.length - a.length);

    // 3. within each block: order nodes per layer, then sweep barycentres to
    //    cut edge crossings.
    const perRow = Math.max(1, Math.round(Math.sqrt(components.length)));
    let xCursor = 0, yCursor = 0, rowHeight = 0, placedInRow = 0;

    for (const group of components) {
      const layers = new Map();
      for (const n of group) {
        if (!layers.has(n.layer)) layers.set(n.layer, []);
        layers.get(n.layer).push(n);
      }
      const keys = [...layers.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        layers.get(k).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        layers.get(k).forEach((n, i) => { n.pos = i; });
      }
      // Barycentre sweeps: order each layer by where its neighbours sit, which
      // is what keeps the prerequisite edges from crossing into a hairball.
      for (let sweep = 0; sweep < 6; sweep++) {
        const order = sweep % 2 ? [...keys].reverse() : keys;
        for (const k of order) {
          const row = layers.get(k);
          for (const n of row) {
            const nbrs = (sweep % 2 ? prereqOut.get(n.id).map((e) => e.t)
                                    : prereqIn.get(n.id).map((e) => e.s))
              .filter((x) => x.book_id === n.book_id);
            n.bary = nbrs.length ? nbrs.reduce((s2, x) => s2 + x.pos, 0) / nbrs.length : n.pos;
          }
          row.sort((a, b) => a.bary - b.bary);
          row.forEach((n, i) => { n.pos = i; });
        }
      }
      const width = Math.min(WRAP, Math.max(...keys.map((k) => layers.get(k).length)));
      // Leave room above the first node row for the card's own top edge and its
      // title chip; without it each card grows upward into the row above.
      let y = yCursor + 165;
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
      rowHeight = Math.max(rowHeight, y - yCursor);
      xCursor += width * COL + COMPONENT_GAP;
      if (++placedInRow >= perRow) {
        xCursor = 0;
        yCursor += rowHeight + 260;
        rowHeight = 0;
        placedInRow = 0;
      }
    }

    // Per-component bounds, so each book can be drawn on its own card.
    groups = components.map((group) => {
      const xs = group.map((n) => n.x), ys = group.map((n) => n.y);
      const book = group[0]?.book_id ?? "";
      return {
        book,
        domain: book === "putnam" ? "contest" : group[0]?.domain,
        nodes: group,
        // Extra headroom at the top: the card title sits above the first row of
        // chapter labels, which are themselves drawn above their nodes.
        x0: Math.min(...xs) - 52, x1: Math.max(...xs) + 52,
        y0: Math.min(...ys) - 140, y1: Math.max(...ys) + 34,
        size: group.length,
      };
    }).filter((g) => g.size > 1);

    // Bounds come from the cards, not the node centres: a card extends well past
    // its outermost node, and fitting to centres clipped the top and bottom rows.
    bounds = groups.reduce((b, g) => ({
      minX: Math.min(b.minX, g.x0), maxX: Math.max(b.maxX, g.x1),
      minY: Math.min(b.minY, g.y0), maxY: Math.max(b.maxY, g.y1),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  }

  function fit() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;                       // still hidden; refit on activation
    const gw = bounds.maxX - bounds.minX || 1, gh = bounds.maxY - bounds.minY || 1;
    // Fit inside an inset rect rather than the whole canvas: the controls float
    // over the top and the legend over a bottom corner, and centring on the full
    // canvas parks cards underneath them.
    const insetTop = 78, insetSide = 18, insetBottom = 26;
    const availW = Math.max(120, w - insetSide * 2);
    const availH = Math.max(120, h - insetTop - insetBottom);
    view.k = Math.max(0.1, Math.min(1.3, Math.min(availW / (gw + 80), availH / (gh + 60))));
    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
    view.x = (insetSide + availW / 2) - w / 2 - cx * view.k;
    view.y = (insetTop + availH / 2) - h / 2 - cy * view.k;
  }

  // ---- drawing ------------------------------------------------------------

  const radius = (n) => n.kind === "domain_part" ? 11 : 6 + Math.min(Math.sqrt(n.deg) * 2.0, 11);

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
    const df = document.getElementById("domainFilter").value;

    const focus = selected || hover;
    const near = new Set();
    if (focus) {
      near.add(focus.id);
      for (const e of edges) {
        if (e.s === focus) near.add(e.t.id);
        if (e.t === focus) near.add(e.s.id);
      }
    }

    // Each book on its own card: without them the picture is one undifferentiated
    // field of dots, and the fact that these are seven separate curricula is the
    // first thing worth seeing.
    const surface = css("--surface-alt", "#f5f5f5");
    for (const g of groups) {
      if (df && g.domain !== df) continue;
      ctx.fillStyle = surface;
      ctx.globalAlpha = 0.55;
      const r = 18;
      const w2 = g.x1 - g.x0, h2 = g.y1 - g.y0;
      ctx.beginPath();
      ctx.roundRect(g.x0, g.y0, w2, h2, r);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = line;
      ctx.lineWidth = 1 / view.k;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

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

    // Chapter labels get first claim on space, then the best-connected concepts.
    const sorted = [...nodes].sort((a, b) =>
      (a.kind === "domain_part" ? 0 : 1) - (b.kind === "domain_part" ? 0 : 1)
      || b.deg - a.deg);
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
        // Concept labels only once there is room for them. At a whole-graph zoom
        // 400 of them is a wall of text; the chapter headings carry the shape.
        if (big || view.k > 1.05) {
          ctx.font = `${size}px "Space Grotesk", system-ui`;
          const label = n.label.length > 26 ? n.label.slice(0, 24) + "…" : n.label;
          const wid = ctx.measureText(label).width;
          // Everything competes for label space; priority comes from draw order.
          if (fits(n.x, n.y - r - 6 / view.k, wid)) {
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

    // Card titles are drawn in screen space, not world space: scaled with the
    // view they either vanish at low zoom or overflow their card at high zoom.
    const toScreen = (x, y) => ({
      x: w / 2 + view.x + x * view.k,
      y: h / 2 + view.y + y * view.k,
    });
    for (const g of groups) {
      if (df && g.domain !== df) continue;
      const a = toScreen(g.x0, g.y0), b = toScreen(g.x1, g.y1);
      if (b.x < 0 || a.x > w || b.y < 0 || a.y > h) continue;
      const cardW = b.x - a.x;
      if (cardW < 90) continue;                       // too small to label honestly
      const title = (BOOK_TITLES[g.book] ?? g.book ?? "").toUpperCase();
      ctx.font = '600 11.5px "Space Grotesk", system-ui';
      const tw = Math.min(ctx.measureText(title).width, cardW - 26);
      ctx.fillStyle = css("--card", "#fff");
      ctx.globalAlpha = 0.94;
      ctx.beginPath();
      ctx.roundRect(a.x + 10, a.y + 8, tw + 20, 32, 8);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = DOMAIN_COLORS[g.domain] ?? "#888";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.rect(a.x + 16, a.y + 8, tw + 8, 32);
      ctx.clip();
      ctx.globalAlpha = 1;
      ctx.fillStyle = DOMAIN_COLORS[g.domain] ?? "#888";
      ctx.textAlign = "left";
      ctx.fillText(title, a.x + 20, a.y + 23);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = ink;
      ctx.font = '9.5px "Space Grotesk", system-ui';
      ctx.fillText(`${g.size} concepts · ${g.domain ?? ""}`, a.x + 20, a.y + 35);
      ctx.restore();
    }
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
      const want = n ? `#explore|${encodeURIComponent(n.id)}` : "#explore";
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
    // The shell owns the hash; a concept id arrives as "explore|<id>" or bare.
    const raw = decodeURIComponent(location.hash.slice(1));
    const id = raw.startsWith("explore|") ? raw.slice("explore|".length) : raw;
    const n = id && byId.get(id);
    if (n) { view.x = -n.x * view.k; view.y = -n.y * view.k; inspect(n, false); }
  }

  async function init() {
    await load();
    routeFromHash();
    frame();
    // The canvas has no size until its view is on screen, so refit on activation.
    window.addEventListener("lattice:view", (e) => {
      if (e.detail.view === "explore") setTimeout(fit, 0);
    });
    setTimeout(fit, 0);
  }

  window.Lattice.register("explore", () => init().catch((err) => {
    document.getElementById("graphCount").textContent =
      `graph unavailable (${err.message}) — run the pipeline, then reload`;
  }));
})();
