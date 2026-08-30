// Browsing every exercise in the graph.
//
// The graph knew about 3,410 exercises before this page existed, but there was
// nowhere to read one — the concept map showed dots and the bank showed only
// Putnam. This is the missing middle: filter by domain, book and tier, read the
// statement where we hold it locally, and grade it into the same memory.
(() => {
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const LIMIT = 30;
  let offset = 0, total = 0, loading = false;

  const params = () => {
    const p = new URLSearchParams({ limit: LIMIT, offset });
    const q = el("q").value.trim();
    if (q) p.set("q", q);
    for (const k of ["domain", "book", "tier", "sort"]) {
      if (el(k).value) p.set(k, el(k).value);
    }
    if (el("unsolved").checked) p.set("unsolved", "1");
    if (el("garbled").checked) p.set("garbled", "1");
    const concept = new URLSearchParams(location.search).get("concept");
    if (concept) p.set("concept", concept);
    return p;
  };

  const TIER_LABEL = { W1: "warm-up", W2: "bridge", core: "core" };

  function card(e) {
    const body = e.text
      ? `<div class="p-text">${esc(e.text)}</div>`
      : `<div class="p-text missing">Text not stored for this book — see
           <b>${esc(e.cite)}</b>. Run the extractor locally to read it here.</div>`;
    return `
      <article class="p-card" data-id="${esc(e.id)}" data-concept="${esc(e.concept_id ?? "")}">
        <header class="p-head">
          <span class="p-tier tier-${esc(e.tier)}">${esc(TIER_LABEL[e.tier] ?? e.tier)}</span>
          <a class="p-concept" href="graph.html#${encodeURIComponent(e.concept_id ?? "")}"
             title="Open in the graph">${esc(e.section_title ?? "")}</a>
          <span class="p-cite">${esc(e.cite)}</span>
          ${e.has_published_solution ? '<span class="p-flag">solution published</span>' : ""}
          ${(e.garble ?? 0) > 0.35 ? '<span class="p-flag warn">OCR — check the book</span>' : ""}
          <span class="p-status status-${esc(e.status)}">${esc(e.status.replace("_", " "))}</span>
        </header>
        ${body}
        <footer class="p-actions">
          <button class="grade" data-outcome="solved">Solved</button>
          <button class="grade" data-outcome="partial">Partial</button>
          <button class="grade" data-outcome="failed">Failed</button>
          <button class="star ${e.starred ? "on" : ""}" data-star title="Star">★</button>
        </footer>
      </article>`;
  }

  async function load(reset) {
    if (loading) return;
    loading = true;
    if (reset) { offset = 0; el("pfList").innerHTML = ""; }
    try {
      const data = await fetch(`/api/exercises?${params()}`).then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`);
        return r.json();
      });
      total = data.total;
      el("pfList").insertAdjacentHTML("beforeend", data.items.map(card).join(""));
      offset += data.items.length;
      el("count").textContent = `${total.toLocaleString()} problems`;
      el("more").hidden = offset >= total;
      el("footNote").textContent = total ? `showing ${offset} of ${total.toLocaleString()}`
        : "nothing matches those filters";
      if (window.MathJax?.typesetPromise) MathJax.typesetPromise([el("pfList")]).catch(() => {});
    } catch (err) {
      el("pfList").innerHTML = `<p class="dim">Problems need the server API (${esc(err.message)}).
        Start it with <code>npm start</code>.</p>`;
      el("more").hidden = true;
    } finally {
      loading = false;
    }
  }

  async function facets() {
    try {
      const f = await fetch("/api/facets").then((r) => r.json());
      for (const [id, list] of [["domain", f.domains], ["book", f.books]]) {
        for (const o of list) {
          const opt = document.createElement("option");
          opt.value = o.value;
          opt.textContent = `${o.value} (${o.count})`;
          el(id).appendChild(opt);
        }
      }
      el("tagline").textContent =
        `${(f.total - f.garbled).toLocaleString()} readable exercises from ${
          f.books.length} sources.`;
      if (f.garbled) {
        el("garbledNote").textContent =
          `${f.garbled} hidden — OCR left them unreadable`;
      }
    } catch { /* offline: filters stay minimal */ }
  }

  el("pfList").addEventListener("click", async (ev) => {
    const card = ev.target.closest(".p-card");
    if (!card) return;
    const grade = ev.target.closest(".grade");
    const star = ev.target.closest("[data-star]");
    if (grade) {
      await fetch("/api/attempt", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: card.dataset.id, item_type: "exercise",
          concept_id: card.dataset.concept || null, outcome: grade.dataset.outcome,
        }),
      }).catch(() => {});
      const badge = card.querySelector(".p-status");
      const st = grade.dataset.outcome === "solved" ? "solved" : "in progress";
      badge.textContent = st;
      badge.className = `p-status status-${st.replace(" ", "_")}`;
      grade.classList.add("flash");
      setTimeout(() => grade.classList.remove("flash"), 500);
    }
    if (star) {
      const on = !star.classList.contains("on");
      star.classList.toggle("on", on);
      await fetch("/api/star", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: card.dataset.id, item_type: "exercise", starred: on }),
      }).catch(() => {});
    }
  });

  let debounce;
  el("q").addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => load(true), 250);
  });
  for (const id of ["domain", "book", "tier", "sort", "unsolved"]) {
    el(id).addEventListener("change", () => load(true));
  }
  el("more").addEventListener("click", () => load(false));

  window.Lattice.register("problems", () => facets().then(() => load(true)));
})();
