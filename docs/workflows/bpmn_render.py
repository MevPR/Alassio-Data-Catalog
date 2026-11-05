"""Renders a BPMN 2.0 file (with BPMN-DI coordinates) to SVG in the catalog's house style (v1.79).
Used for the access-request and steward-task BPMN files, whose source of truth is the .bpmn file itself; the data
product design BPMN is generated from code by make_design_bpmn.py (bpmnlib.build) in the same style.
    render(bpmn_path, svg_path, title, brand="#2271B3")"""
import html
import textwrap
import xml.etree.ElementTree as ET

from bpmnlib import arrow_head, lane_label

NS = {"bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL", "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
      "dc": "http://www.omg.org/spec/DD/20100524/DC", "di": "http://www.omg.org/spec/DD/20100524/DI"}
INK, MUTED, LANE_LINE = "#1D1D1B", "#6B6F73", "#B9BDBF"
KIND = {"startEvent": "start", "endEvent": "end", "userTask": "task", "task": "task", "manualTask": "task",
        "serviceTask": "service", "exclusiveGateway": "gateway", "textAnnotation": "note"}


def _lines(text, width):
    return textwrap.wrap(" ".join(str(text or "").split()), width=width) or [""]


def render(bpmn_path, svg_path, title, brand="#2271B3", brand_soft="#E4EEF7"):
    root = ET.parse(bpmn_path).getroot()
    proc = root.find(".//bpmn:process", NS)
    pool = root.find(".//bpmn:participant", NS)
    nodes, flows, lanes = {}, [], []
    for el in proc:
        tag = el.tag.split("}")[1]
        if tag in KIND:
            text = el.get("name") if tag != "textAnnotation" else (el.findtext("bpmn:text", default="", namespaces=NS))
            nodes[el.get("id")] = (KIND[tag], text)
        elif tag == "sequenceFlow":
            flows.append((el.get("id"), el.get("name") or ""))
    for ln in proc.iter(f"{{{NS['bpmn']}}}lane"):
        lanes.append((ln.get("id"), ln.get("name")))
    bounds, ways = {}, {}
    for sh in root.iter(f"{{{NS['bpmndi']}}}BPMNShape"):
        b = sh.find("dc:Bounds", NS)
        bounds[sh.get("bpmnElement")] = tuple(float(b.get(k)) for k in ("x", "y", "width", "height"))
    for ed in root.iter(f"{{{NS['bpmndi']}}}BPMNEdge"):
        ways[ed.get("bpmnElement")] = [(float(w.get("x")), float(w.get("y"))) for w in ed.findall("di:waypoint", NS)]
    px, py, pw, ph = bounds[pool.get("id")]
    W, H = px + pw + 40, py + ph + 50
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" viewBox="0 0 {W:.0f} {H:.0f}" font-family="Helvetica, Arial, sans-serif" font-size="10.5">',
         '<rect width="100%" height="100%" fill="white"/>',
         f'<defs><marker id="arr" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker></defs>',
         f'<text x="{px + 100:.0f}" y="38" font-size="20" font-weight="bold" fill="{brand}">{html.escape(title)}</text>',
         f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" fill="none" stroke="{MUTED}" stroke-width="1.2"/>',
         f'<rect x="{px}" y="{py}" width="28" height="{ph}" fill="{brand}"/>',
         f'<text transform="translate({px + 19},{py + ph / 2}) rotate(-90)" text-anchor="middle" font-size="13" font-weight="bold" fill="white">{html.escape(pool.get("name") or "")}</text>']
    for lid, label in lanes:
        x, y, w, h = bounds[lid]
        fill = "#F2F7FB" if "(system)" in (label or "") else "white"
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{LANE_LINE}" stroke-width="0.8"/>')
        s.append(f'<rect x="{x}" y="{y}" width="52" height="{h}" fill="#F4F4F2" stroke="{LANE_LINE}" stroke-width="0.8"/>')
        s.append(lane_label(x + 26, y + h / 2, label or "", h))
    for fid, label in flows:
        pts = ways.get(fid)
        if not pts:
            continue
        d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        s.append(f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="1.4"/>' + arrow_head(pts, INK))
        if label:
            (x0, y0), (x1, y1) = pts[0], pts[1]
            if abs(y1 - y0) < 2:
                s.append(f'<text x="{(x0 + x1) / 2:.1f}" y="{y0 - 6:.1f}" text-anchor="middle" font-size="9" fill="{MUTED}">{html.escape(label)}</text>')
            else:
                s.append(f'<text x="{x0 + 8:.1f}" y="{(y0 + y1) / 2:.1f}" font-size="9" fill="{MUTED}">{html.escape(label)}</text>')
    for nid, (kind, text) in nodes.items():
        if nid not in bounds:
            continue
        X, Y, Wd, Hd = bounds[nid]
        cx, cy = X + Wd / 2, Y + Hd / 2
        if kind in ("task", "service"):
            fill = brand_soft if kind == "service" else "white"
            s.append(f'<rect x="{X}" y="{Y}" width="{Wd}" height="{Hd}" rx="9" fill="{fill}" stroke="{INK}" stroke-width="1.4"/>')
            if kind == "service":
                s.append(f'<circle cx="{X + 9}" cy="{Y + 9}" r="4" fill="none" stroke="{brand}" stroke-width="1.3"/><circle cx="{X + 9}" cy="{Y + 9}" r="1.3" fill="{brand}"/>')
            lines = _lines(text, 24)
            for i, ln in enumerate(lines):
                s.append(f'<text x="{cx}" y="{cy + (i - (len(lines) - 1) / 2) * 11.5 + 3.5:.1f}" text-anchor="middle" font-size="9.5" fill="{INK}">{html.escape(ln)}</text>')
        elif kind == "gateway":
            s.append(f'<polygon points="{cx},{Y} {X + Wd},{cy} {cx},{Y + Hd} {X},{cy}" fill="#FBEFD9" stroke="{INK}" stroke-width="1.4"/>')
            for li, ln in enumerate(_lines(text, 14)):
                s.append(f'<text x="{X - 6}" y="{Y + 4 + li * 11}" text-anchor="end" font-size="9.5" font-weight="bold" fill="{MUTED}">{html.escape(ln)}</text>')
        elif kind == "note":
            s.append(f'<path d="M{X + 12},{Y} L{X},{Y} L{X},{Y + Hd} L{X + 12},{Y + Hd}" fill="none" stroke="{MUTED}" stroke-width="1"/>')
            for i, ln in enumerate(_lines(text, 30)):
                s.append(f'<text x="{X + 8}" y="{Y + 14 + i * 11.5:.1f}" font-size="9" fill="{MUTED}">{html.escape(ln)}</text>')
        else:
            sw = 3 if kind == "end" else 1.6
            s.append(f'<circle cx="{cx}" cy="{cy}" r="{Wd / 2}" fill="{"#E2F2E9" if kind == "end" else "white"}" stroke="{INK}" stroke-width="{sw}"/>')
            for i, ln in enumerate(_lines(text, 22)):
                s.append(f'<text x="{cx}" y="{Y + Hd + 12 + i * 11:.1f}" text-anchor="middle" font-size="9" fill="{INK}">{html.escape(ln)}</text>')
    s.append("</svg>")
    open(svg_path, "w", encoding="utf-8").write("\n".join(s))
