"""
Build-journal PDF generator — chronological record of the 10-day ParkProof
build, with decision-tree branches at every notable pivot.

Output: docs/parkproof-build-journal.pdf
Run:    python scripts/_pdf_build_journal.py
"""
from __future__ import annotations
import os
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    PageBreak,
    Table,
    TableStyle,
    KeepTogether,
    HRFlowable,
    Preformatted,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Register Arial — covers Latin extended, Vietnamese diacritics, Greek (the
# scripts referenced in the i18n discussion). ReportLab's built-in Helvetica
# doesn't have Greek-extended or Vietnamese tone marks. We don't try to load
# CJK/Devanagari/Gurmukhi fonts here — those few literals are romanized inline.
_FONT_BODY = "Helvetica"
_FONT_BODY_BOLD = "Helvetica-Bold"
_FONT_BODY_ITALIC = "Helvetica-Oblique"
try:
    pdfmetrics.registerFont(TTFont("Arial", "C:/Windows/Fonts/arial.ttf"))
    pdfmetrics.registerFont(TTFont("Arial-Bold", "C:/Windows/Fonts/arialbd.ttf"))
    pdfmetrics.registerFont(TTFont("Arial-Italic", "C:/Windows/Fonts/ariali.ttf"))
    from reportlab.pdfbase.pdfmetrics import registerFontFamily
    registerFontFamily(
        "Arial",
        normal="Arial",
        bold="Arial-Bold",
        italic="Arial-Italic",
        boldItalic="Arial-Bold",
    )
    _FONT_BODY = "Arial"
    _FONT_BODY_BOLD = "Arial-Bold"
    _FONT_BODY_ITALIC = "Arial-Italic"
except Exception as e:
    # Fall back to built-in Helvetica silently — script still works, just with
    # squares where the extended-Latin / Greek characters would otherwise be.
    print(f"  (Arial font load failed — falling back to Helvetica: {e})")

# --- Brand palette ----------------------------------------------------------
BRAND = HexColor("#275BFF")
INK = HexColor("#1A2233")
INK_MID = HexColor("#4A5568")
INK_LIGHT = HexColor("#6B7280")
PAPER = HexColor("#F2F4F7")
PAPER_DARK = HexColor("#E5E7EB")
ACCENT = HexColor("#20C4C7")
WHITE = HexColor("#FFFFFF")
GREEN = HexColor("#059669")
AMBER = HexColor("#D97706")
RED = HexColor("#DC2626")

# --- Output path ------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "docs" / "parkproof-build-journal.pdf"


# --- Custom canvas with footer + page numbers -------------------------------
def _on_page(canvas, doc):
    canvas.saveState()
    width, height = A4
    # Footer line
    canvas.setStrokeColor(PAPER_DARK)
    canvas.setLineWidth(0.5)
    canvas.line(20 * mm, 18 * mm, width - 20 * mm, 18 * mm)
    # Footer text
    canvas.setFont(_FONT_BODY, 8)
    canvas.setFillColor(INK_LIGHT)
    canvas.drawString(
        20 * mm, 12 * mm, "ParkProof — Build Journal · 16-25 May 2026"
    )
    canvas.drawRightString(width - 20 * mm, 12 * mm, f"{doc.page}")
    canvas.restoreState()


# --- Styles -----------------------------------------------------------------
base = getSampleStyleSheet()

style_title = ParagraphStyle(
    "Title",
    parent=base["Heading1"],
    fontName=_FONT_BODY_BOLD,
    fontSize=32,
    leading=38,
    textColor=INK,
    spaceAfter=4,
    alignment=TA_LEFT,
)
style_subtitle = ParagraphStyle(
    "Subtitle",
    parent=base["Normal"],
    fontName=_FONT_BODY,
    fontSize=14,
    leading=20,
    textColor=BRAND,
    spaceAfter=10,
    alignment=TA_LEFT,
)
style_kicker = ParagraphStyle(
    "Kicker",
    parent=base["Normal"],
    fontName=_FONT_BODY_BOLD,
    fontSize=9,
    leading=12,
    textColor=BRAND,
    spaceAfter=2,
    alignment=TA_LEFT,
)
style_h2 = ParagraphStyle(
    "H2",
    parent=base["Heading2"],
    fontName=_FONT_BODY_BOLD,
    fontSize=20,
    leading=26,
    textColor=INK,
    spaceBefore=2,
    spaceAfter=4,
    alignment=TA_LEFT,
)
style_h3 = ParagraphStyle(
    "H3",
    parent=base["Heading3"],
    fontName=_FONT_BODY_BOLD,
    fontSize=13,
    leading=16,
    textColor=INK,
    spaceBefore=10,
    spaceAfter=4,
    alignment=TA_LEFT,
)
style_body = ParagraphStyle(
    "Body",
    parent=base["Normal"],
    fontName=_FONT_BODY,
    fontSize=10.5,
    leading=15.5,
    textColor=INK,
    spaceAfter=8,
    alignment=TA_JUSTIFY,
)
style_body_left = ParagraphStyle(
    "BodyLeft",
    parent=style_body,
    alignment=TA_LEFT,
)
style_caption = ParagraphStyle(
    "Caption",
    parent=base["Normal"],
    fontName=_FONT_BODY_ITALIC,
    fontSize=9,
    leading=12,
    textColor=INK_MID,
    spaceAfter=10,
)
style_mono = ParagraphStyle(
    # Don't inherit from base["Code"] — that style sets wordWrap='CJK' which
    # breaks word-boundary detection for our hashes, splitting "98bd332" into
    # "98b / d33 / 2". Inherit from Normal and explicitly opt out of any wrap
    # mode so short monospaced strings render as a single token.
    "Mono",
    parent=base["Normal"],
    fontName="Courier",
    fontSize=8.5,
    leading=11,
    textColor=INK_MID,
    wordWrap=None,
)
style_tree = ParagraphStyle(
    "DecisionTree",
    parent=base["Code"],
    fontName="Courier",
    fontSize=8.5,
    leading=11.5,
    textColor=INK,
    leftIndent=0,
)


# --- Helpers ----------------------------------------------------------------
def rule(thickness=1, colour=None):
    return HRFlowable(
        width="100%",
        thickness=thickness,
        color=colour or PAPER_DARK,
        spaceBefore=4,
        spaceAfter=8,
    )


def coloured_band(text, fg=WHITE, bg=BRAND, height=10):
    """A coloured strip with white text — used as day headers."""
    t = Table(
        [[Paragraph(f'<font color="{fg.hexval()}"><b>{text}</b></font>', style_h3)]],
        colWidths=[170 * mm],
    )
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("ROUNDEDCORNERS", [4, 4, 4, 4]),
            ]
        )
    )
    return t


def stat_chip(label, value, colour=BRAND):
    """A small coloured chip showing a single statistic."""
    inner = Table(
        [[
            Paragraph(
                f'<font color="white" size=14><b>{value}</b></font><br/>'
                f'<font color="white" size=7>{label.upper()}</font>',
                ParagraphStyle("chip", fontName=_FONT_BODY, alignment=TA_CENTER, leading=14),
            )
        ]],
        colWidths=[40 * mm],
    )
    inner.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colour),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return inner


def stats_row(chips):
    """Horizontal row of stat chips."""
    cols = [40 * mm] * len(chips)
    t = Table([chips], colWidths=cols, hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return t


def commit_table(rows):
    """Two-column table: hash | message. Used inside each day section."""
    body = [
        [
            Paragraph(f'<font name="Courier" size=8>{h}</font>', style_mono),
            Paragraph(msg, style_body_left),
        ]
        for h, msg in rows
    ]
    t = Table(body, colWidths=[22 * mm, 148 * mm], hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("BACKGROUND", (0, 0), (0, -1), PAPER),
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, PAPER_DARK),
            ]
        )
    )
    return t


def decision_block(title, lines):
    """A decision-tree block: title bar + ASCII tree below."""
    title_row = Table(
        [[Paragraph(f'<b>DECISION · {title}</b>', style_kicker)]],
        colWidths=[170 * mm],
    )
    title_row.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PAPER),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LINEABOVE", (0, 0), (-1, 0), 2, BRAND),
            ]
        )
    )
    pre = Preformatted("\n".join(lines), style_tree)
    body = Table([[pre]], colWidths=[170 * mm])
    body.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), HexColor("#FBFBFD")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LINEBELOW", (0, 0), (-1, -1), 0.25, PAPER_DARK),
                ("LINELEFT", (0, 0), (0, -1), 0.25, PAPER_DARK),
                ("LINERIGHT", (-1, 0), (-1, -1), 0.25, PAPER_DARK),
            ]
        )
    )
    return KeepTogether([title_row, body, Spacer(1, 8)])


def quote(text, bg=PAPER, fg=INK):
    """A subtle pull-quote block."""
    inner = Paragraph(
        f'<font name="{_FONT_BODY_ITALIC}" size=10><i>{text}</i></font>', style_body_left
    )
    t = Table([[inner]], colWidths=[170 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, -1), 3, BRAND),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return KeepTogether([t, Spacer(1, 10)])


