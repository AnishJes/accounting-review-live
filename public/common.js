// Small helpers shared by the host and player screens.
const SHAPES = [
  '<svg viewBox="0 0 32 32"><path d="M16 3 L30 28 H2 Z" fill="#fff"/></svg>',               // triangle
  '<svg viewBox="0 0 32 32"><path d="M16 2 L30 16 L16 30 L2 16 Z" fill="#fff"/></svg>',      // diamond
  '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="#fff"/></svg>',             // circle
  '<svg viewBox="0 0 32 32"><rect x="4" y="4" width="24" height="24" rx="2" fill="#fff"/></svg>', // square
  '<svg viewBox="0 0 32 32"><path d="M16 2 L20 12 L31 12 L22 19 L25 30 L16 23 L7 30 L10 19 L1 12 L12 12 Z" fill="#fff"/></svg>',
  '<svg viewBox="0 0 32 32"><path d="M9 3 H23 L30 16 L23 29 H9 L2 16 Z" fill="#fff"/></svg>',
  '<svg viewBox="0 0 32 32"><path d="M16 29 C3 20 2 12 7 7 C11 3 15 5 16 8 C17 5 21 3 25 7 C30 12 29 20 16 29 Z" fill="#fff"/></svg>',
];
// True/False gets blue diamond for True and red triangle for False, like the real thing
const tfColor = (i) => (i === 0 ? 1 : 0);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v; // only used with our own SVG strings
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
}
function dataTable(header, rows) {
  if (!rows || !rows.length) return null;
  const t = el("table", { class: "data" });
  if (header) t.append(el("thead", {}, el("tr", {}, header.map((h) => el("th", {}, h)))));
  t.append(el("tbody", {}, rows.map((r) => el("tr", {}, r.map((c) => el("td", {}, c))))));
  return el("div", { class: "tablewrap" }, t);
}
function tileColor(q, i) { return q.type === "tf" ? tfColor(i) : i; }
function makeTimer(deadline, serverNow) {
  const offset = serverNow - Date.now();
  return () => Math.max(0, (deadline - (Date.now() + offset)) / 1000);
}
