from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle
from PIL import Image as PIL
import os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "Alassio_Data_Catalog_Workflows.pdf")
VERSION = sys.argv[2] if len(sys.argv) > 2 else "current"
for name in ("design", "access", "steward"):
    subprocess.run(["dot", "-Tpng", "-Gdpi=170", os.path.join(HERE, f"{name}.dot"), "-o", os.path.join(HERE, f"{name}.png")], check=True)

RED = colors.HexColor("#2271B3"); BLUE = colors.HexColor("#1A5A8F");   # brand: sky blue RAL 5015 (v1.79) and its dark shade
INK = colors.HexColor("#1D1D1B"); MUTED = colors.HexColor("#6B6F73"); GREY = colors.HexColor("#F3F3F1"); LINE = colors.HexColor("#D9D9D6")
H = ParagraphStyle("H", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=BLUE, spaceAfter=4)
H2 = ParagraphStyle("H2", fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=RED, spaceBefore=8, spaceAfter=4)
B = ParagraphStyle("B", fontName="Helvetica", fontSize=9.2, leading=12.5, textColor=INK, spaceAfter=4)
S = ParagraphStyle("S", fontName="Helvetica", fontSize=8, leading=10.5, textColor=MUTED)

def img(path, maxw, maxh):
    w, h = PIL.open(path).size; r = min(maxw / w, maxh / h)
    return Image(path, width=w * r, height=h * r)

def deco(c, d):
    w, h = A4; c.saveState(); c.setFillColor(RED); c.rect(0, h - 5*mm, w, 5*mm, stroke=0, fill=1)
    c.setFillColor(MUTED); c.setFont("Helvetica", 7.5)
    c.drawString(16*mm, 9*mm, f"COMPANY Group · Alassio Data Catalog v{VERSION} · Workflows"); c.drawRightString(w - 16*mm, 9*mm, f"Page {d.page}")
    c.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=A4, leftMargin=16*mm, rightMargin=16*mm, topMargin=13*mm, bottomMargin=14*mm, title="Alassio Data Catalog – Workflows")
W = A4[0] - 32*mm
story = [Paragraph("Alassio Data Catalog — Workflows", H), Paragraph("The three workflows of the catalog, the roles involved and the notifications sent at each step.", S), Spacer(1, 4*mm),
  Paragraph("1 · Designing a data product (three phases)", H2),
  Paragraph("Started in the Marketplace by a Project Manager or Admin (name, description, data hub type, project, use case, proposed table tag, SOURCE tables, optional Advanced fields such as retention). Phase 1: the Business Analyst refines the design and documents the sourcing, the BPO approves the data use with a confirming document, Data Ingestion confirms the ingested tables. Phase 2: the Business Analyst refines the data product. Phase 3: Data Product Development runs development, UAT, SIT and the release to PRD; the submitter signs off. Every step can carry notes and files; each transition is validated by role and state on the server, and every step sends an inbox message (plus e-mail if SMTP is configured) to the submitter and to the role that is up next.", B),
  img(os.path.join(HERE, "design.png"), W, 186*mm), PageBreak()]
CELL = ParagraphStyle("CELL", fontName="Helvetica", fontSize=8, leading=10, textColor=INK)
CELLH = ParagraphStyle("CELLH", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)
LEGEND_ROWS = [["Who acts", "Where", "Notified"],
  ["Submitter (PM) / Admin", "forward to the next role, edit, withdraw, sign off", "next role · Admins"],
  ["Business Analyst / Req. Engineer", "refine the design, document the sourcing, refine the data product — or return", "submitter"],
  ["BPO (business process owner)", "approve the data use (confirming document) or decline", "submitter · BA"],
  ["Data Ingestion", "confirm the ingested tables (with location) or return", "submitter"],
  ["Data Product Development", "development, UAT, SIT, release to PRD — or return", "submitter"],
  ["Admin", "every step; delete any request (double confirmation)", "—"]]
legend = Table([[Paragraph(c, CELLH if i == 0 else CELL) for c in r] for i, r in enumerate(LEGEND_ROWS)], colWidths=[52*mm, 88*mm, 38*mm])
legend.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), BLUE), ("TEXTCOLOR", (0,0), (-1,0), colors.white), ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("FONTSIZE", (0,0), (-1,-1), 8), ("GRID", (0,0), (-1,-1), 0.4, LINE), ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, GREY]), ("VALIGN", (0,0), (-1,-1), "TOP"), ("TOPPADDING", (0,0), (-1,-1), 3), ("BOTTOMPADDING", (0,0), (-1,-1), 3)]))
story += [Paragraph("Who acts in the design workflow", H2), legend, Spacer(1, 4*mm),
  Paragraph("2 · Requesting access to a data product", H2),
  Paragraph("Any role picks a data product in the Marketplace (or via Request access on the product page) and states the purpose. Admins and the data owner of the product see the request in My Dashboard; Admins decide. The requester is notified of the decision.", B),
  img(os.path.join(HERE, "access.png"), W, 70*mm), Spacer(1, 6*mm),
  Paragraph("3 · Asking a data steward to describe attributes", H2),
  Paragraph("On a table with an effective data steward, Project Managers and Admins can request the business documentation of its attributes. The steward receives an inbox message with a link to the table; the task appears under Waiting for my action in the steward's dashboard until read.", B),
  img(os.path.join(HERE, "steward.png"), W, 70*mm), Spacer(1, 6*mm),
  Paragraph("Roles and precedence", H2),
  Paragraph("Accounts may hold several roles; permissions follow the highest one (Admin › Data Steward › Project Manager › Business Analyst / Data Ingestion / Development › Guest), while workflow steps and notifications address every role a person holds. Ownership, stewardship and the data domain inherit downwards (hub → domain → database → schema → table) and can be overridden per level; the effective owner approves access requests and sets stewards, effective stewards edit tables and attributes.", B)]
doc.build(story, onFirstPage=deco, onLaterPages=deco); print("pdf ok")