# --- Content ----------------------------------------------------------------
def build():
    story = []

    # ════════ COVER ═════════════════════════════════════════════════════════
    story.append(Spacer(1, 40))
    story.append(Paragraph("ParkProof", style_title))
    story.append(Paragraph("Build Journal — the 10 days that shipped it", style_subtitle))
    story.append(rule(thickness=2, colour=BRAND))
    story.append(Spacer(1, 12))

    story.append(
        Paragraph(
            "A chronological record of how ParkProof went from an empty repo on 16 May 2026 "
            "to a launch-ready, custom-domain, internationalised, cloud-synced PWA — 100+ "
            "commits across 10 active build days, shipping for a Reddit launch on Tuesday "
            "26 May. Each day gets a narrative, the commits that landed, and a decision-tree "
            "block at every pivot where a chosen path replaced one I'd ruled out.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "Read this as a build artefact, not a sales document. It's honest about the dead "
            "ends — including the ~5 hours on 20 May spent trying to bypass the API Gateway "
            "30-second timeout with two architectures that failed before the third one stuck, "
            "and the silent PDF-export bug caught on 24 May during a pre-launch audit that "
            "would have shipped to roughly a third of supported users.",
            style_body,
        )
    )

    story.append(Spacer(1, 20))
    story.append(
        stats_row(
            [
                stat_chip("Build Days", "10", BRAND),
                stat_chip("Commits", "100+", INK),
                stat_chip("Languages", "9", ACCENT),
                stat_chip("AWS / mo", "~$5", GREEN),
            ]
        )
    )

    story.append(Spacer(1, 24))
    story.append(Paragraph("The arc, at a glance", style_h3))
    arc = [
        ("16 May", "Foundation",          "Initial commit + reminders + screenshot harness + PDF fixes"),
        ("17 May", "The Big Push",        "Live countdown · Cognito + DDB + S3 cloud sync · 5-language i18n · Layer 2 telemetry"),
        ("18 May", "Polish + Launch",     "Custom domain · 16-screenshot pipeline · case study · UX bug-fix sweep"),
        ("19 May", "Safety Gates",        "Pre-launch audit · paid-parking acknowledgement · no-sign-here flow"),
        ("20 May", "Crisis + Pivot",      "Accessibility gate · 30s timeout crisis → async-polling architecture · end-of-session feature"),
        ("21 May", "Harden + Domain",     "Test coverage filled (66 cases) · lambda contract tests (20) · 2 prompt fixes · DNS migration · www.parkproof.com.au live"),
        ("22 May", "De-identify + Push",  "Apple Bundle ID rotation · web push end-to-end · 7 → 9 languages · visual pop refresh"),
        ("23 May", "Two-App Cutover",     "Marketing landing at / · React PWA at /app/ · considered-and-deferred docs"),
        ("24 May", "Pre-launch Hardening", "PDF font crisis caught · Lambda warmer · /verify page · reminder visibility surface · 18 more"),
        ("25 May", "Launch Eve",          "Sign-in CTA gap fix · screenshot refresh · Reddit thumbnail polish · case-study tightening"),
    ]
    # Wrap each non-header cell in a Paragraph so long "Headline work" entries
    # wrap onto a second line rather than overflowing the column width. The
    # previous version passed bare strings — fine for short rows like 16 May,
    # but the 17 May and 20 May headlines (95-99 chars each) ran off the right
    # edge of the table.
    arc_cell = ParagraphStyle(
        "ArcCell",
        parent=style_body_left,
        fontSize=9,
        leading=12,
        spaceAfter=0,
    )
    arc_cell_bold = ParagraphStyle("ArcCellBold", parent=arc_cell, fontName=_FONT_BODY_BOLD)
    arc_header = ParagraphStyle(
        "ArcHeader",
        parent=arc_cell,
        fontName=_FONT_BODY_BOLD,
        textColor=WHITE,
    )
    arc_rows = [
        [Paragraph(t, arc_header) for t in ("Date", "Theme", "Headline work")]
    ] + [
        [
            Paragraph(date, arc_cell),
            Paragraph(theme, arc_cell_bold),
            Paragraph(headline, arc_cell),
        ]
        for date, theme, headline in arc
    ]
    arc_tbl = Table(arc_rows, colWidths=[20 * mm, 38 * mm, 112 * mm])
    arc_tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("BACKGROUND", (0, 1), (-1, -1), PAPER),
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, PAPER_DARK),
            ]
        )
    )
    story.append(arc_tbl)

    story.append(PageBreak())

    # ════════ DAY 1 — 16 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 1 · Fri 16 May 2026 · Foundation"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Day one is an initial-commit day. The repo was created from a working state — "
            "Sign Translator, Session Logger, basic reminders, PDF export, session history all "
            "scaffolded — and the first commit is essentially the entire app in one push: 88 "
            "files, ~17,400 lines. That's the snapshot of a previous build session getting "
            "pushed up to GitHub.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The three follow-up commits are the kind of work you do once the bones are in "
            "place: deepen the reminder picker (multi-offset with auto-disabled past chips), "
            "build a Playwright screenshot harness so the README can carry real captures, and "
            "harden the PDF export against the edge cases that broke when I tried to render "
            "sessions that had no signature yet.",
            style_body,
        )
    )

    story.append(Paragraph("Commits", style_h3))
    story.append(
        commit_table(
            [
                ("98bd332", "<b>chore: initial commit</b> — 88 files, ~17,400 lines"),
                ("e6396b4", "<b>feat(reminders):</b> multi-select offsets with auto-disabled past chips"),
                ("5a236b4", "<b>feat(tooling):</b> automated screenshot harness via Playwright"),
                ("98d2f17", "<b>fix(pdf):</b> surface export errors, guard malformed signatures, fix expired-session copy"),
            ]
        )
    )

    story.append(Spacer(1, 8))
    story.append(
        decision_block(
            "Where to render the parking-spot timezone — device or spot?",
            [
                "Q: Show '3:45 pm' in the user's device locale, or in the parking spot's local time?",
                "",
                "          +-- A · Device locale",
                "          |       (simpler; works without GPS)",
                "          |       ✗ Travelling Sydneysider scans in Melbourne, sees device-Sydney",
                "          |         time on a Melbourne sign. Off by an hour at DST boundaries.",
                "          |",
                "  CHOICE -+",
                "          |",
                "          +-- B · Spot timezone via tz-lookup ←  CHOSEN",
                "                  ✓ Times always match the sign's reality",
                "                  ✓ One npm dep (tz-lookup, 6.1 MB) vs hand-rolled offset math",
                "                  ✓ Works offline (lookup is bundled, not API)",
            ],
        )
    )

    story.append(PageBreak())

    # ════════ DAY 2 — 17 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 2 · Sat 17 May 2026 · The Big Push"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "The single heaviest day of the build — 15 commits including the two largest "
            "single landings of the project: a 3,495-line cloud-sync pivot (Cognito User Pool + "
            "JWT-gated API Gateway routes + DynamoDB + S3 evidence bucket, end-to-end) and a "
            "1,704-line internationalisation expansion (Hindi + Punjabi added on top of the "
            "five-language scaffolding from earlier the same day).",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The order matters: Tier-A features (photo-quality pre-check, walk-back navigation, "
            "the home 'Currently parked' card with urgency-coloured countdown, KMS cryptographic "
            "signing) shipped <i>before</i> the auth pivot. That kept the user-facing surface "
            "complete-as-a-free-app first; cloud was layered on as opt-in durability second. "
            "Anonymous-by-default is a deliberate ParkProof design value — every feature works "
            "without a login wall.",
            style_body,
        )
    )

    story.append(
        decision_block(
            "Cloud-sync backend — which managed identity + storage stack?",
            [
                "Q: How do users sign in optionally, and where does their data live?",
                "",
                "                           +-- Firebase Auth + Firestore",
                "                           |     ✗ New cloud vendor, separate billing,",
                "                           |       another security surface to harden",
                "                           |",
                "                           +-- Supabase (Postgres + Auth + Storage)",
                "                           |     ✗ Tempting (great DX), but introduces a",
                "                           |       second hyperscaler runtime in the stack",
                "                           |",
                "  Identity + storage  -----+",
                "                           |",
                "                           +-- AWS Cognito + DDB + S3 ← CHOSEN",
                "                                 ✓ Same AWS account as the Lambda",
                "                                 ✓ Cognito JWT authoriser bolts onto the",
                "                                   existing API Gateway routes natively",
                "                                 ✓ KMS signing key already lives here",
                "                                 ✓ One bill, one IAM model, one CloudWatch",
                "                                 ~ Cognito's Hosted UI is dated — accept it",
                "                                   for federated login, custom-style email/pw",
            ],
        )
    )

    story.append(
        decision_block(
            "Adding multi-lingual UI — locale picking strategy?",
            [
                "Q: Which languages to ship and how to source the list defensibly?",
                "",
                "                       +-- Most-spoken globally (CN, ES, AR, FR, RU…)",
                "                       |     ✗ Generic. Doesn't match the user.",
                "                       |",
                "                       +-- Most-spoken in Australia (incl. EN regional)",
                "                       |     ✗ Wide list, low signal per locale added.",
                "                       |",
                "  Locale set  ---------+",
                "                       |",
                "                       +-- City of Melbourne LGA top non-English  ← CHOSEN",
                "                              langs from 2021 ABS Census",
                "                              ✓ Direct match to actual user population",
                "                              ✓ Final 7: EN, Zhongwen (zh-CN), Tieng Viet,",
                "                                 Italiano, Ellinika (el), Hindi (hi), Punjabi (pa)",
                "                              ✓ Defensible in any PM interview as a",
                "                                 data-grounded scoping decision",
            ],
        )
    )

    story.append(Paragraph("Commits", style_h3))
    story.append(
        commit_table(
            [
                ("a58cd4c", "<b>feat(home):</b> live 'Currently parked' card with urgency-coloured countdown"),
                ("9c0691b", "<b>feat(time):</b> date-aware 'Until' / 'Move by' / reminder labels"),
                ("402f531", "<b>feat+fix:</b> Tier-A features + three gotcha fixes (1,053+ lines)"),
                ("1d20352", "docs(readme): refresh stale sections after Tier-A + gotcha shipments"),
                ("c393511", "<b>feat(auth+sync):</b> Cognito sign-in, DynamoDB + S3 cloud sync, end-to-end (3,495+ lines)"),
                ("c8e7391", "<b>fix(auth):</b> SPA boot polyfill, CORS for GET + Authorization, export as PDF"),
                ("a5cd755", "docs(readme): align with the now-shipped auth + PDF-export reality"),
                ("3127e86", "docs(readme): flag pending Apple federation"),
                ("84c7d99", "<b>feat(i18n):</b> five-language support with flag selector — EN / zh-CN / vi / it / el"),
                ("d5f6f3b", "docs(readme): align with multi-lingual + auth + cloud-sync reality"),
                ("9542071", "fix(i18n): restore inline emphasis lost when strings were flattened"),
                ("d3d0419", "fix: ReuseCard Italian half-translation + stale-chunk PDF export crash"),
                ("6e84cff", "<b>feat(i18n):</b> Hindi + Punjabi + PDF translations + dropdown selector (1,704+ lines)"),
                ("2cdc257", "docs(readme): Apple federation live"),
                ("03f8006", "<b>feat(telemetry):</b> AI feedback Layer 2 — context-aware failure analytics"),
            ]
        )
    )

    story.append(PageBreak())

    # ════════ DAY 3 — 18 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 3 · Sun 18 May 2026 · Polish + Launch Prep"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "The shape of the day changes — the deploy pipeline is humming, the feature set "
            "is broadly complete, and the brief shifts from <i>build features</i> to "
            "<i>make this defensible as a portfolio piece</i>. Twelve commits, three parallel "
            "threads: domain cutover, screenshot pipeline rebuild, and the PM case-study doc.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "Bug-fix interludes throughout: the &quot;+N more&quot; pill on the active card "
            "was visually a tap target but technically wasn't (button-inside-button is invalid "
            "HTML and silently swallows the click); home-screen cards drifted off-centre when "
            "wrapped i18n strings pushed the layout; cross-device image sync wasn't actually "
            "working when users re-opened on a new device — root cause was S3 presign URLs "
            "minted under the wrong path prefix.",
            style_body,
        )
    )

    story.append(
        decision_block(
            "Custom domain — registrar route?",
            [
                "Q: parkproof.dsouza.tech is on Network Solutions. How do we point it at",
                "   CloudFront with a valid TLS cert?",
                "",
                "                            +-- Transfer registrar to Route 53",
                "                            |     ✗ ~7-day transfer window, $ cost,",
                "                            |       breaks the existing dsouza.tech setup",
                "                            |",
                "                            +-- Use Route 53 as DNS-only (NS records",
                "                            |   delegated from Network Solutions)",
                "                            |     ✗ Adds a second DNS provider to maintain,",
                "                            |       Network Solutions' NS-delegation UI is",
                "                            |       known to be quirky",
                "                            |",
                "  Domain → CloudFront ------+",
                "                            |",
                "                            +-- ACM cert in us-east-1 + CNAME on    ← CHOSEN",
                "                                  Network Solutions pointing at the",
                "                                  CloudFront distribution",
                "                                  ✓ Single CNAME row; Network Solutions",
                "                                    panel is enough",
                "                                  ✓ ACM auto-renewal stays in AWS",
                "                                  ✓ Cert + distro live in the same account",
                "                                  ✗ ~2 hours lost to Network Solutions",
                "                                    DNS UI quirks (slow propagation,",
                "                                    no DNS preview)",
            ],
        )
    )

    story.append(Paragraph("Commits", style_h3))
    story.append(
        commit_table(
            [
                ("3ab2e6f", "<b>feat(domain):</b> cut over to parkproof.dsouza.tech"),
                ("79d5acc", "chore(public): drop unused / off-brand orphan assets"),
                ("fb1fa8b", "docs: refresh README + CLAUDE for current shipped surface"),
                ("7bbe469", "chore: add MIT LICENSE"),
                ("34cef80", "docs(readme): fix stale numbers + add cloud-sync to feature list"),
                ("8b6d103", "fix(i18n): home-screen cards drift off-centre when translations wrap"),
                ("5116c7e", "<b>feat(screenshots):</b> expand pipeline to 16 captures + add real fixtures"),
                ("558aed1", "docs(screenshots): regenerate all 16 from the expanded pipeline"),
                ("73df423", "docs(readme): restructure Demo into 4 themed sub-grids"),
                ("e8388b9", "<b>docs: add PM case study</b> (docs/case-study.md)"),
                ("b82eef6", "<b>fix(home):</b> &quot;+N more&quot; pill is now a real tap target, not a UX lie"),
                ("e3e1ceb", "<b>fix(sync):</b> cross-device images now actually load"),
            ]
        )
    )

    story.append(PageBreak())

    # ════════ DAY 4 — 19 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 4 · Mon 19 May 2026 · Safety Gates"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "A quiet day by commit count (2) but big by impact. The first commit is the "
            "pre-launch audit — fixes for stale doc references, missing alt-text, OG-image "
            "metadata. The second is the day's substantive feature: <b>paid-parking + "
            "no-sign-here</b>. Both are safety mechanisms.",
            style_body,
        )
    )
    story.append(
        quote(
            "The paid-parking acknowledgement is the most under-appreciated decision I made on "
            "this project. Without it, ParkProof says 'you can park now' for a paid bay without "
            "the user explicitly acknowledging they need to pay — which is the exact failure "
            "mode that creates a wrongful-feeling ticket. The gate turns an implicit assumption "
            "into an explicit choice."
        )
    )

    story.append(
        decision_block(
            "Detecting 'no sign here' parking — how to capture the spot defensibly?",
            [
                "Q: User wants to log a park at a spot with no posted restrictions — what",
                "   evidence do we capture?",
                "",
                "                       +-- Trust the user; save GPS + arrived_at only",
                "                       |     ✗ Weak evidence if a council later disputes",
                "                       |       and claims a sign was always there",
                "                       |",
                "                       +-- Force the user to scan something anyway",
                "                       |     ✗ Defeats the purpose; the spot has no sign",
                "                       |",
                "  No-sign capture  ----+",
                "                       |",
                "                       +-- Capture an *ambient surroundings* photo  ← CHOSEN",
                "                              (substitutes for sign photo as visual evidence",
                "                               of 'no posted restrictions at this spot')",
                "                              + GPS + reverse-geocode + arrived_at",
                "                              ✓ Tamper-proof photo evidence",
                "                              ✓ No AI call — no token spend, no error path",
                "                              ✓ Renders in evidence PDF with a distinct",
                "                                 'No posted restrictions' banner",
                "                              ✗ Open-ended (no expiry) — defers the",
                "                                 'how do these sessions ever end?' question",
                "                                 to a later day (it became Day 5's feature)",
            ],
        )
    )

    story.append(Paragraph("Commits", style_h3))
    story.append(
        commit_table(
            [
                ("9fb2d45", "docs: pre-launch audit fixes"),
                ("11dcad4", "<b>feat: paid-parking gate + no-sign-here flow</b>"),
            ]
        )
    )

    story.append(PageBreak())

    # ════════ DAY 5 — 20 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 5 · Tue 20 May 2026 · Crisis + Architecture Pivot"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Today started normally and turned into a full architecture pivot. Morning: the "
            "accessibility-permit gate shipped (a parallel to yesterday's paid-parking gate — "
            "a hard RED warning when the sign requires a disability permit, blocking the Save "
            "button on an explicit acknowledgement checkbox).",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "Then a LinkedIn commenter publicly reported a sign that returned "
            "<font name='Courier' size=9>{&quot;message&quot;:&quot;Service Unavailable&quot;}</font>. "
            "The sign — a stacked Pratt Street monster (Clearway + multi-arrow + accessibility "
            "+ meter zones) — was taking Claude 30-50 seconds to read carefully. API Gateway "
            "HTTP API has a hard 30-second timeout. The first commit (84ccbb1) was a band-aid: "
            "catch the 5xx, retry once, surface a friendly 'try a clearer / cropped photo' "
            "message instead of the raw AWS error.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "But complex signs are exactly the kind ParkProof is supposed to help with. The "
            "band-aid was unacceptable. I spent the afternoon attempting two architectures "
            "that should have worked — both failed in ways I couldn't reasonably solve in the "
            "session window — and then pivoted to a third architecture that did work.",
            style_body,
        )
    )

    story.append(
        decision_block(
            "Bypassing the API Gateway 30s timeout — three attempts",
            [
                "Q: Complex signs take 30-50s. API Gateway HTTP API caps at 30s. How?",
                "",
                "                +-- A · CloudFront → Lambda Function URL (OAC, sigv4)",
                "                |       Idea: CloudFront has a 60s origin-response timeout.",
                "                |             OAC signs requests to a Function URL with",
                "                |             AuthType=AWS_IAM, bypassing the gateway.",
                "                |       ✗ Persistent sigv4 signature mismatches.",
                "                |         CloudFront's signing payload didn't match what",
                "                |         the Lambda Function URL was verifying — multiple",
                "                |         AWS forum threads describe the same dead-end.",
                "                |         Burned ~90 min. Reverted.",
                "                |",
                "                +-- B · Cognito Identity Pool + anonymous sigv4",
                "                |       Idea: Frontend gets anon AWS creds, signs Lambda",
                "                |             Function URL requests directly. No gateway.",
                "                |       ✗ 403 from the Function URL despite IAM-simulate",
                "                |         showing the role had iam:lambda:InvokeFunctionUrl.",
                "                |         Same-account principal worked; the Cognito role's",
                "                |         signed requests didn't. Some account-level block I",
                "                |         couldn't identify. Burned ~60 min. Reverted.",
                "                |",
                "  30s ceiling --+",
                "                |",
                "                +-- C · Async-polling pipeline   ← SHIPPED",
                "                       Idea: Stop fighting the gateway. POST returns 202 +",
                "                             job_id immediately. Lambda self-invokes async",
                "                             and writes the result to a DDB table with TTL.",
                "                             Client polls GET /<route>/status/{job_id} every",
                "                             1.5s. Each poll is a single DDB GetItem — fast,",
                "                             fits the 30s window with room to spare.",
                "                       ✓ Lambda's own 60s timeout is the new ceiling, not",
                "                          API Gateway's 30s.",
                "                       ✓ Each piece is small and well-understood (DDB TTL,",
                "                          self-invocation, two new GET routes).",
                "                       ✓ The Pratt Street sign now returns in ~30-45s with",
                "                          a stepped loading state instead of a 503.",
                "                       ~ Cost of pivoting: ~5h. Cost of NOT pivoting: a",
                "                          permanent excuse on every complex Melbourne sign.",
            ],
        )
    )

    story.append(
        decision_block(
            "End-of-session signal — where should the tap target live?",
            [
                "Q: No-sign sessions stay open-ended forever without an explicit 'I've left'.",
                "   Where do we put the button?",
                "",
                "                            +-- On the home card only",
                "                            |     ✗ Hidden when the session isn't the",
                "                            |       primary active one (e.g. multi-car)",
                "                            |",
                "                            +-- Inside session detail only",
                "                            |     ✗ Two taps from home for the common case",
                "                            |",
                "  Tap-target location  -----+",
                "                            |",
                "                            +-- Both ← CHOSEN",
                "                                  ✓ Home card: pill button below walk-back",
                "                                    footer, one tap from home",
                "                                  ✓ Detail: full 'End session' button,",
                "                                    visible for ALL active sessions",
                "                                    (incl. expiry-bearing — useful when",
                "                                    leaving early and you want the PDF to",
                "                                    show actual duration)",
            ],
        )
    )

    story.append(Paragraph("Commits", style_h3))
    story.append(
        commit_table(
            [
                ("ffef865", "<b>feat(safety):</b> accessibility-permit gate"),
                ("84ccbb1", "fix(api): retry-with-friendly-error layer for 30s API Gateway timeout (band-aid)"),
                ("b325a47", "<b>feat(lambda):</b> async-job pipeline for slow Claude routes"),
                ("4b0f30a", "<b>feat(api):</b> postJsonAndPoll helper for the async-job endpoints"),
                ("0255376", "<b>feat(session):</b> driver-signalled end-of-session"),
                ("3317a96", "docs: document driver-signalled end-of-session + no-sign mode"),
            ]
        )
    )

    story.append(PageBreak())

    # ════════ DAY 6 — 21 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 6 · Wed 21 May 2026 · Hardening + Real Domain"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "The day after launch turns into a quiet hardening day. Two threads in parallel — "
            "test coverage from scaffolding to green, and the proper domain migration off "
            "the personal-domain subdomain (<font name='Courier' size=9>parkproof.dsouza.tech</font>) "
            "onto a real <font name='Courier' size=9>parkproof.com.au</font>. "
            "Live users from yesterday's LinkedIn launch keep arriving on the legacy URL the "
            "whole time; nothing breaks.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "Six commits, ~1,100 lines of test code, a deferred-by-design contract-test pivot "
            "for the lambda's prompt regressions, and an ~8-step DNS / cert / CloudFront / "
            "Cognito / CORS migration to land <font name='Courier' size=9>https://www.parkproof.com.au</font> "
            "as the canonical URL. Two prompt fixes (EasyPark detection, "
            "accessibility-permit gate) caught and shipped along the way.",
            style_body,
        )
    )

    story.append(
        decision_block(
            "URL forwarding for the apex + .au variants — registrar vs Cloudflare?",
            [
                "Q: parkproof.com.au (apex) + parkproof.au + www.parkproof.au all need to",
                "   301-redirect to https://www.parkproof.com.au. Where does the redirect live?",
                "",
                "                            +-- A · Crazy Domains URL Forwarding",
                "                            |     X $26 AUD/year PER DOMAIN. ~$52/yr for the",
                "                            |       two redirecting domains. Pay a registrar",
                "                            |       for what's a free feature elsewhere.",
                "                            |     X Reports of HTTPS forwarding flakiness ",
                "                            |       (cert warnings during redirect).",
                "                            |",
                "                            +-- B · CloudFront alt-name + edge function",
                "                            |     X Requires apex-CNAME-flattening, which",
                "                            |       Crazy Domains' DNS doesn't support",
                "                            |       (their validator also rejects underscore",
                "                            |       prefixes in CNAME values — discovered",
                "                            |       mid-cert-validation).",
                "                            |",
                "  Redirect host  -----------+",
                "                            |",
                "                            +-- C · Cloudflare DNS + Page Rules  <-- CHOSEN",
                "                                  / Free forever (free tier supports all needed)",
                "                                  / Real 301 with valid HTTPS",
                "                                  / CNAME flattening at apex available for free",
                "                                    if we later switch to apex-canonical",
                "                                  / Free DDoS / analytics as bonus",
                "                                  / DNS imports MX/SPF/DKIM email records",
                "                                    automatically (Titan email preserved)",
                "                                  ~ ~30 min nameserver propagation (fast)",
                "                                  ~ Manual add for ACM validation CNAMEs",
                "                                    (Cloudflare's importer skips _-prefixed)",
            ],
        )
    )

    story.append(
        decision_block(
            "Test surface — what to cover, what to defer",
            [
                "Q: 110 it.todo cases across 5 risk-targeted test files. Fill all of them?",
                "",
                "          +-- A · Fill every case end-to-end",
                "          |       X The 18 in lambda/refresh.test.js hit the live Claude",
                "          |         API. Costs ~$0.02 per scan, slow, flaky in CI, doesn't",
                "          |         test the wiring (the prompt itself is the thing under",
                "          |         test in those scenarios).",
                "          |",
                "          +-- B · Fill only the pure-function suites (66 cases)",
                "          |       / walk-back, time-format, storage all pure logic with",
                "          |         clean edge cases. ~3-4h of focused writing, all green.",
                "          |       X Leaves visible WIP in vitest output (18 todo) on the",
                "          |         lambda file. Anti-portfolio.",
                "          |",
                "  Tests  -+",
                "          |",
                "          +-- C · Fill 66 pure + write contract tests for lambda  <-- CHOSEN",
                "                  / Mock @anthropic-ai/sdk, verify request SHAPE (the prompt",
                "                    content, model config, schema enforcement, refresh-mode",
                "                    branching).",
                "                  / Tests catch the regressions that ACTUALLY happen:",
                "                    someone deleting an instruction from the prompt during",
                "                    refactor, the model name flipping, the cache_control",
                "                    getting dropped, etc.",
                "                  / 92 cases green + 20 contract cases = 112/112. No WIP",
                "                    in output. Honest about what's tested vs not.",
                "                  / Real-user behaviour on the live site IS the integration",
                "                    test for prompt reasoning. Don't test what you can't",
                "                    afford to fail in CI.",
            ],
        )
    )

    story.append(Paragraph("Commits", style_h3))
    story.append(
        commit_table(
            [
                ("b342dac", "<b>test:</b> fill walk-back / time-format / storage suites (66 cases)"),
                ("c62adc8", "<b>test(lambda):</b> contract tests for refresh-mode prompt + request shape (20 cases)"),
                ("a2b2b4f", "<b>fix(prompt):</b> EasyPark / payment-methods detection regression"),
                ("d9437fa", "<b>fix(prompt):</b> ♿-only bays are parkable (with permit), not a hard block"),
                ("cd6130f", "<b>feat(domain):</b> cut over canonical URL to www.parkproof.com.au"),
            ]
        )
    )

    story.append(
        Paragraph(
            "<font name='Courier' size=9>parkproof.dsouza.tech</font> stays alive for 7 days "
            "as fallback. Old evidence PDFs continue to verify against the public key served "
            "from either domain. Total Day 6 cost: ~$0 on AWS (Cloudflare free tier eats the "
            "DNS work), saved ~$52 AUD/year vs. Crazy Domains' URL-forwarding upcharge.",
            style_body,
        )
    )

    story.append(PageBreak())

    # ════════ DAY 7 — 22 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 7 · Fri 22 May 2026 · De-identify + Web Push"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "A long day. ~25 commits. The brief: <b>strip every trace of personal identity from "
            "the public surface before posting on Reddit</b>, finish the Web Push pipeline "
            "end-to-end, and add the two locales the LGA-census pass had missed.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The de-identification pass alone was eight commits. The personal name was on the "
            "About-page footer, in the LinkedIn case-study link, in the <font name='Courier' "
            "size=9>melroy@</font> email address used as the privacy-policy contact, and — most "
            "awkwardly — in the Apple Sign-in OAuth consent screen, which read <i>\"Continue "
            "to ParkProof using your Apple ID. Created by [Personal Name].\"</i> Every one of "
            "those is a place a Reddit commenter could screenshot and turn into the post. The "
            "fix was methodical: swap to <font name='Courier' size=9>hello@parkproof.com.au</font> "
            "everywhere, drop the LinkedIn refs, rotate the Apple App ID + Services ID + Key to "
            "a new bundle (<font name='Courier' size=9>au.com.parkproof.app</font>) carrying no "
            "personal name, and re-translate the About page so the new copy stayed consistent "
            "across the 7 then-supported locales.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The Web Push pipeline shipped in four staged commits — foundation (VAPID + DDB "
            "subscription store + <font name='Courier' size=9>/push/subscribe</font> route), "
            "service worker push + notificationclick handlers (which required switching "
            "<font name='Courier' size=9>vite-plugin-pwa</font> from <font name='Courier' "
            "size=9>generateSW</font> to <font name='Courier' size=9>injectManifest</font> mode "
            "so the SW could carry our custom handler), the EventBridge Scheduler dispatcher, "
            "and a cancel-on-end-session sweep that fan-outs <font name='Courier' size=9>"
            "DeleteSchedule</font> calls when the driver signals \"I've left.\"",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "Then the visual pop refresh: AI-generated photoreal hero (Nano Banana) composited "
            "with the layered-P brand mark on the sign face, split-colour \"Parking made "
            "simple.\" headline, purple-gradient primary CTA, dot-grid background, sage + "
            "topographic rings + corner aurora (\"variant J\") replacing the cool tech-grey "
            "body bg. Five style iterations on the aurora alone before the 3× radius felt "
            "right.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "And finally: Indonesian + Korean. The original LGA-census pass had picked seven "
            "languages off the 2021 ABS data; a sanity-check on the actual City of Melbourne "
            "ranking surfaced Indonesian (#3) and Korean (#6) as top-non-English-spoken-at-home "
            "languages the first cut had missed. Adding them was ~2 hours of translation + "
            "flag-picker updates. Worth it for the defensibility of the locale set.",
            style_body,
        )
    )

    story.append(
        decision_block(
            "Push schedule naming — deterministic vs random?",
            [
                "Q: One EventBridge Scheduler schedule per chosen reminder offset (15min, 30min,",
                "   1hr...). When the driver ends the session early, all of them need to go.",
                "   How do we find them to delete?",
                "",
                "           +-- A · Random UUID names, ListSchedules at delete time",
                "           |       ✗ Needs scheduler:ListSchedules IAM permission",
                "           |       ✗ ListSchedules is rate-limited and paginated",
                "           |       ✗ Race condition: a new schedule might land between",
                "           |         list and delete",
                "           |",
                "   Find ---+",
                "           |",
                "           +-- B · Deterministic names  ←  CHOSEN",
                "                   `parkproof-push-{session_id}-{i}`",
                "                   ✓ Cancel = 6 parallel DeleteSchedule calls, no list needed",
                "                   ✓ No new IAM permission to grant",
                "                   ✓ Idempotent on re-pick (overwrite same name)",
                "                   ✓ Trivial to reason about in logs",
            ],
        )
    )
    story.append(
        Paragraph(
            "The path mattered more than the destination. Deterministic names let the cancel "
            "pathway stay as boring as <font name='Courier' size=9>Promise.all(offsets.map(i => "
            "deleteSchedule(name(sessionId, i))))</font> without ever calling <font "
            "name='Courier' size=9>ListSchedules</font>.",
            style_body,
        )
    )

    story.append(Paragraph("Commits (selected — 25 total)", style_h3))
    story.append(
        commit_table(
            [
                ("38718ec", "<b>feat(about):</b> drop \"on the way\" section + translate to 7 languages"),
                ("583b7e9", "<b>feat(push):</b> web push foundation (subscribe + persist)"),
                ("f375a7a", "<b>feat(push):</b> SW push + notificationclick via injectManifest"),
                ("a97c576", "<b>feat(push):</b> scheduler + de-identification + docs refresh"),
                ("495e5f6", "<b>chore(auth):</b> rotate Apple Bundle ID + Services ID + Key"),
                ("18c5546", "<b>feat(landing):</b> visual pop refresh — split-colour hero + gradient CTA"),
                ("0eb5f2d", "<b>feat(hero):</b> swap SVG illustration for AI-generated photoreal hero"),
                ("0bf27cc", "<b>feat(bg):</b> ship sage + topographic rings + corner aurora (\"variant J\")"),
                ("53a7604", "<b>feat(i18n):</b> add Indonesian + Korean (7 → 9 languages)"),
                ("0756585", "<b>docs:</b> final pre-launch consistency sweep — 9 languages, 7 days"),
            ]
        )
    )

    story.append(PageBreak())

    # ════════ DAY 8 — 23 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 8 · Sat 23 May 2026 · Two-App Architecture"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "A focused, short day — 5 commits. The biggest one is the <b>two-app architecture "
            "cutover</b>: marketing landing page at <font name='Courier' size=9>/</font>, "
            "React PWA at <font name='Courier' size=9>/app/</font>. Until today, the React app "
            "was serving the marketing page too — bundle bloat, slower first paint, the Router-"
            "less \"home\" view doing double duty as a landing page. Splitting them freed the "
            "landing to be hand-tuned static HTML/CSS (instant first paint, no JS to parse) "
            "while the PWA stayed at <font name='Courier' size=9>/app/</font> with all the "
            "state-machine routing intact.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The trade-off was real: every <font name='Courier' size=9>&lt;img src=\"/foo.png\"&gt;"
            "</font> in the React app had to route through Vite's <font name='Courier' size=9>"
            "BASE_URL</font> after the cutover or it 404'd because the asset now lived at "
            "<font name='Courier' size=9>/app/</font>. Commit <font name='Courier' size=9>"
            "4add63e</font> was the cleanup pass. CloudFront also needed a viewer-request "
            "function (<font name='Courier' size=9>parkproof-uri-rewrite</font>) to handle the "
            "trailing-slash resolution OAC + S3 REST origins don't do natively (S3 returns 404 "
            "for <font name='Courier' size=9>GET /app/</font>; the function rewrites to "
            "<font name='Courier' size=9>/app/index.html</font>).",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The other thread was <b>considered-and-deferred docs</b>: three of them — voice "
            "confirmation (Web Speech API), localising the marketing landing, and offline / "
            "hybrid sign reading. Each got a paragraph in <font name='Courier' size=9>"
            "docs/features.md</font> so future-me has the reasoning when the question comes "
            "back.",
            style_body,
        )
    )

    story.append(
        decision_block(
            "One app or two?",
            [
                "Q: The landing page (hero + 3 feature cards + CTA) is currently the React",
                "   app's \"home\" view. Should it stay there, or split into a static page?",
                "",
                "           +-- A · Keep one app, render landing as a React view",
                "           |       ✗ Ships React + i18n + auth code to a visitor whose",
                "           |         only intent is to read the pitch and click Scan",
                "           |       ✗ First paint blocked on bundle parse",
                "           |       ✗ Landing redesigns require a full app redeploy",
                "           |",
                "   Apps ---+",
                "           |",
                "           +-- B · Two apps — static landing at /, PWA at /app/  ←  CHOSEN",
                "                   ✓ Landing is 30KB hand-tuned HTML/CSS, instant paint",
                "                   ✓ React app stays at /app/ behind code-split chunks",
                "                   ✓ Marketing page edits ship without touching the app",
                "                   ✗ Every absolute-path asset needs to route through",
                "                     BASE_URL — one careful cleanup pass",
                "                   ✗ CloudFront viewer-request function needed for",
                "                     /app/ trailing-slash → /app/index.html (S3 REST",
                "                     origins don't do this natively)",
            ],
        )
    )

    story.append(Paragraph("Commits", style_h3))
    story.append(
        commit_table(
            [
                ("deae35e", "<b>feat:</b> two-app architecture — marketing landing at /, PWA at /app/"),
                ("4add63e", "<b>fix:</b> route absolute-path assets through Vite base after /app/ cutover"),
                ("244db78", "<b>docs:</b> capture two-app cutover gotchas in migration runbook"),
                ("860a2fe", "<b>docs(status):</b> mark Web Push + two-app shipped, refresh canonical"),
                ("5e9e844", "<b>docs:</b> file voice confirmation as considered-and-deferred"),
            ]
        )
    )

    story.append(PageBreak())

    # ════════ DAY 9 — 24 MAY ════════════════════════════════════════════════
    story.append(coloured_band("DAY 9 · Sun 24 May 2026 · Pre-launch Hardening (Tier 1)"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "The most PM-y day of the project. With the feature set frozen and CI green, I sat "
            "down on Sunday afternoon — ~48 hours before the planned Reddit launch — and "
            "explicitly enumerated <b>what could break under launch traffic that a green build "
            "wouldn't catch</b>. Six items, ~5 hours of work, framed as a \"Tier 1\" list: "
            "<i>if any of these fails on launch day, you'll cringe</i>. Then I worked the list.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "22 commits. The single biggest catch is the one I almost shipped without noticing.",
            style_body,
        )
    )
    story.append(
        quote(
            "<b>The PDF font crisis.</b> Item 1 on the audit list was \"actually export a PDF "
            "in every supported locale.\" I'd never done it. The strings were translated, "
            "<font name='Courier' size=9>jsPDF</font> was wired in, the UI worked. But "
            "<font name='Courier' size=9>jsPDF</font> ships with Adobe Type 1 fonts that have "
            "<b>zero</b> glyph coverage for Devanagari, Gurmukhi, CJK, Greek, or Vietnamese. "
            "Six of nine locales rendered evidence PDFs as missing-glyph rectangles. Silent "
            "data corruption for ~30% of supported users. Would have been a \"btw your evidence "
            "PDF is just boxes\" Reddit comment within hours of going live."
        )
    )
    story.append(
        Paragraph(
            "The fix was substantive but mechanical once the diagnosis was right: source "
            "variable-weight Noto Sans TTFs from the Google Fonts GitHub repo, write a Python "
            "build-time script that subsets each font down to just the glyphs that appear in "
            "the locale JSONs (94% size reduction — Chinese Simplified went from 17MB to "
            "893KB), self-host the subsets on CloudFront, lazy-load the right one per locale "
            "at PDF export time. Two hours of focused work. Ships clean.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The interesting bit isn't the fix — it's that the <i>audit</i> found it. A "
            "different sequencing (skip the audit, trust the build, hit publish) would have "
            "shipped the bug.",
            style_body,
        )
    )

    story.append(
        decision_block(
            "The Tier 1 audit list",
            [
                "Q: Feature work is done, CI is green, the site is technically launch-ready.",
                "   What could still cringe on launch day?",
                "",
                "   The list I wrote on Sunday afternoon:",
                "",
                "   1. PDF export in every locale, not just English",
                "      → Caught: 6/9 locales rendered as glyph boxes. Fixed.",
                "   2. Reddit / iMessage / LinkedIn share preview",
                "      → Caught: no OG tags on the new marketing landing. Fixed.",
                "   3. First Reddit visitor's cold-start latency",
                "      → Caught: 1-3s p99 cold-start. Fixed with EventBridge",
                "        warmer pinging every 5 min.",
                "   4. Reminder visibility after setting",
                "      → Caught: pushes were invisible after configuration. Built",
                "        self-service management surface.",
                "   5. CloudWatch dashboard for the launch window",
                "      → Built. 9 widgets across 4 rows.",
                "   6. Rollback playbook in CLAUDE.md",
                "      → Written. Symptom triage table + revert recipes.",
                "",
                "   Every item is a thing that doesn't fail a test, can't be caught by",
                "   lint, and isn't worth a feature PR — but each one, left unchecked,",
                "   becomes a launch-day cringe moment.",
            ],
        )
    )

    story.append(
        decision_block(
            "PDF font sourcing strategy",
            [
                "Q: jsPDF needs a TTF (not WOFF/WOFF2) registered per locale at export",
                "   time. Six locales need non-Latin scripts. What's the smallest, most",
                "   maintainable pipeline?",
                "",
                "           +-- A · @fontsource v5 from npm",
                "           |       ✗ Ships WOFF only. jsPDF needs TTF.",
                "           |       ✗ Adds 5 new top-level dependencies for what is",
                "           |         fundamentally a static asset problem.",
                "           |",
                "           +-- B · Bundle full Noto Sans TTFs with the SPA",
                "           |       ✗ Chinese Simplified is 17MB uncompressed.",
                "           |         Korean is 11MB. Inflates the bundle ~50MB for",
                "           |         users who'll never trigger PDF export in those",
                "           |         locales.",
                "           |",
                "   Fonts --+",
                "           |",
                "           +-- C · Subset + self-host + lazy-load  ←  CHOSEN",
                "                   • Source: google/fonts GitHub raw URLs",
                "                   • Build: scripts/_subset_pdf_fonts.py runs",
                "                     pyftsubset over each locale JSON's unique",
                "                     glyphs, --no-hinting --desubroutinize",
                "                   • Result: 94% size reduction (CJK 17MB → 893KB)",
                "                   • Runtime: src/lib/pdf-fonts.ts lazy-fetches",
                "                     the right subset for the active locale",
                "                   ✓ Bundle stays small",
                "                   ✓ Subset is reproducible — re-run the script",
                "                     when locales change",
                "                   ✓ jsPDF gets a real TTF with the glyphs it",
                "                     needs and nothing else",
            ],
        )
    )

    story.append(
        decision_block(
            "Reminder visibility — invisible vs managed",
            [
                "Q: After picking reminder offsets, the schedules live in EventBridge —",
                "   invisible from the app. The .ics event renders in the user's calendar,",
                "   but Web Push is a black box: set-and-forget, no way to see what's queued,",
                "   no way to cancel without redoing the whole session. That violates the",
                "   trust principle the rest of the product is built on.",
                "",
                "           +-- A · Don't show anything; trust EventBridge",
                "           |       ✗ User can't verify reminders were set",
                "           |       ✗ \"I never got the push\" — no way to tell from",
                "           |         the app whether it was queued, denied, or SW-failed",
                "           |",
                "           +-- B · Show a passive list — no controls",
                "           |       ✗ Half-measure. \"3 reminders queued\" but still",
                "           |         can't change them.",
                "           |",
                "   Vis  ---+",
                "           |",
                "           +-- C · Full self-service management  ←  CHOSEN",
                "                   • Lists every queued fire_at, time-formatted",
                "                   • Per-row × cancel (DeleteSchedule one-shot)",
                "                   • \"+ Add reminder\" picker filtered to offsets",
                "                     that haven't already fired or aren't queued",
                "                   • Preserves per-reminder body text across edits",
                "                     (bug caught and fixed pre-launch)",
                "                   ✓ Went from fire-and-forget to managed-and-trusted",
                "                     in 2.5 hours",
            ],
        )
    )

    story.append(Paragraph("Commits (selected — 22 total)", style_h3))
    story.append(
        commit_table(
            [
                ("bfc3d24", "<b>docs+i18n:</b> soften legal-promising language across all surfaces"),
                ("9fa6ae6", "<b>feat(landing):</b> public /verify/ page with openssl walkthrough"),
                ("eaa3d16", "<b>feat(verify):</b> multi-lingual /verify pages in all 9 locales"),
                ("d68cd07", "<b>fix(i18n):</b> include querystring in detection chain"),
                ("5eda011", "<b>fix(pdf):</b> render non-Latin scripts via self-hosted Noto Sans"),
                ("5e782ba", "<b>feat(lambda):</b> pre-warm via EventBridge to kill cold-start"),
                ("0efe3d4", "<b>docs:</b> add rollback playbook to CLAUDE.md"),
                ("6307c64", "<b>feat(seo):</b> OG cards + canonical + robots/sitemap on landing"),
                ("732d584", "<b>feat(pwa):</b> service worker update banner"),
                ("937958d", "<b>feat(ops):</b> launch-day CloudWatch dashboard + 30-day log retention"),
                ("7706116", "<b>feat(reminders):</b> scheduled-reminder visibility + per-session mgmt"),
                ("62146aa", "<b>feat(a11y):</b> reduced-motion respect + OAuth callback splash"),
                ("c4e3e84", "<b>feat(polish):</b> Tier 3 polish bundle — 5 self-contained launches"),
            ]
        )
    )

    story.append(PageBreak())

    # ════════ DAY 10 — 25 MAY ═══════════════════════════════════════════════
    story.append(coloured_band("DAY 10 · Mon 25 May 2026 · Launch Eve"))
    story.append(Spacer(1, 4))
    story.append(
        Paragraph(
            "Three commits, three categories of fix: a genuine UX gap, a stale-asset refresh, "
            "and Reddit-thumbnail polish. Tomorrow morning is the launch.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The gap I almost shipped: <b>first-time visitors who already had an account on "
            "another device had no path to sign in</b>. The first-time landing surfaced the "
            "gradient \"Scan a parking sign\" CTA and nothing else. Returning users see auth "
            "options in the home view's overflow menu, but a first-time visitor on a new device "
            "— say, a returning Mac user opening the iOS app fresh — had to <i>create a dummy "
            "session</i> to discover the sign-in path. That's a fatal cross-device-recovery "
            "gap. The fix was small: pass an <font name='Courier' size=9>onSignInCta</font> "
            "prop from <font name='Courier' size=9>App.tsx</font> to <font name='Courier' "
            "size=9>LandingFeatures</font> (only when <font name='Courier' size=9>"
            "auth.configured &amp;&amp; !auth.user</font>), which renders a white-on-paper "
            "secondary button directly below the gradient CTA. Reuses the existing <font "
            "name='Courier' size=9>home.signInToSync</font> i18n key, so no translation churn "
            "across 9 locales.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "The first attempt at this fix put a small underlined link at the <i>bottom</i> of "
            "the landing — \"Already have an account? Sign in.\" Feedback in review was "
            "decisive: <i>\"I don't like where it's located. It's genuinely hidden at the "
            "bottom of the screen. I think it should be a button below 'Check a parking "
            "sign'.\"</i> Moved it. Second attempt shipped. The dialogue mattered more than "
            "the diff: it pushed the sign-in path from <i>findable-if-you-look</i> to "
            "<i>unmissable-on-arrival</i>.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "Remaining work: a screenshot refresh (the demo grid now reflects the secondary "
            "sign-in button) and a Reddit-thumbnail tweak — the \"ParkProof\" wordmark on the "
            "carousel slide read too small at Reddit feed size, so a brand-blue header strip "
            "with the word in large Georgia Bold white got composited on top. Tiny edit, "
            "proportionally large impact on first-impression brand recognition.",
            style_body,
        )
    )
    story.append(
        Paragraph(
            "Then case-study tightening: ~260 words trimmed from 3,603 to 3,344 on seven "
            "targeted cuts — hedge sentences in the Problem section, walk-back disclaimers, "
            "the \"hiring PM would recognise\" sentence that read as fishing, a screenshot-"
            "pipeline hindsight bullet that didn't earn its weight against the others, and a "
            "stack-summary section that was 90% there but reading slightly verbose.",
            style_body,
        )
    )

    story.append(
        decision_block(
            "Sign-in CTA placement on the landing",
            [
                "Q: First-time visitors with no session see only the gradient \"Scan a parking",
                "   sign\" CTA. Cross-device-recovery users (account exists, new device) have",
                "   no path to sign in. Where does the sign-in button go?",
                "",
                "           +-- A · Bottom-of-page text link",
                "           |       ✗ Hidden below the fold on iPhone widths",
                "           |       ✗ Reads as low-importance footer fine print",
                "           |       ✗ Explicitly rejected in review",
                "           |",
                "           +-- B · Top-right of the header, next to language picker",
                "           |       ✗ Crowds the header in narrow viewports",
                "           |       ✗ \"Sign in\" pattern is button-style, not",
                "           |         icon-button-style — wouldn't read naturally in",
                "           |         a 32px corner slot",
                "           |",
                "   Slot ---+",
                "           |",
                "           +-- C · Secondary button directly below scan CTA  ←  CHOSEN",
                "                   • White-on-paper, smaller padding than gradient",
                "                   • Renders ONLY when auth.configured && !auth.user",
                "                   • Reuses home.signInToSync i18n key across all",
                "                     9 locales — no translation churn",
                "                   ✓ Unmissable on arrival",
                "                   ✓ Visual hierarchy preserved — gradient still",
                "                     wins the eye",
                "                   ✓ Two-line tap surface, mobile-thumb friendly",
            ],
        )
    )

    story.append(Paragraph("Commits", style_h3))
    story.append(
        commit_table(
            [
                ("23c49c8", "<b>fix(auth):</b> expose sign-in path for first-time visitors"),
                ("3083867", "<b>fix(auth):</b> move sign-in CTA next to the primary scan button"),
                ("cbc886a", "<b>docs:</b> regenerate screenshots to reflect today's UI changes"),
            ]
        )
    )

    story.append(PageBreak())

    # ════════ REFLECTION ════════════════════════════════════════════════════
    story.append(Paragraph("What this build proved", style_h2))
    story.append(rule(thickness=2, colour=BRAND))

    story.append(Paragraph("1 · Sequencing > stack", style_h3))
    story.append(
        Paragraph(
            "Tier-A features shipped before the auth pivot. The home countdown shipped before "
            "i18n. The screenshot harness shipped before the README rewrite. Order matters more "
            "than tooling — every later piece either built on or was made cheaper by the order "
            "of what came before.",
            style_body,
        )
    )

    story.append(Paragraph("2 · Anonymous-by-default is a real design principle", style_h3))
    story.append(
        Paragraph(
            "Every feature works without a login. Cloud sync is opt-in, never gated. The local "
            "copy stays the source of truth even when signed in. This isn't just a UX choice — "
            "it's why the safety gates (paid-parking, accessibility-permit) and the no-sign "
            "flow could ship without an auth dependency, and why the architecture stayed "
            "simple enough that the Day 5 timeout pivot didn't have to fight Cognito's session "
            "lifecycle on top of everything else.",
            style_body,
        )
    )

    story.append(Paragraph("3 · The right pivot is the one that simplifies the system", style_h3))
    story.append(
        Paragraph(
            "Two architectures failed on Day 5. Both would have required deep knowledge of "
            "AWS-account-level quirks to debug. The third — async polling — required none. It "
            "decomposes into three boringly small pieces (a TTL'd DDB table, an "
            "<font name='Courier' size=9>InvocationType: 'Event'</font> self-invoke, two new GET "
            "routes), all of which fit in their respective service's normal envelope. The pivot "
            "wasn't more clever; it was less clever, and that was the point.",
            style_body,
        )
    )

    story.append(Paragraph("4 · Build journals are useful in the same week", style_h3))
    story.append(
        Paragraph(
            "Most build retrospectives are written months later, when the dead ends have been "
            "softened into a tidy success story. The 5 hours of Day 5 dead-ends and the silent "
            "PDF-font bug from Day 9 are still raw in this document because the document is "
            "being written hours after they happened. That rawness is the value — a future "
            "hiring manager (or future-me planning the next build) gets to see the trade-offs "
            "as they actually were.",
            style_body,
        )
    )

    story.append(Paragraph("5 · The audit is the deliverable", style_h3))
    story.append(
        Paragraph(
            "The single most valuable session of these ten days was the 5-hour Tier-1 "
            "pre-launch audit on Sunday afternoon. Naming six things that <i>don't fail tests "
            "but do fail on launch day</i>, then working the list, caught the PDF-font crisis "
            "that would have shipped a silent data-corruption bug to ~30% of supported users. "
            "The audit cost five hours; the upside is not having to retract a Reddit post.",
            style_body,
        )
    )

    story.append(Paragraph("6 · De-identification is its own feature", style_h3))
    story.append(
        Paragraph(
            "Going from <i>\"functional product with my name on it\"</i> to <i>\"functional "
            "product that could be anyone's\"</i> took a focused half-day. Surfaces that "
            "needed sweeping: About-page footer, privacy contact email, Apple Sign-in consent "
            "screen, README/case-study LinkedIn references, VAPID <font name='Courier' "
            "size=9>mailto:</font> subject, source-code author tags. Most of these are "
            "invisible until they're embarrassing. Worth doing once, on purpose, in one pass.",
            style_body,
        )
    )

    story.append(Paragraph("7 · Trust principles compound or compound-rot", style_h3))
    story.append(
        Paragraph(
            "The reminder-visibility gap on Day 9 was a small thing — <i>\"I just told the app "
            "to set 3 push reminders; where are they?\"</i> — but it violated the trust "
            "principle the rest of the product is built on (anonymous by default, transparent "
            "about what's running, user is in control). Fixing it was 2.5 hours. Not fixing it "
            "would have rotted the trust principle by one notch, and the next gap would have "
            "rotted it by another. These don't add linearly.",
            style_body,
        )
    )

    story.append(PageBreak())

    # ════════ APPENDIX — FULL COMMIT LOG ════════════════════════════════════
    story.append(Paragraph("Appendix · Full commit log", style_h2))
    story.append(rule(thickness=2, colour=BRAND))
    story.append(
        Paragraph(
            "Every commit on <font name='Courier' size=9>main</font>, oldest first.",
            style_caption,
        )
    )

    all_commits = [
        # Day 1
        ("98bd332", "16 May", "chore: initial commit"),
        ("e6396b4", "16 May", "feat(reminders): multi-select offsets with auto-disabled past chips"),
        ("5a236b4", "16 May", "feat(tooling): automated screenshot harness via Playwright"),
        ("98d2f17", "16 May", "fix(pdf): surface export errors, guard malformed signatures, fix expired-session copy"),
        # Day 2
        ("a58cd4c", "17 May", "feat(home): live 'Currently parked' card with urgency-coloured countdown"),
        ("9c0691b", "17 May", "feat(time): date-aware 'Until' / 'Move by' / reminder labels"),
        ("402f531", "17 May", "feat+fix: Tier-A features + three gotcha fixes"),
        ("1d20352", "17 May", "docs(readme): refresh stale sections after Tier-A + gotcha shipments"),
        ("c393511", "17 May", "feat(auth+sync): Cognito sign-in, DynamoDB + S3 cloud sync, end-to-end"),
        ("c8e7391", "17 May", "fix(auth): SPA boot polyfill, CORS for GET + Authorization, export as PDF"),
        ("a5cd755", "17 May", "docs(readme): align with the now-shipped auth + PDF-export reality"),
        ("3127e86", "17 May", "docs(readme): flag pending Apple federation"),
        ("84c7d99", "17 May", "feat(i18n): five-language support with flag selector"),
        ("d5f6f3b", "17 May", "docs(readme): align with multi-lingual + auth + cloud-sync reality"),
        ("9542071", "17 May", "fix(i18n): restore inline emphasis lost when strings were flattened"),
        ("d3d0419", "17 May", "fix: ReuseCard Italian half-translation + stale-chunk PDF export crash"),
        ("6e84cff", "17 May", "feat(i18n): Hindi + Punjabi + PDF translations + dropdown selector"),
        ("2cdc257", "17 May", "docs(readme): Apple federation live"),
        ("03f8006", "17 May", "feat(telemetry): AI feedback Layer 2"),
        # Day 3
        ("3ab2e6f", "18 May", "feat(domain): cut over to parkproof.dsouza.tech"),
        ("79d5acc", "18 May", "chore(public): drop unused / off-brand orphan assets"),
        ("fb1fa8b", "18 May", "docs: refresh README + CLAUDE for current shipped surface"),
        ("7bbe469", "18 May", "chore: add MIT LICENSE"),
        ("34cef80", "18 May", "docs(readme): fix stale numbers + add cloud-sync to feature list"),
        ("8b6d103", "18 May", "fix(i18n): home-screen cards drift off-centre when translations wrap"),
        ("5116c7e", "18 May", "feat(screenshots): expand pipeline to 16 captures + add real fixtures"),
        ("558aed1", "18 May", "docs(screenshots): regenerate all 16"),
        ("73df423", "18 May", "docs(readme): restructure Demo into 4 themed sub-grids"),
        ("e8388b9", "18 May", "docs: add PM case study"),
        ("b82eef6", "18 May", "fix(home): '+N more' pill is now a real tap target"),
        ("e3e1ceb", "18 May", "fix(sync): cross-device images now actually load"),
        # Day 4
        ("9fb2d45", "19 May", "docs: pre-launch audit fixes"),
        ("11dcad4", "19 May", "feat: paid-parking gate + no-sign-here flow"),
        # Day 5
        ("ffef865", "20 May", "feat(safety): accessibility-permit gate"),
        ("84ccbb1", "20 May", "fix(api): retry-with-friendly-error layer for 30s API Gateway timeout"),
        ("b325a47", "20 May", "feat(lambda): async-job pipeline for slow Claude routes"),
        ("4b0f30a", "20 May", "feat(api): postJsonAndPoll helper for the async-job endpoints"),
        ("0255376", "20 May", "feat(session): driver-signalled end-of-session"),
        ("3317a96", "20 May", "docs: document driver-signalled end-of-session + no-sign mode"),
        # Day 6
        ("b342dac", "21 May", "test: fill walk-back / time-format / storage suites (66 cases)"),
        ("c62adc8", "21 May", "test(lambda): contract tests for refresh-mode prompt + request shape"),
        ("a2b2b4f", "21 May", "fix(prompt): EasyPark / payment-methods detection regression"),
        ("d9437fa", "21 May", "fix(prompt): ♿-only bays are parkable (with permit), not a hard block"),
        ("cd6130f", "21 May", "feat(domain): cut over canonical URL to www.parkproof.com.au"),
        # Day 7
        ("38718ec", "22 May", "feat(about): drop 'on the way' section + translate to 7 languages"),
        ("61b3e1e", "22 May", "fix(about): strip personal identity from in-app footer"),
        ("583b7e9", "22 May", "feat(push): web push foundation (subscribe + persist)"),
        ("62ae67d", "22 May", "fix(push): add @aws-sdk dynamo packages at root for test script"),
        ("f375a7a", "22 May", "feat(push): SW push + notificationclick via injectManifest"),
        ("a1f8b4a", "22 May", "fix(push): check actual subscription, not just permission"),
        ("a97c576", "22 May", "feat(push): scheduler + de-identification + docs refresh"),
        ("848bd44", "22 May", "docs(readme): finish the audit — file tree + script table"),
        ("eaa6bdb", "22 May", "docs(screenshots): regenerate all 16 with current UI"),
        ("495e5f6", "22 May", "chore(auth): rotate Apple Bundle ID + Services ID + Key"),
        ("b8c0532", "22 May", "feat(permit-zone): acknowledgment gate for permit holders"),
        ("18c5546", "22 May", "feat(landing): visual pop refresh — split-colour hero + gradient CTA"),
        ("3296efa", "22 May", "style(polish): gradient CTAs across screens + dot-grid background"),
        ("50fcaeb", "22 May", "feat(reminders): open-ended picker for no-sign sessions"),
        ("cf50f36", "22 May", "style(bg): warm paper background (#FAF6EE) instead of tech-grey"),
        ("d1a30af", "22 May", "style(hero): dimensional hero illustration upgrade"),
        ("0eb5f2d", "22 May", "feat(hero): swap SVG illustration for AI-generated photoreal hero"),
        ("b0aa621", "22 May", "fix(hero): re-bake composite — brand mark was 63px outside sign"),
        ("681e50b", "22 May", "fix(hero): App.tsx returning-user header still pointed at deleted .svg"),
        ("7eaac63", "22 May", "feat(landing): promote hero photo to full-width banner"),
        ("bc65ef7", "22 May", "refactor(hero-bake): promote sign-bbox detection into the script"),
        ("a9bcb61", "22 May", "feat(hero): swap in higher-res Nano Banana photo (1152x928)"),
        ("28b5847", "22 May", "fix(i18n): localise countdown 'left' label + swap car-photo fixture"),
        ("298ed17", "22 May", "fix(screenshots): screenshot 07 was reading seeded fixture, not live"),
        ("0bf27cc", "22 May", "feat(bg): ship sage + topographic rings + corner aurora ('variant J')"),
        ("1aba9f9", "22 May", "style(bg): bump aurora from 500px to 2000px (4× linear)"),
        ("90ccae4", "22 May", "style(bg): dial aurora back from 4× to 2× (sweet spot)"),
        ("778bf28", "22 May", "style(bg): aurora to 3× — Goldilocks middle ground"),
        ("53a7604", "22 May", "feat(i18n): add Indonesian + Korean (7 → 9 languages)"),
        ("0756585", "22 May", "docs: final pre-launch consistency sweep — 9 languages, 7 days"),
        # Day 8
        ("deae35e", "23 May", "feat: two-app architecture — marketing landing at /, PWA at /app/"),
        ("4add63e", "23 May", "fix: route absolute-path assets through Vite base after /app/ cutover"),
        ("244db78", "23 May", "docs: capture two-app cutover gotchas in migration runbook"),
        ("860a2fe", "23 May", "docs(status): mark Web Push + two-app shipped, refresh canonical"),
        ("5e9e844", "23 May", "docs: file voice confirmation as considered-and-deferred"),
        # Day 9
        ("bfc3d24", "24 May", "docs+i18n: soften legal-promising language across all surfaces"),
        ("1a4eb51", "24 May", "docs: regenerate screenshots + PDFs after tamper-proof sweep"),
        ("d870c9a", "24 May", "fix(landing): drop EVIDENCE.PDF tab on Evidence section image"),
        ("39f6b33", "24 May", "fix(landing): swap PDF mockup's Sign photo from scanner to real sign"),
        ("411e536", "24 May", "docs: file offline / hybrid sign reading as considered-and-deferred"),
        ("9fa6ae6", "24 May", "feat(landing): public /verify/ page with openssl walkthrough"),
        ("5ebe6b3", "24 May", "feat(privacy): federated sign-in section in in-app privacy policy"),
        ("5fc42a3", "24 May", "fix(wiring): PEM at site root + /verify discoverability"),
        ("eaa3d16", "24 May", "feat(verify): multi-lingual /verify pages in all 9 locales"),
        ("b68b9cd", "24 May", "feat(verify): auto-detect chip on /verify/ + locale-aware link"),
        ("210a580", "24 May", "refactor(about): translated, contextual push-subscribe block"),
        ("d68cd07", "24 May", "fix(i18n): include querystring in detection chain"),
        ("c243877", "24 May", "fix(landing): pass ?lng= to chip target URL"),
        ("4c6bc4f", "24 May", "docs: file landing translation as considered-and-deferred"),
        ("5eda011", "24 May", "fix(pdf): render non-Latin scripts via self-hosted Noto Sans"),
        ("5e782ba", "24 May", "feat(lambda): pre-warm via EventBridge to kill cold-start"),
        ("0efe3d4", "24 May", "docs: add rollback playbook to CLAUDE.md"),
        ("6307c64", "24 May", "feat(seo): OG cards + canonical + robots/sitemap on landing"),
        ("732d584", "24 May", "feat(pwa): service worker update banner"),
        ("937958d", "24 May", "feat(ops): launch-day CloudWatch dashboard + 30-day log retention"),
        ("7706116", "24 May", "feat(reminders): scheduled-reminder visibility + per-session mgmt"),
        ("ce6005d", "24 May", "fix(reminders): preserve per-reminder body text across edits"),
        ("19cff0a", "24 May", "docs: refresh case study + README + lessons for launch readiness"),
        ("62146aa", "24 May", "feat(a11y): reduced-motion respect + OAuth callback splash"),
        ("c4e3e84", "24 May", "feat(polish): Tier 3 polish bundle — 5 self-contained launches"),
        # Day 10
        ("23c49c8", "25 May", "fix(auth): expose sign-in path for first-time visitors"),
        ("3083867", "25 May", "fix(auth): move sign-in CTA next to the primary scan button"),
        ("cbc886a", "25 May", "docs: regenerate screenshots to reflect today's UI changes"),
    ]

    rows = [["#", "Hash", "Date", "Message"]]
    for i, (h, d, m) in enumerate(all_commits, 1):
        rows.append([str(i), h, d, m])

    tbl = Table(rows, colWidths=[8 * mm, 22 * mm, 18 * mm, 122 * mm])
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("FONTNAME", (0, 0), (-1, 0), _FONT_BODY_BOLD),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("LEADING", (0, 0), (-1, -1), 10),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("FONTNAME", (1, 1), (1, -1), "Courier"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PAPER]),
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, PAPER_DARK),
            ]
        )
    )
    story.append(tbl)
    # No trailing "End of journal" block — the footer on every page already
    # carries the credit + date, and a one-line tail would otherwise spill
    # onto a near-empty page 13.

    # --- Doc setup ----------------------------------------------------------
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=22 * mm,
        title="ParkProof — Build Journal",
        author="ParkProof",
        subject="10-day build retrospective with decision-tree branches at every pivot",
    )
    doc.build(story, onFirstPage=_on_page, onLaterPages=_on_page)
    print(f"wrote {OUTPUT}  ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
