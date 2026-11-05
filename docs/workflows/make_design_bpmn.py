"""Data product design workflow as BPMN (v1.45): python3 docs/workflows/make_design_bpmn.py <out_dir> [version]"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from bpmnlib import build

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
VERSION = sys.argv[2] if len(sys.argv) > 2 else "current"
LANES = [("pm", "Project Manager (submitter)"), ("ba", "Business Analyst / Req. Engineer"), ("owner", "BPO (business process owner)"), ("di", "Data Ingestion"), ("dpd", "Data Product Development"), ("sys", "Alassio Data Catalog (system)")]
LHS = {"pm": 240, "ba": 150, "owner": 150, "di": 150, "dpd": 150, "sys": 170}
E = [
    ("start", "start", "pm", 200, "Need for a\ndata product"),
    ("design", "task", "pm", 330, "Design data product\n(name, hub type, project,\nuse case, SOURCE tables)"),
    ("tagsrc", "service", "sys", 330, "Tag selected SOURCE tables\n(Data Product, Project, Use\nCase) — kept in sync"),
    ("refine1", "task", "ba", 500, "Refine the design\n(may edit the entries)\n→ notes + optional files"),
    ("gw1", "gateway", "ba", 640, "Okay?"),
    ("doc", "task", "ba", 780, "Document the sourcing\n(source system, BPO, LeanIX,\nsteward) → request approval"),
    ("reviewo", "task", "owner", 920, "Review intended\ndata use"),
    ("gwo", "gateway", "owner", 1060, "Approve?"),
    ("attach", "task", "owner", 1200, "Approve data use and\nattach the confirming\ndocument (e-mail / link)"),
    ("confirm", "task", "di", 1340, "Confirm ingested\ntables (with location)"),
    ("gw2", "gateway", "di", 1480, "Confirmed?"),
    ("refine", "task", "ba", 1620, "Refine the data product\n→ notes + optional files"),
    ("gwr", "gateway", "ba", 1760, "Completed?"),
    ("dev", "task", "dpd", 1900, "Development\n(→ notes)"),
    ("uat", "task", "dpd", 2050, "UAT\n(→ notes)"),
    ("sit", "task", "dpd", 2200, "SIT\n(→ notes)"),
    ("gw3", "gateway", "dpd", 2340, "Tests OK?"),
    ("release", "task", "dpd", 2480, "Release to PRD\n(→ notes)"),
    ("signoff", "task", "pm", 2630, "Sign-off"),
    ("tags", "service", "sys", 2630, "Tag the data product\n(Data Product, Project,\nUse Case)"),
    ("end", "end", "sys", 2780, "Data product\ndelivered"),
    ("rework", "task", "pm2", 700, "Rework design\n(reason from reviewer)"),
    ("gwc", "gateway", "pm2", 560, "Continue?"),
    ("withdrawn", "end", "pm2", 420, "Withdrawn\n(with reason)"),
    ("notify", "note", "sys", 1100, "Every step notifies the\nsubmitter and the next actor\n(inbox + e-mail copy); hand-offs\nbetween roles are automatic"),
]
F = [
    ("start", "design", ""), ("design", "tagsrc", ""), ("tagsrc", "refine1", "automatic"), ("refine1", "gw1", ""),
    ("gw1", "doc", "yes"), ("gw1", "rework", "no · return"), ("doc", "reviewo", "automatic"), ("reviewo", "gwo", ""),
    ("gwo", "attach", "yes"), ("gwo", "refine1", "no · decline → back to BA"), ("attach", "confirm", "automatic"), ("confirm", "gw2", ""),
    ("gw2", "refine", "yes · automatic"), ("gw2", "rework", "no · return"), ("refine", "gwr", ""), ("gwr", "dev", "yes · automatic"), ("gwr", "rework", "no · return"),
    ("dev", "uat", ""), ("uat", "sit", ""), ("sit", "gw3", ""), ("gw3", "release", "yes"), ("gw3", "rework", "no · return"),
    ("release", "signoff", ""), ("signoff", "tags", ""), ("tags", "end", ""), ("rework", "gwc", ""), ("gwc", "refine1", "yes · forward again to the returning step"), ("gwc", "withdrawn", "no · withdraw"),
]
def custom(center, pos, ROW2):
    return {
        ("gw1", "rework"): lambda: [(center("gw1")[0], pos["gw1"][1]), (center("gw1")[0], pos["rework"][1] + pos["rework"][3])],
        ("gwo", "refine1"): lambda: [(center("gwo")[0], pos["gwo"][1] + pos["gwo"][3]), (center("gwo")[0], pos["gwo"][1] + pos["gwo"][3] + 30), (pos["refine1"][0] - 30, pos["gwo"][1] + pos["gwo"][3] + 30), (pos["refine1"][0] - 30, center("refine1")[1] + 18), (pos["refine1"][0], center("refine1")[1] + 18)],
        ("gw2", "rework"): lambda: [(center("gw2")[0], pos["gw2"][1]), (center("gw2")[0], ROW2), (pos["rework"][0] + pos["rework"][2], ROW2)],
        ("gwr", "rework"): lambda: [(center("gwr")[0], pos["gwr"][1]), (center("gwr")[0], ROW2), (pos["rework"][0] + pos["rework"][2], ROW2)],
        ("gw3", "rework"): lambda: [(center("gw3")[0], pos["gw3"][1]), (center("gw3")[0], ROW2), (pos["rework"][0] + pos["rework"][2], ROW2)],
        ("gwc", "refine1"): lambda: [(center("gwc")[0], pos["gwc"][1] + pos["gwc"][3]), (center("gwc")[0], pos["refine1"][1] - 14), (center("refine1")[0] - 20, pos["refine1"][1] - 14), (center("refine1")[0] - 20, pos["refine1"][1])],
        ("tagsrc", "refine1"): lambda: [(pos["tagsrc"][0] + pos["tagsrc"][2], center("tagsrc")[1]), (center("refine1")[0] + 20, center("tagsrc")[1]), (center("refine1")[0] + 20, pos["refine1"][1] + pos["refine1"][3])],
        ("attach", "confirm"): lambda: [(pos["attach"][0] + pos["attach"][2], center("attach")[1]), (center("confirm")[0], center("attach")[1]), (center("confirm")[0], pos["confirm"][1])],
        ("gw2", "refine"): lambda: [(pos["gw2"][0] + pos["gw2"][2], center("gw2")[1]), (center("refine")[0] - 20, center("gw2")[1]), (center("refine")[0] - 20, pos["refine"][1] + pos["refine"][3])],
        ("gwr", "dev"): lambda: [(pos["gwr"][0] + pos["gwr"][2], center("gwr")[1]), (center("dev")[0], center("gwr")[1]), (center("dev")[0], pos["dev"][1])],
    }
build(LANES, LHS, E, F, custom, f"Data product design — BPMN view (Alassio Data Catalog v{VERSION})", "Data product design", "design",
      os.path.join(OUT, "bpmn_design.svg"), os.path.join(OUT, "Alassio_Data_Product_Design.bpmn"), LW=2720)
print("ok")
