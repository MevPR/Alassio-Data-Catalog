/* Tiny namespace-aware XML parser — enough for OData EDMX ($metadata) documents, no dependency.
   Produces { tag (local name), ns (namespace URI or ""), attrs { "local": v, "{ns}local": v }, children [] }.
   Handles prolog, comments, CDATA, self-closing tags, default and prefixed namespaces, entity references. */

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export const decodeEntities = (s) => s.includes("&") ? s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => {
  if (e[0] === "#") { const cp = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(cp) ? String.fromCodePoint(cp) : m; }
  return ENTITIES[e] !== undefined ? ENTITIES[e] : m;
}) : s;

const ATTR_RE = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(input) {
  const text = Buffer.isBuffer(input) ? input.toString("utf8") : String(input);
  const root = { tag: "#document", ns: "", attrs: {}, children: [] };
  const stack = [{ node: root, nsMap: { "": "", xml: "http://www.w3.org/XML/1998/namespace" } }];
  let i = 0; const n = text.length;
  const top = () => stack[stack.length - 1];
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) { const t = text.slice(i, lt); if (t.trim()) top().node.children.push({ text: decodeEntities(t) }); }
    if (text.startsWith("<!--", lt)) { const e = text.indexOf("-->", lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith("<![CDATA[", lt)) { const e = text.indexOf("]]>", lt + 9); top().node.children.push({ text: text.slice(lt + 9, e < 0 ? n : e) }); i = e < 0 ? n : e + 3; continue; }
    if (text.startsWith("<?", lt)) { const e = text.indexOf("?>", lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (text.startsWith("<!", lt)) { const e = text.indexOf(">", lt + 2); i = e < 0 ? n : e + 1; continue; }
    // find the end of the tag, respecting quoted attribute values
    let j = lt + 1, quote = null;
    while (j < n) { const c = text[j]; if (quote) { if (c === quote) quote = null; } else if (c === '"' || c === "'") quote = c; else if (c === ">") break; j++; }
    const raw = text.slice(lt + 1, j); i = j + 1;
    if (raw.startsWith("/")) { if (stack.length > 1) stack.pop(); continue; }
    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([^\s\/>]+)/.exec(body);
    if (!m) continue;
    const qname = m[1];
    const rawAttrs = {}; let a;
    ATTR_RE.lastIndex = m[0].length;
    const rest = body.slice(m[0].length);
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(rest))) rawAttrs[a[1]] = decodeEntities(a[2] !== undefined ? a[2] : a[3]);
    const nsMap = { ...top().nsMap };
    for (const [k, v] of Object.entries(rawAttrs)) { if (k === "xmlns") nsMap[""] = v; else if (k.startsWith("xmlns:")) nsMap[k.slice(6)] = v; }
    const [p, local] = qname.includes(":") ? qname.split(":", 2) : ["", qname];
    const node = { tag: local, ns: nsMap[p] || "", attrs: {}, children: [] };
    for (const [k, v] of Object.entries(rawAttrs)) {
      if (k === "xmlns" || k.startsWith("xmlns:")) continue;
      if (k.includes(":")) { const [ap, al] = k.split(":", 2); node.attrs[`{${nsMap[ap] || ap}}${al}`] = v; }
      else node.attrs[k] = v;
    }
    top().node.children.push(node);
    if (!selfClosing) stack.push({ node, nsMap });
  }
  return root;
}

/* depth-first iteration over element nodes */
export function* iterElements(node) {
  for (const c of node.children || []) { if (c.tag) { yield c; yield* iterElements(c); } }
}
export const childElements = (node, tag) => (node.children || []).filter((c) => c.tag && (!tag || c.tag === tag));
export const attr = (node, name, dflt = undefined) => (node.attrs[name] !== undefined ? node.attrs[name] : dflt);
