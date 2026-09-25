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

  // One hue per field, in both themes. The dark set is not the light set — the
  // same saturation that reads as "considered" on white reads as mud on near
  // black, so each pair is picked at its own lightness.
  const PALETTE = {
    light: {
      "probability":      "#4f46e5",
      "real analysis":    "#0d9488",
      "linear algebra":   "#7c3aed",
      "abstract algebra": "#0284c7",
      "number theory":    "#b45309",
      "complex analysis": "#be185d",
      "inequalities":     "#4d7c0f",
      "mental math":      "#0f766e",
      "estimation":       "#a16207",
      "machine learning": "#0369a1",
      "contest":          "#c2410c",
      "unknown":          "#64748b",
    },
    dark: {
      "probability":      "#818cf8",
      "real analysis":    "#2dd4bf",
      "linear algebra":   "#c084fc",
      "abstract algebra": "#38bdf8",
      "number theory":    "#fbbf24",
      "complex analysis": "#f472b6",
      "inequalities":     "#a3e635",
      "mental math":      "#5eead4",
      "estimation":       "#facc15",
      "machine learning": "#67e8f9",
      "contest":          "#fb923c",
      "unknown":          "#94a3b8",
    },
  };
  const isDark = () => document.documentElement.dataset.theme === "dark";
  const domainColor = (d) => {
    const set = PALETTE[isDark() ? "dark" : "light"];
    return set[d] ?? set.unknown;
  };
  // Kept as a live view for anything outside this module that wants the legend.
  const DOMAIN_COLORS = new Proxy({}, {
    get: (_, k) => (typeof k === "string" ? domainColor(k) : undefined),
    has: () => true,
  });
  // A chapter can hold 20+ sections; laid out in one line the whole graph becomes
  // a few pixels tall and a mile wide. Wrapping long layers keeps the aspect
  // readable without breaking the top-to-bottom prerequisite reading.
  // Chapter labels are centred on their node and run wide, so the gap between book
