"""Minimal BPMN swimlane renderer: builds an SVG diagram and a BPMN 2.0 XML file from lanes, elements and flows.
Usage: build(LANES, LHS, E, F, custom_fn, TITLE, POOL, PROC_ID, OUT_SVG, OUT_BPMN, LW)
  LANES : [(lane_id, label)]                 LHS : {lane_id: height}
  E     : [(id, kind, lane, x, label)]       kind ∈ start|end|task|service|gateway|note; lane "<lane>2" = second row inside <lane>
  F     : [(from, to, label)]                custom_fn(center, pos, ROW2) → {(from,to): lambda: [points]}
"""
import html

# v1.79: brand colours — sky blue RAL 5015 and its soft tint (title, pool band, service-task marker, system lane)
BRAND, BRAND_SOFT, SYS_LANE = "#2271B3", "#E4EEF7", "#F2F7FB"


def arrow_head(pts, color="#1D1D1B", size=8.0):
    """An explicit filled arrowhead at the end of a polyline (v1.79: PDF converters ignore SVG markers)."""
    import math
    (x0, y0), (x1, y1) = pts[-2], pts[-1]
    a = math.atan2(y1 - y0, x1 - x0)
    p1 = (x1 - size * math.cos(a) + size * 0.5 * math.sin(a), y1 - size * math.sin(a) - size * 0.5 * math.cos(a))
    p2 = (x1 - size * math.cos(a) - size * 0.5 * math.sin(a), y1 - size * math.sin(a) + size * 0.5 * math.cos(a))
    return f'<polygon points="{x1:.1f},{y1:.1f} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}" fill="{color}"/>'


def lane_label(cx, cy, label, height, color="#1D1D1B"):
    """A rotated lane title, wrapped onto two lines when it does not fit the lane height."""
    import textwrap
    lines = textwrap.wrap(label, width=max(12, int(height / 7.2))) or [""]
    return "".join(f'<text transform="translate({cx + (i - (len(lines) - 1) / 2) * 13:.1f},{cy}) rotate(-90)" text-anchor="middle" font-size="11" font-weight="bold" fill="{color}">{html.escape(ln)}</text>' for i, ln in enumerate(lines))

TW, TH, GS, ES = 140, 56, 36, 36
LX0, TOP = 140, 60


