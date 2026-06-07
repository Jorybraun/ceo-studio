// AGUI component registry — the set of components the CEO is allowed to render
// into the left panel. The agent proposes a component tree (in AG-UI shared
// state under `ui`); this registry validates each node by type and mounts a
// safe DOM element for it. Unknown types render as a labelled fallback.
//
// This file is bundled into the browser by esbuild (see npm run build:agui).
// It uses libraries already loaded globally in index.html (marked, mermaid,
// highlight.js) rather than importing them, to keep the bundle lean.

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const md = (s) => (window.marked ? window.marked.parse(String(s || "")) : esc(s));

let _mermaidSeq = 0;

// Each renderer returns an HTMLElement. props is the component minus `type`.
const RENDERERS = {
  heading({ text, level }) {
    const l = Math.min(4, Math.max(1, Number(level) || 2));
    const el = document.createElement(`h${l}`);
    el.className = {
      1: "text-2xl font-bold text-neutral-100 mb-2",
      2: "text-xl font-semibold text-neutral-100 mb-2",
      3: "text-lg font-semibold text-neutral-200 mb-1.5",
      4: "text-base font-medium text-neutral-200 mb-1",
    }[l];
    el.textContent = String(text || "");
    return el;
  },

  text({ content }) {
    const el = document.createElement("p");
    el.className = "text-sm text-neutral-300 leading-relaxed mb-2";
    el.textContent = String(content || "");
    return el;
  },

  markdown({ content }) {
    const el = document.createElement("div");
    el.className = "prose prose-invert prose-sm max-w-none mb-3";
    el.innerHTML = md(content);
    return el;
  },

  code({ language, content }) {
    const wrap = document.createElement("pre");
    wrap.className = "rounded-lg border border-neutral-800 bg-neutral-950/80 p-3 overflow-auto mb-3 text-[12px]";
    const code = document.createElement("code");
    code.className = `language-${esc(language || "text")}`;
    code.textContent = String(content || "");
    wrap.appendChild(code);
    try { if (window.hljs) window.hljs.highlightElement(code); } catch { /* optional */ }
    return wrap;
  },

  mermaid({ diagram }) {
    const el = document.createElement("div");
    el.className = "my-3 flex justify-center rounded-lg border border-neutral-800 bg-neutral-950/50 p-3 overflow-auto";
    const id = `agui-mermaid-${++_mermaidSeq}`;
    const src = String(diagram || "");
    if (window.mermaid && window.mermaid.render) {
      // mermaid.render is async in v10+; render into the element when ready.
      Promise.resolve()
        .then(() => window.mermaid.render(id, src))
        .then(({ svg }) => { el.innerHTML = svg; })
        .catch((e) => { el.innerHTML = `<pre class="text-[11px] text-red-400">mermaid error: ${esc(e && e.message)}</pre>`; });
    } else {
      el.innerHTML = `<pre class="text-[12px] text-neutral-400">${esc(src)}</pre>`;
    }
    return el;
  },

  card({ title, body }) {
    const el = document.createElement("div");
    el.className = "rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 mb-3";
    if (title) {
      const h = document.createElement("div");
      h.className = "text-sm font-semibold text-neutral-100 mb-1.5";
      h.textContent = String(title);
      el.appendChild(h);
    }
    const b = document.createElement("div");
    b.className = "prose prose-invert prose-sm max-w-none text-neutral-300";
    b.innerHTML = md(body);
    el.appendChild(b);
    return el;
  },

  list({ items, ordered }) {
    const el = document.createElement(ordered ? "ol" : "ul");
    el.className = `${ordered ? "list-decimal" : "list-disc"} pl-5 text-sm text-neutral-300 space-y-1 mb-3`;
    (Array.isArray(items) ? items : []).forEach((it) => {
      const li = document.createElement("li");
      li.textContent = String(it);
      el.appendChild(li);
    });
    return el;
  },

  table({ headers, rows }) {
    const wrap = document.createElement("div");
    wrap.className = "overflow-auto mb-3 rounded-lg border border-neutral-800";
    const t = document.createElement("table");
    t.className = "w-full text-sm text-left text-neutral-300";
    if (Array.isArray(headers) && headers.length) {
      const thead = document.createElement("thead");
      thead.className = "bg-neutral-900/80 text-neutral-200";
      const tr = document.createElement("tr");
      headers.forEach((h) => {
        const th = document.createElement("th");
        th.className = "px-3 py-2 font-medium border-b border-neutral-800";
        th.textContent = String(h);
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      t.appendChild(thead);
    }
    const tbody = document.createElement("tbody");
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const tr = document.createElement("tr");
      tr.className = "border-b border-neutral-800/60";
      (Array.isArray(row) ? row : [row]).forEach((cell) => {
        const td = document.createElement("td");
        td.className = "px-3 py-2";
        td.textContent = String(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrap.appendChild(t);
    return wrap;
  },

  callout({ variant, text }) {
    const v = ["info", "success", "warn", "error"].includes(variant) ? variant : "info";
    const styles = {
      info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
      success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
      warn: "border-amber-500/40 bg-amber-500/10 text-amber-200",
      error: "border-red-500/40 bg-red-500/10 text-red-200",
    };
    const icon = { info: "ℹ", success: "✓", warn: "⚠", error: "✕" }[v];
    const el = document.createElement("div");
    el.className = `rounded-lg border px-3 py-2.5 mb-3 text-sm ${styles[v]}`;
    el.innerHTML = `<span class="font-semibold mr-1.5">${icon}</span>${esc(text)}`;
    return el;
  },

  image({ url, alt }) {
    const el = document.createElement("img");
    el.className = "rounded-lg border border-neutral-800 max-w-full mb-3";
    el.src = String(url || "");
    el.alt = String(alt || "");
    return el;
  },

  divider() {
    const el = document.createElement("hr");
    el.className = "border-neutral-800 my-4";
    return el;
  },
};

function renderComponent(node) {
  if (!node || typeof node !== "object") return null;
  const fn = RENDERERS[node.type];
  // Merge top-level properties (except `type`) into props so callers
  // can use either { type, props: {...} } or { type, ...props }.
  const props = { ...(node.props || {}) };
  Object.entries(node).forEach(([k, v]) => {
    if (k !== "type" && k !== "props" && !(k in props)) props[k] = v;
  });
  if (!fn) {
    const el = document.createElement("div");
    el.className = "text-[11px] text-neutral-600 italic mb-2";
    el.textContent = `[unknown component: ${node.type}]`;
    return el;
  }
  try { return fn(props); }
  catch (e) {
    const el = document.createElement("div");
    el.className = "text-[11px] text-red-400 mb-2";
    el.textContent = `[render error in ${node.type}: ${e && e.message}]`;
    return el;
  }
}

/** Render a UI tree ({ title, components:[{type,props}] }) into `host`. */
export function renderUi(host, ui) {
  if (!host) return;
  host.innerHTML = "";
  if (!ui || !Array.isArray(ui.components)) {
    host.innerHTML = `<div class="text-neutral-600 text-sm">Panel ready — ask the CEO to show something.</div>`;
    return;
  }
  if (ui.title) {
    const h = document.createElement("div");
    h.className = "text-[11px] uppercase tracking-wider text-neutral-500 mb-3 pb-2 border-b border-neutral-800/60";
    h.textContent = ui.title;
    host.appendChild(h);
  }
  ui.components.forEach((node) => {
    const el = renderComponent(node);
    if (el) host.appendChild(el);
  });
}

export const COMPONENT_TYPES = Object.keys(RENDERERS);