// cards has to clear a label, not just a node.
// Layout metric, in world units. COL is the horizontal pitch between sibling
// concepts and has to clear a truncated label; ROW is the vertical pitch between
// prerequisite layers, which is what the eye reads as "comes first".
const COL = 96, ROW = 132, SUBROW = 32, WRAP = 10;
// Card padding, and the gap between packed cards. The top pad clears the card's
// own title block plus the chapter labels drawn above the first node row.
const PAD_X = 42, PAD_TOP = 104, PAD_BOTTOM = 42, CARD_GAP = 86;
// Chapter labels are centred on their node and run far wider than it, so a card
// whose layers are two nodes across still has to hold a 25-character heading.
const MIN_CARD_W = 320;

  let nodes = [], edges = [], byId = new Map(), mastery = new Map();
  let prereqIn = new Map(), prereqOut = new Map();
  let view = { x: 0, y: 0, k: 0.7 };
  let hover = null, selected = null, panning = null;
  let bounds = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  let groups = [], cardOf = new Map();
  const BOOK_TITLES = {};
  const DOMAIN_TITLES = {
    "probability": "Probability", "real analysis": "Real analysis",
    "linear algebra": "Linear algebra", "abstract algebra": "Abstract algebra",
    "number theory": "Number theory", "complex analysis": "Complex analysis",
    "inequalities": "Inequalities", "mental math": "Mental math",
    "estimation": "Estimation", "machine learning": "Machine learning",
    "contest": "Contest problems", "unknown": "Other",
  };

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

    // Chapter/source nodes are useful metadata, but they are not learner
    // destinations. Keeping them on the canvas creates the little squares and
    // labels that make the overview resemble a table of contents instead of a
    // knowledge map. Concepts carry the topology; the inspector carries source
    // structure.
    const keep = new Set(["concept"]);
    // A node is useful on the learner's map only when it can lead to something
    // they can actually do. Source books often contain section headings that
    // extracted cleanly but have no readable exercise attached; showing those
    // as equal peers makes the graph promise practice that the queue cannot
    // deliver. The API counts both direct exercises and semantic topic links.
    const activeConcepts = g.nodes.filter((n) => n.kind === "concept"
      && (n.exercise_count ?? 0) > 0);
    nodes = g.nodes.filter((n) => keep.has(n.kind) && (n.exercise_count ?? 0) > 0)
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
      `${nodes.filter((n) => n.kind === "concept").length} active concepts · ${edges.filter((e) => e.type === "prerequisite").length} prerequisites`
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
        domainColor(d)}"></i>${esc(d)}</span>`).join("")
      + `<span class="legend-item legend-note">top → bottom = prerequisite order · hollow = unassessed</span>`;
    fit();
  }

  // ---- layered layout -----------------------------------------------------

  function structuralEdges() {
    // `contains` keeps a chapter next to its sections; `prerequisite` sets the order.
    return edges.filter((e) => e.type === "prerequisite" || e.type === "contains");
  }

  // `only` narrows the layout to one field. Filtering used to hide nodes while
  // leaving the whole-graph geometry in place, so choosing "complex analysis"
  // gave you six dots marooned in an empty acre at a zoom fitted to everything.
  // Laying out just the field it is asked for is what makes the filter useful.
  let layoutDomain = null;

  function layout(only = null) {
    layoutDomain = only;
    const live = only ? nodes.filter((n) => n.domain === only) : nodes;
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

    // 2. One block per domain. Books remain source metadata in the inspector;
    //    the overview should communicate the shape of knowledge, not the number
    //    of imported PDFs. This also keeps ML foundation topics together.
    const byDomain = new Map();
    for (const n of live) {
      const key = n.domain ?? "unknown";
      if (!byDomain.has(key)) byDomain.set(key, []);
      byDomain.get(key).push(n);
    }
    const components = [...byDomain.values()].sort((a, b) => b.length - a.length);

    // 3. within each block: order nodes per layer, then sweep barycentres to
    //    cut edge crossings. Each block is laid out at its own origin first and
    //    packed afterwards — placing as we go produced a ragged field with metres
    //    of dead space between the small cards and the big ones, which is what
    //    forced the whole-graph zoom down to an unreadable level.
    const boxes = [];

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
              .filter((x) => x.domain === n.domain);
            n.bary = nbrs.length ? nbrs.reduce((s2, x) => s2 + x.pos, 0) / nbrs.length : n.pos;
          }
          row.sort((a, b) => a.bary - b.bary);
          row.forEach((n, i) => { n.pos = i; });
        }
      }
      const width = Math.min(WRAP, Math.max(...keys.map((k) => layers.get(k).length)));
      // Local coordinates: the first node row starts at y = 0, and the card's
      // own padding is added when the box is measured.
      let y = 0;
      for (const k of keys) {
        const row = layers.get(k);
        const lines = Math.ceil(row.length / WRAP);
        row.forEach((n, i) => {
          const line = Math.floor(i / WRAP);
          const inLine = i % WRAP;
          const count = Math.min(WRAP, row.length - line * WRAP);
          n.x = ((width - count) / 2 + inLine) * COL;
          n.y = y + line * SUBROW;
        });
        // A wrapped layer needs its own height, plus a gap before the next one.
        y += lines > 1 ? lines * SUBROW + ROW * 0.55 : ROW;
      }
      const xs = group.map((n) => n.x), ys = group.map((n) => n.y);
      const domain = group[0]?.domain ?? "unknown";
      boxes.push({
        domain,
        nodes: group,
        size: group.length,
        // Local bounds, padded out to the card edge.
        lx0: Math.min(...xs) - PAD_X, ly0: Math.min(...ys) - PAD_TOP,
        w: Math.max(MIN_CARD_W, Math.max(...xs) - Math.min(...xs) + PAD_X * 2),
        h: Math.max(...ys) - Math.min(...ys) + PAD_TOP + PAD_BOTTOM,
      });
    }

    // 4. shelf-pack the cards. Rows are filled to a target width derived from
    //    the total area at a 16:10 aspect, so the whole picture lands close to
    //    the shape of the screen it has to fit into — which is what lets `fit`
    //    choose a zoom where the labels are actually readable.
    const area = boxes.reduce((a, b) => a + (b.w + CARD_GAP) * (b.h + CARD_GAP), 0);
    const targetW = Math.max(
      Math.max(...boxes.map((b) => b.w)),
      Math.sqrt(area * 1.6),
    );
    boxes.sort((a, b) => b.h - a.h || b.size - a.size);

    let shelfX = 0, shelfY = 0, shelfH = 0;
    for (const box of boxes) {
      if (shelfX > 0 && shelfX + box.w > targetW) {
        shelfX = 0;
        shelfY += shelfH + CARD_GAP;
        shelfH = 0;
      }
      // Translate the block from its local origin onto the shelf.
      const spread = Math.max(...box.nodes.map((n) => n.x))
                   - Math.min(...box.nodes.map((n) => n.x));
      const dx = shelfX - box.lx0 + (box.w - spread - PAD_X * 2) / 2;
      const dy = shelfY - box.ly0;
      for (const n of box.nodes) { n.x += dx; n.y += dy; }
      box.x0 = shelfX; box.y0 = shelfY;
      box.x1 = shelfX + box.w; box.y1 = shelfY + box.h;
      shelfX += box.w + CARD_GAP;
      shelfH = Math.max(shelfH, box.h);
    }

    // Keep even a small domain as a card: the card title is the orientation
    // system in the overview, and a one-node domain should not become an
    // unexplained floating dot.
    groups = boxes;
    cardOf = new Map();
    for (const g of groups) for (const n of g.nodes) cardOf.set(n.id, g);

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
    // The title block hangs 42 screen pixels above its card whatever the zoom, so
    // the top inset has to clear the controls *and* a title.
    const insetTop = 124, insetSide = 22, insetBottom = 58;
    const availW = Math.max(120, w - insetSide * 2);
    const availH = Math.max(120, h - insetTop - insetBottom);
    view.k = Math.max(0.08, Math.min(1.4, Math.min(availW / (gw + 60), availH / (gh + 60))));
    const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
    view.x = (insetSide + availW / 2) - w / 2 - cx * view.k;
    view.y = (insetTop + availH / 2) - h / 2 - cy * view.k;
  }

  // ---- drawing ------------------------------------------------------------

  const radius = (n) => n.kind === "domain_part" ? 11 : 6 + Math.min(Math.sqrt(n.deg) * 2.0, 11);

  /** Mastery runs from the danger hue to the accent hue — the same two ends the
   *  rest of the app uses for "weak" and "solid", so the graph reads with it. */
  function masteryColor(n) {
    const m = mastery.get(n.id);
    if (!m) return null;
    const t = Math.max(0, Math.min(1, m.mastery));
    const dark = isDark();
    const hue = 355 + t * 190;                    // 355° rose → 185° teal
    return `hsl(${hue % 360} ${dark ? 62 : 58}% ${dark ? 62 : 46}%)`;
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
    // Semantic zoom: the overview is a topology map, not a scaled wall of text.
    // Domain headers are always visible; concept labels earn their space only
    // near the learner's focus or once the local topology is readable.
    const labelZoom = view.k > 0.78;
    const localZoom = view.k > 0.46;
    const q = document.getElementById("graphSearch").value.trim().toLowerCase();
    const line = css("--border-strong", "#ccc"), ink = css("--text", "#222");
    const accent = css("--primary", "#4f46e5");
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
    const surface = css("--surface-2", "#f5f5f5");
    for (const g of groups) {
      if (df && g.domain !== df) continue;
      ctx.fillStyle = surface;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.roundRect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0, 22);
      ctx.fill();
      // A hairline in the book's own hue, so a card is identifiable before its
      // title is legible.
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = domainColor(g.domain);
      ctx.lineWidth = 1.5 / view.k;
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

    // Selected/hovered concepts get first claim on space, then the
    // best-connected concepts when the camera is close enough. At overview and
    // mid zoom the nodes remain intentionally unlabeled, like the product mock.
    const sorted = [...nodes].sort((a, b) =>
      (a === selected ? -3 : a === hover ? -2 : near.has(a.id) ? -1 : 0)
        - (b === selected ? -3 : b === hover ? -2 : near.has(b.id) ? -1 : 0)
      || b.deg - a.deg);
    for (const n of sorted) {
      if (!visible(n)) continue;
      const r = radius(n);
      const match = q && n.label.toLowerCase().includes(q);
      const dim = (focus && !near.has(n.id)) || (q && !match);
      ctx.globalAlpha = dim ? 0.13 : 1;
      const mc = useMastery ? masteryColor(n) : null;
      ctx.fillStyle = mc ?? domainColor(n.domain);

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
        const important = n === selected || n === hover || near.has(n.id) || match;
        const anchor = !important && localZoom && n.deg >= 7;
        const big = important || anchor;
        const size = (big ? 13 : 11) / view.k;
        // At whole-graph zoom there are no concept labels. At mid zoom only a
        // handful of structural anchors appear; close zoom reveals the local
        // neighborhood and its labels.
        if (important || (labelZoom && anchor)) {
          ctx.font = `${big ? 600 : 400} ${size}px Inter, system-ui, sans-serif`;
          // The font is set in world units (size / view.k), so measureText comes
          // back in world units too and can be compared against the card.
          const card = cardOf.get(n.id);
          const room = card ? card.x1 - card.x0 - 24 : Infinity;
          let label = n.label.length > 34 ? n.label.slice(0, 32) + "…" : n.label;
          while (label.length > 4 && ctx.measureText(label).width > room) {
            label = label.slice(0, -2) + "…";
          }
          const wid = ctx.measureText(label).width;
          // Labels are centred on the node, so one near a card edge would hang
          // outside it — and over the card next door. Nudge it back inside.
          let lx = n.x;
          if (card) {
            lx = Math.min(Math.max(lx, card.x0 + wid / 2 + 12), card.x1 - wid / 2 - 12);
          }
          // Everything competes for label space; priority comes from draw order.
          if (fits(lx, n.y - r - 6 / view.k, wid)) {
            ctx.globalAlpha = big ? 1 : 0.72;
            ctx.fillStyle = ink;
            ctx.textAlign = "center";
            ctx.fillText(label, lx, n.y - r - 6 / view.k);
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
      if (cardW < 68) continue;                       // too small to label honestly
      const title = (DOMAIN_TITLES[g.domain] ?? g.domain ?? "Other").toUpperCase();
      ctx.font = '600 11.5px Inter, system-ui, sans-serif';
      const tw = Math.min(ctx.measureText(title).width, cardW - 26);
      const ty = a.y - 42;
      ctx.fillStyle = css("--surface", "#fff");
      ctx.globalAlpha = 0.96;
      ctx.beginPath();
      ctx.roundRect(a.x, ty, tw + 22, 36, 9);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = domainColor(g.domain);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.rect(a.x, ty, tw + 14, 36);
      ctx.clip();
      ctx.globalAlpha = 1;
      ctx.fillStyle = domainColor(g.domain);
      ctx.textAlign = "left";
      ctx.fillText(title, a.x + 11, ty + 15);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = ink;
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.fillText(`${g.size} concepts · ${g.domain ?? ""}`, a.x + 11, ty + 28);
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

  /** Centre a node and zoom in far enough to read its neighbourhood. Jumping to
   *  a concept at whole-graph zoom put a 6px dot in the middle of the screen. */
  function focusNode(n, k = 1.0) {
    view.k = Math.max(view.k, k);
    view.x = -n.x * view.k;
    view.y = -n.y * view.k;
  }

  function inspect(n, push = true) {
    selected = n;
    canvas.closest(".graph-stage")?.classList.toggle("has-inspector", Boolean(n));
    // The hash makes a concept linkable: graph.html#<concept id> opens its plan.
    if (push) {
      const want = n ? `#explore|${encodeURIComponent(n.id)}` : "#explore";
      if (location.hash !== want) history.replaceState(null, "", want || location.pathname);
    }
    if (!n) { inspector.hidden = true; canvas.closest(".graph-stage")?.classList.remove("has-inspector"); return; }
    inspector.hidden = false;
    const m = mastery.get(n.id);
    const plan = learningPlan(n);
    const todo = plan.filter((p) => !p.done);
    const unlocks = prereqOut.get(n.id).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
    const prereqs = prereqIn.get(n.id).sort((a, b) => b.confidence - a.confidence).slice(0, 6);
    const status = m ? (m.mastery >= 0.8 ? "mastered" : m.mastery >= 0.5 ? "learning" : "ready") : "new";
    const aligns = edges.filter((e) => e.type === "aligns_with" && (e.s === n || e.t === n));

    inspector.innerHTML = `
      <button class="inspector-close" type="button" aria-label="Close">×</button>
      <p class="inspector-eyebrow">CONCEPT</p>
      <h3>${esc(n.label)}</h3>
      <p class="inspector-meta">${esc(n.domain ?? "")}${n.book_id ? ` · ${esc(BOOK_TITLES[n.book_id] ?? n.book_id)}` : ""}${
        n.page ? ` · p.${n.page}` : ""} · layer ${n.layer}</p>
      <p class="inspector-status"><i class="status-dot ${status}"></i>${status === "new" ? "Not yet assessed" : status}
        ${m ? `<span class="dim">${Math.round(m.mastery * 100)}% · ${m.attempts} attempt${m.attempts === 1 ? "" : "s"}</span>` : ""}</p>
      ${n.blurb ? `<p class="inspector-blurb">${esc(n.blurb)}</p>` : ""}
      ${n.exercise_count ? `<p class="inspector-mastery"><b>${n.exercise_count}</b> exercise${n.exercise_count === 1 ? "" : "s"} available</p>` : ""}
      <div class="inspector-actions inspector-primary">
        <a class="btn-primary" href="#study|${new URLSearchParams({ kind: n.generated ? "drill" : "study",
          ...(n.generated ? { skills: n.id } : { concepts: n.id }), count: "8", label: n.label })}">▶ Practice this</a>
      </div>
      <nav class="inspector-tabs"><button type="button" data-scroll="prereqs">Prerequisites</button><button type="button" data-scroll="next">Builds toward</button><button type="button" data-scroll="plan">Plan</button></nav>
      <h4 id="prereqs">Prerequisites${prereqs.length ? ` (${prereqs.length})` : ""}</h4>
      <ul>${prereqs.map((e) => `<li><a href="#" data-goto="${esc(e.s.id)}">${esc(e.s.label)}</a>
        <span class="dim">${mastery.get(e.s.id) ? `${Math.round(mastery.get(e.s.id).mastery * 100)}%` : "new"}</span></li>`).join("") || '<li class="dim">No recorded prerequisites</li>'}</ul>
      ${m ? `<p class="inspector-mastery">mastery <b>${Math.round(m.mastery * 100)}%</b>
             <span class="dim">from ${m.attempts} attempt${m.attempts === 1 ? "" : "s"}</span></p>`
          : `<p class="inspector-mastery dim">not yet assessed</p>`}

      <h4 id="plan">Learning plan${todo.length ? ` — ${todo.length} to go` : " — clear"}</h4>
      <ol class="plan">${plan.map((p) => `
        <li class="${p.done ? "done" : ""}">
          <a href="#" data-goto="${esc(p.node.id)}">${esc(p.node.label)}</a>
          ${p.mastery === null ? '<span class="dim">new</span>'
            : `<span class="dim">${Math.round(p.mastery * 100)}%</span>`}
        </li>`).join("")}</ol>

      ${unlocks.length ? `<h4 id="next">Builds toward</h4><ul>${unlocks.map((e) =>
        `<li><a href="#" data-goto="${esc(e.t.id)}">${esc(e.t.label)}</a></li>`).join("")}</ul>` : ""}
      ${aligns.length ? `<h4>Also covered by</h4><ul>${aligns.map((e) => (e.s === n ? e.t : e.s))
        .map((o) => `<li><a href="#" data-goto="${esc(o.id)}">${esc(o.label)}</a>
          <span class="dim">${esc(o.book_id ?? "")}</span></li>`).join("")}</ul>` : ""}
      <div class="inspector-actions">
        <a class="ghost-btn" href="#study|${new URLSearchParams({ kind: "study",
          concepts: n.id, count: "8", label: n.label })}">Practise this topic</a>
        ${n.domain ? `<a class="ghost-btn" href="#study|${new URLSearchParams({
          kind: "study", domains: n.domain, count: "10", label: n.domain })}"
          >Study this field</a>` : ""}
        ${n.domain ? `<a class="ghost-btn" href="#subject|${
          encodeURIComponent(n.domain)}">Open the field</a>` : ""}
      </div>`;
    window.Lattice.typeset(inspector);
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
    const tab = ev.target.closest("[data-scroll]");
    if (tab) {
      inspector.querySelector(`#${tab.dataset.scroll}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const link = ev.target.closest("[data-goto]");
    if (link) {
      ev.preventDefault();
      const n = byId.get(link.dataset.goto);
      if (n) { focusNode(n); inspect(n); }
    }
  });
  document.getElementById("domainFilter").addEventListener("change", (ev) => {
    layout(ev.target.value || null);
    if (selected && selected.domain !== ev.target.value && ev.target.value) inspect(null);
    fit();
  });
  document.getElementById("replay").addEventListener("click", () => {
    // "Fit to view" fits what is on screen — the field, if one is chosen.
    layout(document.getElementById("domainFilter").value || null);
    fit();
  });
  window.addEventListener("resize", () => fit());

  function frame() {
    // The canvas is one of four views; repainting it while it is off screen
    // burned a frame budget for nothing.
    if (window.Lattice.visible("explore")) draw();
    requestAnimationFrame(frame);
  }
  function routeFromHash() {
    // The shell owns the hash; a concept id arrives as "explore|<id>" or bare.
    const raw = decodeURIComponent(location.hash.slice(1));
    const id = raw.startsWith("explore|") ? raw.slice("explore|".length) : raw;
    const n = id && byId.get(id);
    if (n) { focusNode(n); inspect(n, false); return; }
    // A field name works as well as a concept id: #explore|complex analysis
    // filters the map to that field and fits it.
    const domains = new Set(nodes.map((x) => x.domain));
    if (id && domains.has(id)) {
      const sel = document.getElementById("domainFilter");
      sel.value = id;
      layout(id);
      fit();
      inspect(null, false);
    }
  }

  async function init() {
    await ensureLoaded();
    routeFromHash();
    frame();
    // The canvas has no size until its view is on screen, so refit on activation.
    window.addEventListener("lattice:view", (e) => {
      if (e.detail.view === "explore") setTimeout(fit, 0);
    });
    // Arriving from elsewhere — a subject page, a problem card — must land on the
    // thing that was linked, not on wherever the canvas was last left.
    window.addEventListener("lattice:route", (e) => {
      if (e.detail.view === "explore") setTimeout(routeFromHash, 0);
    });
    setTimeout(fit, 0);
  }

  /** A still miniature of the same layout, for Home. Cards and nodes only: at
   *  200px wide, edges and labels are noise. */
  async function drawMini(mini) {
    await ensureLoaded();
    const dpr = window.devicePixelRatio || 1;
    const w = mini.clientWidth, h = mini.clientHeight;
    if (!w || !h) return;
    mini.width = w * dpr; mini.height = h * dpr;
    const c = mini.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const gw = bounds.maxX - bounds.minX || 1, gh = bounds.maxY - bounds.minY || 1;
    const k = Math.min((w - 16) / gw, (h - 16) / gh);
    const ox = 8 - bounds.minX * k, oy = 8 - bounds.minY * k;
    for (const g of groups) {
      c.fillStyle = css("--surface-2", "#eee");
      c.globalAlpha = 0.7;
      c.beginPath();
      c.roundRect(g.x0 * k + ox, g.y0 * k + oy, (g.x1 - g.x0) * k, (g.y1 - g.y0) * k, 4);
      c.fill();
    }
    for (const n of nodes) {
      const mc = masteryColor(n);
      c.globalAlpha = mc ? 1 : 0.5;
      c.fillStyle = mc ?? domainColor(n.domain);
      c.beginPath();
      c.arc(n.x * k + ox, n.y * k + oy, n.kind === "domain_part" ? 2.4 : 1.7, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    return [...new Set(nodes.map((n) => n.domain).filter(Boolean))].sort();
  }

  let loaded = null;
  const ensureLoaded = () => (loaded ??= load());

  window.LatticeGraph = { drawMini, colors: DOMAIN_COLORS };

  window.Lattice.register("explore", () => init().catch((err) => {
    document.getElementById("graphCount").textContent =
      `graph unavailable (${err.message}) — run the pipeline, then reload`;
  }));
})();