def build(LANES, LHS, E, F, custom_fn, TITLE, POOL, PROC_ID, OUT_SVG, OUT_BPMN, LW=2000, ROW2_OFFSET=180):
    lane_y = {}
    y = TOP
    for k, _ in LANES:
        lane_y[k] = y
        y += LHS[k]
    LH_TOTAL = y - TOP
    ROW2 = lane_y[LANES[0][0]] + ROW2_OFFSET
    row2_of = lambda lane: lane_y[lane[:-1]] + ROW2_OFFSET
    cy = lambda lane: lane_y[lane] + (75 if LHS[lane] > 160 else LHS[lane] / 2)
    pos = {}
    for eid, kind, lane, x, label in E:
        yy = row2_of(lane) if lane.endswith("2") and lane[:-1] in lane_y else cy(lane)
        if kind in ("task", "service"):
            pos[eid] = (x - TW / 2, yy - TH / 2, TW, TH)
        elif kind == "gateway":
            pos[eid] = (x - GS / 2, yy - GS / 2, GS, GS)
        elif kind == "note":
            pos[eid] = (x - 80, yy - 30, 160, 60)
        else:
            pos[eid] = (x - ES / 2, yy - ES / 2, ES, ES)

    def center(eid):
        x, y0, w, h = pos[eid]
        return (x + w / 2, y0 + h / 2)

    CUSTOM = custom_fn(center, pos, ROW2) if custom_fn else {}

    def edge_points(a, b):
        if (a, b) in CUSTOM:
            return CUSTOM[(a, b)]()
        ax, ay = center(a); bx, by = center(b); xa, ya, wa, ha = pos[a]; xb, yb, wb, hb = pos[b]
        if abs(bx - ax) <= 20:
            return [(ax, ya + ha), (bx, yb)] if by > ay else [(ax, ya), (bx, yb + hb)]
        if bx > ax + 20 and abs(by - ay) <= 20:
            return [(xa + wa, ay), (xb, by)]
        if bx > ax + 20 and by < ay:
            return [(xa + wa, ay), (xb - 28, ay), (xb - 28, by), (xb, by)]
        if bx > ax + 20:
            return [(xa + wa, ay), (bx, ay), (bx, yb)]
        if by > ay:
            return [(ax, ya + ha), (ax, by), (xb + wb, by)]
        return [(xa, ay), (bx, ay), (bx, yb + hb)]

    s = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" font-family="Helvetica, Arial, sans-serif" font-size="10.5">' % (LX0 + LW + 40, TOP + LH_TOTAL + 60, LX0 + LW + 40, TOP + LH_TOTAL + 60),
         '<rect width="100%" height="100%" fill="white"/>',
         '<defs><marker id="arr" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#1D1D1B"/></marker></defs>',
         f'<text x="{LX0}" y="38" font-size="20" font-weight="bold" fill="{BRAND}">{html.escape(TITLE)}</text>']
    # pool + lanes
    s.append(f'<rect x="{LX0 - 100}" y="{TOP}" width="{LW + 100}" height="{LH_TOTAL}" fill="none" stroke="#6B6F73" stroke-width="1.2"/>')
    s.append(f'<rect x="{LX0 - 100}" y="{TOP}" width="28" height="{LH_TOTAL}" fill="{BRAND}"/>')
    s.append(f'<text transform="translate({LX0 - 80},{TOP + LH_TOTAL / 2}) rotate(-90)" text-anchor="middle" font-size="13" font-weight="bold" fill="white">{html.escape(POOL)}</text>')
    for k, label in LANES:
        y0 = lane_y[k]
        fill = SYS_LANE if k == "sys" else "white"
        s.append(f'<rect x="{LX0 - 72}" y="{y0}" width="{LW + 72}" height="{LHS[k]}" fill="{fill}" stroke="#B9BDBF" stroke-width="0.8"/>')
        s.append(f'<rect x="{LX0 - 72}" y="{y0}" width="52" height="{LHS[k]}" fill="#F4F4F2" stroke="#B9BDBF" stroke-width="0.8"/>')
        s.append(lane_label(LX0 - 46, y0 + LHS[k] / 2, label, LHS[k]))
    # flows
    for f in F:
        a, b, label = f[0], f[1], f[2]
        pts = edge_points(a, b)
        d = " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{y:.1f}" for i, (x, y) in enumerate(pts))
        s.append(f'<path d="{d}" fill="none" stroke="#1D1D1B" stroke-width="1.4"/>' + arrow_head(pts))
        if label:
            (x0, y0), (x1, y1) = pts[0], pts[1]
            if abs(y1 - y0) < 1:
                s.append(f'<text x="{(x0 + x1) / 2:.1f}" y="{y0 - 6:.1f}" text-anchor="middle" font-size="9" fill="#6B6F73">{html.escape(label)}</text>')
            else:
                s.append(f'<text x="{x0 + 8:.1f}" y="{(y0 + y1) / 2:.1f}" font-size="9" fill="#6B6F73">{html.escape(label)}</text>')
    # elements
    for eid, kind, lane, x, label in E:
        X, Y, W, H = pos[eid]
        cx, cyy = X + W / 2, Y + H / 2
        lines = label.split("\n")
        if kind in ("task", "service"):
            fill = BRAND_SOFT if kind == "service" else "white"
            s.append(f'<rect x="{X}" y="{Y}" width="{W}" height="{H}" rx="9" fill="{fill}" stroke="#1D1D1B" stroke-width="1.4"/>')
            if kind == "service":
                s.append(f'<circle cx="{X + 9}" cy="{Y + 9}" r="4" fill="none" stroke="{BRAND}" stroke-width="1.3"/><circle cx="{X + 9}" cy="{Y + 9}" r="1.3" fill="{BRAND}"/>')
            for i, ln in enumerate(lines):
                s.append(f'<text x="{cx}" y="{cyy + (i - (len(lines) - 1) / 2) * 11.5 + 3.5:.1f}" text-anchor="middle" font-size="9.5" fill="#1D1D1B">{html.escape(ln)}</text>')
        elif kind == "gateway":
            s.append(f'<polygon points="{cx},{Y} {X + W},{cyy} {cx},{Y + H} {X},{cyy}" fill="#FBEFD9" stroke="#1D1D1B" stroke-width="1.4"/>')
            s.append(f'<text x="{cx}" y="{cyy + 4}" text-anchor="middle" font-size="12" font-weight="bold">×</text>')
            for li, line in enumerate(lines):
                s.append(f'<text x="{X - 6}" y="{Y + 4 + li * 11}" text-anchor="end" font-size="9.5" font-weight="bold" fill="#6B6F73">{html.escape(line)}</text>')
        elif kind == "note":
            s.append(f'<path d="M{X + 12},{Y} L{X},{Y} L{X},{Y + H} L{X + 12},{Y + H}" fill="none" stroke="#6B6F73" stroke-width="1"/>')
            for i, ln in enumerate(lines):
                s.append(f'<text x="{X + 8}" y="{Y + 14 + i * 11.5:.1f}" font-size="9" fill="#6B6F73">{html.escape(ln)}</text>')
        else:
            sw = 3 if kind == "end" else 1.4
            s.append(f'<circle cx="{cx}" cy="{cyy}" r="{ES / 2}" fill="{"#E2F2E9" if kind == "end" else "white"}" stroke="#1D1D1B" stroke-width="{sw}"/>')
            for i, ln in enumerate(lines):
                s.append(f'<text x="{cx}" y="{Y + H + 12 + i * 11:.1f}" text-anchor="middle" font-size="9" fill="#1D1D1B">{html.escape(ln)}</text>')
    s.append(f'<text x="{LX0}" y="{TOP + LH_TOTAL + 40}" font-size="9.5" fill="#6B6F73">Legend: rounded box = user task · box with gear = automated service task · × diamond = exclusive gateway · thin circle = start · thick circle = end</text>')
    s.append('</svg>')
    open(OUT_SVG, "w").write("\n".join(s))

    # ── BPMN 2.0 XML ──
    LANE_OF = lambda lane: lane[:-1] if lane.endswith("2") and lane[:-1] in lane_y else lane
    tag = {"start": "startEvent", "end": "endEvent", "task": "userTask", "service": "serviceTask", "gateway": "exclusiveGateway", "note": "textAnnotation"}
    x = ['<?xml version="1.0" encoding="UTF-8"?>',
         f'<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_{PROC_ID}" targetNamespace="https://alassio.example/bpmn">',
         f'<bpmn:collaboration id="Collab"><bpmn:participant id="Pool" name="{html.escape(POOL)}" processRef="Proc"/></bpmn:collaboration>',
         '<bpmn:process id="Proc" isExecutable="false">', '<bpmn:laneSet id="Lanes">']
    for k, label in LANES:
        x.append(f'<bpmn:lane id="Lane_{k}" name="{html.escape(label)}">')
        for eid, kind, lane, _, _ in E:
            if LANE_OF(lane) == k and kind != "note":
                x.append(f'<bpmn:flowNodeRef>{eid}</bpmn:flowNodeRef>')
        x.append('</bpmn:lane>')
    x.append('</bpmn:laneSet>')
    for eid, kind, lane, _, label in E:
        if kind == "note":
            x.append(f'<bpmn:textAnnotation id="{eid}"><bpmn:text>{html.escape(label.replace(chr(10), " "))}</bpmn:text></bpmn:textAnnotation>')
            continue
        x.append(f'<bpmn:{tag[kind]} id="{eid}" name="{html.escape(label.replace(chr(10), " "))}">')
        for i, f in enumerate(F):
            if f[1] == eid: x.append(f'<bpmn:incoming>Flow_{i}</bpmn:incoming>')
        for i, f in enumerate(F):
            if f[0] == eid: x.append(f'<bpmn:outgoing>Flow_{i}</bpmn:outgoing>')
        x.append(f'</bpmn:{tag[kind]}>')
    for i, f in enumerate(F):
        x.append(f'<bpmn:sequenceFlow id="Flow_{i}" name="{html.escape(f[2])}" sourceRef="{f[0]}" targetRef="{f[1]}"/>')
    x.append('</bpmn:process>')
    x.append('<bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">')
    x.append(f'<bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true"><dc:Bounds x="{LX0 - 100}" y="{TOP}" width="{LW + 100}" height="{LH_TOTAL}"/></bpmndi:BPMNShape>')
    for k, _ in LANES:
        x.append(f'<bpmndi:BPMNShape id="Lane_{k}_di" bpmnElement="Lane_{k}" isHorizontal="true"><dc:Bounds x="{LX0 - 72}" y="{lane_y[k]}" width="{LW + 72}" height="{LHS[k]}"/></bpmndi:BPMNShape>')
    for eid, kind, lane, _, _ in E:
        X, Y, W, H = pos[eid]
        x.append(f'<bpmndi:BPMNShape id="{eid}_di" bpmnElement="{eid}"><dc:Bounds x="{X:.0f}" y="{Y:.0f}" width="{W:.0f}" height="{H:.0f}"/></bpmndi:BPMNShape>')
    for i, f in enumerate(F):
        pts = edge_points(f[0], f[1])
        x.append(f'<bpmndi:BPMNEdge id="Flow_{i}_di" bpmnElement="Flow_{i}">' + "".join(f'<di:waypoint x="{px:.0f}" y="{py:.0f}"/>' for px, py in pts) + '</bpmndi:BPMNEdge>')
    x.append('</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>')
    open(OUT_BPMN, "w").write("\n".join(x))
