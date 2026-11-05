"""Shared layout for the Alassio Data Catalog PDF guides (A4, brand RAL 5015 #2271B3, Liberation Sans / DejaVu Sans Mono)."""
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak, PageTemplate, Paragraph,
                                Preformatted, Spacer, Table, TableStyle, CondPageBreak)
from reportlab.lib.fonts import addMapping

LIB = "/usr/share/fonts/truetype/liberation/"
pdfmetrics.registerFont(TTFont("Sans", LIB + "LiberationSans-Regular.ttf"))
pdfmetrics.registerFont(TTFont("Sans-Bold", LIB + "LiberationSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Sans-Italic", LIB + "LiberationSans-Italic.ttf"))
pdfmetrics.registerFont(TTFont("Sans-BoldItalic", LIB + "LiberationSans-BoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))
addMapping("Sans", 0, 0, "Sans"); addMapping("Sans", 1, 0, "Sans-Bold")
addMapping("Sans", 0, 1, "Sans-Italic"); addMapping("Sans", 1, 1, "Sans-BoldItalic")

BRAND, BRAND_DARK, BRAND_SOFT = colors.HexColor("#2271B3"), colors.HexColor("#1A5A8F"), colors.HexColor("#E4EEF7")
INK, MUTED, LINE = colors.HexColor("#1D1D1B"), colors.HexColor("#5E6266"), colors.HexColor("#D5D8DB")
CODE_BG, NOTE_BG, WARN_BG, WARN_LINE = colors.HexColor("#F4F6F8"), colors.HexColor("#EEF5FB"), colors.HexColor("#FFF6E5"), colors.HexColor("#E0A030")

S = {
    "title": ParagraphStyle("title", fontName="Sans-Bold", fontSize=26, leading=31, textColor=BRAND_DARK, spaceAfter=6),
    "subtitle": ParagraphStyle("subtitle", fontName="Sans", fontSize=13, leading=18, textColor=MUTED, spaceAfter=14),
    "h1": ParagraphStyle("h1", fontName="Sans-Bold", fontSize=15.5, leading=20, textColor=BRAND_DARK, spaceBefore=12, spaceAfter=6),
    "h2": ParagraphStyle("h2", fontName="Sans-Bold", fontSize=11.5, leading=15, textColor=INK, spaceBefore=8, spaceAfter=3),
    "body": ParagraphStyle("body", fontName="Sans", fontSize=9.6, leading=13.6, textColor=INK, spaceAfter=5, alignment=TA_LEFT),
    "small": ParagraphStyle("small", fontName="Sans", fontSize=8.3, leading=11.2, textColor=MUTED),
    "cell": ParagraphStyle("cell", fontName="Sans", fontSize=8.6, leading=11.4, textColor=INK),
    "cellb": ParagraphStyle("cellb", fontName="Sans-Bold", fontSize=8.6, leading=11.4, textColor=INK),
    "head": ParagraphStyle("head", fontName="Sans-Bold", fontSize=8.6, leading=11.4, textColor=colors.white),
    "bullet": ParagraphStyle("bullet", fontName="Sans", fontSize=9.6, leading=13.4, textColor=INK, leftIndent=12, bulletIndent=2, spaceAfter=2),
    "code": ParagraphStyle("code", fontName="Mono", fontSize=7.9, leading=10.6, textColor=INK),
    "note": ParagraphStyle("note", fontName="Sans", fontSize=9, leading=12.6, textColor=INK),
    "toc": ParagraphStyle("toc", fontName="Sans", fontSize=10, leading=15, textColor=INK, leftIndent=4),
}
WIDTH = A4[0] - 36 * mm


def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cf(text):
    return text.replace("<code>", '<font face="Mono" size="8.4" color="#1A5A8F">').replace("</code>", "</font>")


def P(text, style="body"):
    return Paragraph(cf(text), S[style])


def H1(text):
    return [CondPageBreak(60 * mm), P(text, "h1")]


def H2(text):
    return [CondPageBreak(30 * mm), P(text, "h2")]


def bullets(items):
    return [Paragraph(cf(i), S["bullet"], bulletText="•") for i in items]


def code(text):
    """Shell block: one command per line; overlong lines are continued with a trailing backslash (copy-safe),
    never inside single or double quotes."""
    lines = []
    for ln in text.strip("\n").split("\n"):
        while len(ln) > 96:
            cut = None
            for i in range(95, 40, -1):
                if ln[i] == " " and ln[:i].count("'") % 2 == 0 and ln[:i].count('"') % 2 == 0:
                    cut = i; break
            if cut is None:
                break
            lines.append(ln[:cut] + " \\")
            ln = "    " + ln[cut:].lstrip()
        lines.append(ln)
    pre = Preformatted("\n".join(lines), S["code"])
    t = Table([[pre]], colWidths=[WIDTH])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CODE_BG), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                           ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                           ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    return [t, Spacer(1, 5)]


def box(text, kind="note"):
    bg, line = (NOTE_BG, BRAND) if kind == "note" else (WARN_BG, WARN_LINE)
    label = "Note" if kind == "note" else "Caution"
    t = Table([[P(f"<b>{label}:</b> {text}", "note")]], colWidths=[WIDTH])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bg), ("LINEBEFORE", (0, 0), (0, -1), 2.5, line),
                           ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                           ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    return [t, Spacer(1, 6)]


def table(rows, widths, header=True):
    data = []
    for r_i, row in enumerate(rows):
        st = "head" if header and r_i == 0 else "cell"
        data.append([c if not isinstance(c, str) else Paragraph(cf(c), S[st]) for c in row])
    t = Table(data, colWidths=[w * WIDTH for w in widths], repeatRows=1 if header else 0)
    style = [("GRID", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
             ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
             ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), BRAND)]
        style += [("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F7F9FB")) for i in range(2, len(rows), 2)]
    t.setStyle(TableStyle(style))
    return [t, Spacer(1, 7)]


def build(path, title, subtitle, story, footer):
    def deco(c, doc):
        w, h = A4
        c.saveState()
        c.setFillColor(BRAND); c.rect(0, h - 6 * mm, w, 6 * mm, stroke=0, fill=1)
        c.setFillColor(MUTED); c.setFont("Sans", 7.5)
        c.drawString(18 * mm, 10 * mm, footer)
        c.drawRightString(w - 18 * mm, 10 * mm, f"Page {doc.page}")
        c.setStrokeColor(LINE); c.setLineWidth(0.4); c.line(18 * mm, 14 * mm, w - 18 * mm, 14 * mm)
        c.restoreState()
    doc = BaseDocTemplate(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=20 * mm,
                          title=title, subject=subtitle, creator="Alassio Data Catalog")
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=deco)])
    doc.build(story)


def cover(title, subtitle, intro, facts):
    out = [Spacer(1, 18 * mm), P('<font color="#2271B3">■</font> ALASSIO DATA CATALOG', "small"), Spacer(1, 4),
           P(title, "title"), P(subtitle, "subtitle")]
    out += [P(x) for x in intro]
    out.append(Spacer(1, 6))
    out += table(facts, [0.28, 0.72], header=False)
    return out
