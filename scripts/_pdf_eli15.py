"""
One-off generator: docs/how-parkproof-was-built.pdf

ELI15 explanation of the ParkProof stack — for the project owner's personal
reading. Uses ReportLab Platypus with custom page template (brand-styled
footer + page numbers).
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

# ── Brand palette ─────────────────────────────────────────────────────────
BRAND = HexColor("#275BFF")
INK = HexColor("#1A2233")
INK_MUTED = HexColor("#4A5568")
PAPER = HexColor("#F2F4F7")
ACCENT = HexColor("#20C4C7")
CALLOUT_BG = HexColor("#EEF2FF")  # subtle brand-tinted
CALLOUT_BORDER = BRAND

OUTPUT = Path(
    r"C:\Users\molte\OneDrive\Claude Output\Product Manager Portfolio\ParkProof\docs\how-parkproof-was-built.pdf"
)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)


# ── Footer + page numbers ─────────────────────────────────────────────────
def draw_footer(canvas, doc):
    """Paint the footer + page number on every page."""
    canvas.saveState()
    page_w, _ = A4

    # Footer rule
    canvas.setStrokeColor(PAPER)
    canvas.setLineWidth(0.5)
    canvas.line(2 * cm, 1.6 * cm, page_w - 2 * cm, 1.6 * cm)

    # Left: attribution
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(INK_MUTED)
    canvas.drawString(2 * cm, 1.1 * cm, "ParkProof — built by Melroy D'Souza, 2026")

    # Right: page number
    page_num = canvas.getPageNumber()
    if page_num > 1:  # don't number the cover
        canvas.drawRightString(page_w - 2 * cm, 1.1 * cm, f"{page_num}")
    canvas.restoreState()


# ── Styles ─────────────────────────────────────────────────────────────────
base = getSampleStyleSheet()

styles = {
    "cover_title": ParagraphStyle(
        "cover_title",
        parent=base["Title"],
        fontName="Helvetica-Bold",
        fontSize=34,
        leading=42,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=8,
    ),
    "cover_sub": ParagraphStyle(
        "cover_sub",
        parent=base["Normal"],
        fontName="Helvetica",
        fontSize=14,
        leading=20,
        textColor=INK_MUTED,
        spaceAfter=24,
    ),
    "cover_kicker": ParagraphStyle(
        "cover_kicker",
        parent=base["Normal"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=14,
        textColor=BRAND,
        spaceAfter=8,
    ),
    "h1": ParagraphStyle(
        "h1",
        parent=base["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=22,
        leading=28,
        textColor=INK,
        spaceBefore=18,
        spaceAfter=10,
        keepWithNext=1,
    ),
    "h2": ParagraphStyle(
        "h2",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=20,
        textColor=BRAND,
        spaceBefore=12,
        spaceAfter=4,
        keepWithNext=1,
    ),
    "body": ParagraphStyle(
        "body",
        parent=base["BodyText"],
        fontName="Helvetica",
        fontSize=11,
        leading=17,
        textColor=INK,
        spaceAfter=8,
        alignment=TA_LEFT,
    ),
    "callout": ParagraphStyle(
        "callout",
        parent=base["BodyText"],
        fontName="Helvetica-Oblique",
        fontSize=10.5,
        leading=16,
        textColor=INK,
        leftIndent=4,
        rightIndent=4,
    ),
    "toc_h1": ParagraphStyle(
        "toc_h1",
        fontName="Helvetica-Bold",
        fontSize=11,
        leading=18,
        textColor=INK,
        spaceAfter=2,
    ),
    "tagline": ParagraphStyle(
        "tagline",
        fontName="Helvetica-Oblique",
        fontSize=10,
        leading=14,
        textColor=INK_MUTED,
        spaceAfter=4,
    ),
}


def heading(text: str, level: int = 1) -> Paragraph:
    """Heading that also emits a TOC entry."""
    style_key = "h1" if level == 1 else "h2"
    p = Paragraph(text, styles[style_key])
    # Tag for the TOC
    p.notify = lambda kind, info: None  # placeholder
    return p


# TOC headings carry level metadata. A custom BaseDocTemplate subclass picks
# them up in afterFlowable() and notifies the TableOfContents flowable.
class TOCHeading(Paragraph):
    def __init__(self, text, style_key, level=0):
        super().__init__(text, styles[style_key])
        self._toc_text = text
        self._toc_level = level


def h1(text: str) -> TOCHeading:
    return TOCHeading(text, "h1", level=0)


def h2(text: str) -> TOCHeading:
    return TOCHeading(text, "h2", level=1)


class ParkProofDocTemplate(BaseDocTemplate):
    """Subclass adds PDF sidebar bookmarks for each H1/H2."""

    def afterFlowable(self, flowable):
        if isinstance(flowable, TOCHeading):
            text = flowable._toc_text
            level = flowable._toc_level
            key = f"toc-{self.page}-{level}-{text[:24]}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=level)


def p(text: str) -> Paragraph:
    return Paragraph(text, styles["body"])


def callout(text: str) -> Table:
    """A subtle brand-tinted callout box for key takeaways."""
    inner = Paragraph(f"<b>Key takeaway —</b> {text}", styles["callout"])
    tbl = Table([[inner]], colWidths=[15.5 * cm])
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CALLOUT_BG),
                ("LINEBEFORE", (0, 0), (0, -1), 3, CALLOUT_BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return tbl


# ── Cover (drawn directly, not via the flow) ──────────────────────────────
def draw_cover(canvas, doc):
    """Custom cover page — full-page brand block + title."""
    page_w, page_h = A4
    canvas.saveState()

    # Brand bar on the left edge
    canvas.setFillColor(BRAND)
    canvas.rect(0, 0, 1.2 * cm, page_h, stroke=0, fill=1)

    # Kicker
    canvas.setFillColor(BRAND)
    canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(2.5 * cm, page_h - 4 * cm, "PARKPROOF · INTERNAL")

    # Title (multi-line, hand-positioned)
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 32)
    canvas.drawString(2.5 * cm, page_h - 7 * cm, "How ParkProof")
    canvas.drawString(2.5 * cm, page_h - 8.3 * cm, "was built")

    # Subtitle
    canvas.setFillColor(INK_MUTED)
    canvas.setFont("Helvetica", 14)
    canvas.drawString(
        2.5 * cm, page_h - 10 * cm, "The explanation — for me, in plain English."
    )

    # Tagline / context
    canvas.setFillColor(INK_MUTED)
    canvas.setFont("Helvetica-Oblique", 11)
    canvas.drawString(
        2.5 * cm,
        page_h - 11 * cm,
        "An ELI15 walk through the stack, the decisions, and the why.",
    )

    # Bottom decoration: three colored squares to nod at the brand
    swatch_y = 4.5 * cm
    swatch_size = 1.5 * cm
    canvas.setFillColor(BRAND)
    canvas.rect(2.5 * cm, swatch_y, swatch_size, swatch_size, stroke=0, fill=1)
    canvas.setFillColor(INK)
    canvas.rect(
        2.5 * cm + swatch_size + 0.4 * cm,
        swatch_y,
        swatch_size,
        swatch_size,
        stroke=0,
        fill=1,
    )
    canvas.setFillColor(ACCENT)
    canvas.rect(
        2.5 * cm + 2 * (swatch_size + 0.4 * cm),
        swatch_y,
        swatch_size,
        swatch_size,
        stroke=0,
        fill=1,
    )

    # Bottom-line meta
    canvas.setFillColor(INK_MUTED)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(
        2.5 * cm, 2.5 * cm, "ParkProof — built by Melroy D'Souza, 2026"
    )

    canvas.restoreState()


# ── Build the document ────────────────────────────────────────────────────
def build():
    doc = ParkProofDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=2.5 * cm,
        rightMargin=2.5 * cm,
        topMargin=2.5 * cm,
        bottomMargin=2.5 * cm,
        title="How ParkProof was built",
        author="Melroy D'Souza",
    )

    # The cover page has no flow — just custom paint.
    cover_frame = Frame(0, 0, A4[0], A4[1], showBoundary=0, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    body_frame = Frame(
        doc.leftMargin,
        doc.bottomMargin,
        doc.width,
        doc.height,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        showBoundary=0,
    )

    doc.addPageTemplates(
        [
            PageTemplate(id="cover", frames=cover_frame, onPage=draw_cover),
            PageTemplate(id="body", frames=body_frame, onPage=draw_footer),
        ]
    )

    # ── TOC ── (kept for reference; the actual TOC is hand-built in the story below)
    toc = None
    _unused_toc_styles = [
        ParagraphStyle(
            "toc_l0",
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=20,
            leftIndent=0,
            firstLineIndent=0,
            textColor=INK,
        ),
        ParagraphStyle(
            "toc_l1",
            fontName="Helvetica",
            fontSize=10,
            leading=16,
            leftIndent=16,
            firstLineIndent=0,
            textColor=INK_MUTED,
        ),
    ]

    story = []
    # Page 1: cover (paint only — push a frame break)
    story.append(Spacer(1, 1))  # nominal flowable
    story.append(PageBreak())

    # Page 2: switch to body template + hand-built TOC
    from reportlab.platypus.doctemplate import NextPageTemplate

    story.append(NextPageTemplate("body"))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Contents", styles["h1"]))
    story.append(Spacer(1, 10))

    toc_entries = [
        "1.  The big picture",
        "2.  The frontend - what runs in your browser",
        "3.  The backend - one Lambda function pretending to be 10 servers",
        "4.  The AI brain - how Claude actually reads the sign",
        "5.  Where the data lives",
        "6.  Cloud sync, auth, and the bouncer",
        "7.  Cryptographic evidence signing",
        "8.  Hosting the website",
        "9.  The polish - optimisations that make it feel finished",
        "10. The feedback loop - how I would know if it is working",
        "11. What it costs to run",
    ]
    toc_style = ParagraphStyle(
        "toc_entry",
        fontName="Helvetica",
        fontSize=12,
        leading=22,
        textColor=INK,
        spaceAfter=2,
    )
    for entry in toc_entries:
        story.append(Paragraph(entry, toc_style))
    story.append(Spacer(1, 18))
    story.append(
        Paragraph(
            "<i>Use the PDF sidebar bookmarks for one-tap jumps to any section.</i>",
            styles["tagline"],
        )
    )
    story.append(PageBreak())

    # ── §1 Big picture ────────────────────────────────────────────────────
    story.append(h1("1. The big picture"))
    story.append(
        p(
            "ParkProof is a website that pretends to be an app. You open it on your phone, "
            "you can <b>install it to the home screen with its own icon</b>, and from then on it "
            "behaves like a native app — full-screen, no browser address bar, offline-aware. "
            "The technical name for this is a <b>PWA</b>: a Progressive Web App."
        )
    )
    story.append(
        p(
            "Why a PWA and not a real iOS/Android app? Two reasons. "
            "First, you ship one codebase instead of three (iOS, Android, web), which matters a "
            "lot when you're solo. Second, you skip the Apple and Google app stores entirely — "
            "no $99/yr Apple developer fee, no two-week App Store review, no risk of being "
            "rejected for breaking some rule about parking signs. The downside is that a few "
            "things native apps get for free (background notifications, deep camera APIs) are "
            "harder or impossible in a PWA. ParkProof's whole feature set is chosen to live "
            "inside what a PWA can do."
        )
    )
    story.append(
        p(
            "The product is <b>mobile-first</b> because the user is literally standing next to a "
            "parking sign with one hand free. The entire home screen is one big blue button: "
            "<i>Scan a parking sign</i>. Everything else — history, settings, language picker — "
            "is one tap deeper."
        )
    )
    story.append(
        p(
            "What you experience: tap the button, the camera opens, you photograph the sign, "
            "an AI reads it, and ~8–12 seconds later you see a green or red card that says "
            "<i>You can park here · 1h 58m left</i> or <i>You cannot park here</i>. From there you "
            "can save the moment with a GPS-tagged car photo, set a calendar reminder, and "
            "later export the whole thing as a PDF you'd hand to a council in a dispute."
        )
    )
    story.append(
        callout(
            "ParkProof is a PWA because the alternative was building the same app three times "
            "and paying Apple to review each one. The mobile-first design is because the user "
            "is on a footpath, not a desk."
        )
    )
    story.append(PageBreak())

    # ── §2 Frontend ───────────────────────────────────────────────────────
    story.append(h1("2. The frontend - what runs in your browser"))
    story.append(
        p(
            "The visible part of ParkProof — every button, every screen, every animation — is "
            "written in <b>React</b> with <b>TypeScript</b>, styled with <b>Tailwind CSS v4</b>, "
            "and bundled by <b>Vite</b>. Four words; let's unpack each."
        )
    )
    story.append(h2("React"))
    story.append(
        p(
            "React is the library that lets you describe what the screen <i>should</i> look like "
            "given the current state of the app, and then it figures out the minimum number of "
            "DOM updates needed to get from where the screen is now to where you said it should "
            "be. Without React, you'd be writing &ldquo;find element X, change its text, also "
            "hide element Y, also&hellip;&rdquo; by hand for every interaction. React lets you "
            "write &ldquo;here's what this screen looks like when there are 5 saved sessions&rdquo; "
            "and lets the library handle the diffing."
        )
    )
    story.append(h2("TypeScript"))
    story.append(
        p(
            "TypeScript is JavaScript with a type system bolted on. You declare what shape your "
            "data is (<i>a ParkingSession has an arrived_at, a location, a sign_photo&hellip;</i>) "
            "and the compiler catches mismatches before they reach the browser. The cost: a "
            "build step and some extra typing. The benefit: roughly half of the bugs you would "
            "have shipped never exist."
        )
    )
    story.append(
        p(
            "<b>Why TypeScript over plain JavaScript?</b> Plain JS lets you write "
            "<code>session.locaiton.address</code> (typo!) and find out about it at 2am when a "
            "user reports the address is missing. TypeScript flags it the moment you type it. "
            "On a solo project where there's no one else to catch your mistakes, this is the "
            "single highest-leverage tool you can use."
        )
    )
    story.append(h2("Tailwind CSS v4"))
    story.append(
        p(
            "Tailwind is a CSS framework where instead of writing a stylesheet that says "
            "<i>.button { padding: 12px; background: blue; }</i>, you write the styles inline on "
            "the element as classes: <code>&lt;button className=&quot;p-3 bg-brand-500&quot;&gt;</code>. "
            "It feels backwards the first time you see it, but the benefits are real: no naming "
            "things (which is famously hard), no jumping between two files to find a style, "
            "and the final CSS bundle only contains the classes you actually used."
        )
    )
    story.append(
        p(
            "<b>Why Tailwind over CSS files?</b> Speed of iteration mostly. When the design is "
            "evolving — and a portfolio project's design evolves a lot — being able to change "
            "padding without renaming a CSS class or worrying about specificity is genuinely "
            "faster. The downside is the JSX gets visually noisy. I'd rather noisy and fast "
            "than tidy and slow."
        )
    )
    story.append(h2("Vite"))
    story.append(
        p(
            "Vite is the build tool — it turns the TypeScript + React + Tailwind source code "
            "into the JavaScript bundle the browser actually downloads. It's also the dev "
            "server that gives you instant hot-reload while you're working (save a file, see "
            "the change in your browser within ~50ms). It replaced the older Webpack/Create-"
            "React-App ecosystem in the early 2020s by being roughly 10× faster."
        )
    )
    story.append(
        callout(
            "Frontend in one sentence: React describes the UI, TypeScript catches the bugs, "
            "Tailwind styles it fast, Vite builds and serves it."
        )
    )
    story.append(PageBreak())

    # ── §3 Backend ────────────────────────────────────────────────────────
    story.append(h1("3. The backend - one Lambda function pretending to be 10 servers"))
    story.append(
        p(
            "Every time you tap &ldquo;Scan a parking sign&rdquo;, your phone sends a request "
            "to a server. Where does that server live, and what's running on it?"
        )
    )
    story.append(
        p(
            "ParkProof doesn't have a server in the traditional sense. There's no machine "
            "always running waiting for a request. Instead it uses <b>AWS Lambda</b>: when a "
            "request comes in, AWS spins up a tiny computing environment, runs your code, "
            "returns the response, and shuts it back down. You pay for milliseconds of "
            "compute used, not hours of a server being on. This is called <b>serverless</b> — "
            "a slightly misleading name (there ARE servers, you just don't manage them)."
        )
    )
    story.append(h2("Why one function for ten routes?"))
    story.append(
        p(
            "ParkProof has ten API routes — <code>/sign-translate</code>, <code>/draft-appeal</code>, "
            "<code>/sign-session</code>, <code>/feedback</code>, plus six more for the cloud-sync "
            "and account features. The natural instinct is to make each route its own Lambda. "
            "I made one Lambda handle all ten by dispatching on the URL path."
        )
    )
    story.append(
        p(
            "Why? <b>Cold starts.</b> Lambdas that haven't been called recently take ~1 second "
            "to start the first time. If you have ten Lambdas, you have ten potential cold "
            "starts. One Lambda means once it's warm, every route is fast. At ParkProof's "
            "traffic (~100 invocations a month), this is the difference between &ldquo;the first "
            "user every hour waits a second&rdquo; and &ldquo;most users get an instant response&rdquo;. "
            "At Google's traffic, you'd split them up. At ParkProof's traffic, one function is "
            "the right call."
        )
    )
    story.append(h2("API Gateway - the front door"))
    story.append(
        p(
            "Browsers can't call Lambda directly. <b>API Gateway</b> sits in front of Lambda "
            "and gives you a stable URL (<code>https://tlsmpbft4f.execute-api.ap-southeast-2.amazonaws.com/...</code>) "
            "that handles HTTPS, CORS, request validation, rate limiting, and authentication. "
            "Think of it as the building's front desk: it accepts deliveries, checks IDs for "
            "the floors that require them, and forwards everything to the right office inside."
        )
    )
    story.append(
        p(
            "Six of the ten routes (the cloud-sync ones) are gated by a <b>JWT authorizer</b> "
            "configured at the API Gateway level. That means API Gateway checks the user's "
            "token <i>before</i> the request ever reaches Lambda. If your token is missing or "
            "expired, you get a 401 and we don't burn compute on you. The other four routes "
            "(sign-translate, draft-appeal, sign-session, feedback) are anonymous — anyone "
            "can call them."
        )
    )
    story.append(
        callout(
            "One Lambda handling all the routes is right for this scale. It would be wrong for "
            "a high-traffic product (you'd want isolation), and it would be wrong for a multi-"
            "team org (you'd want ownership boundaries). At one developer, one user, one "
            "domain — it's perfect."
        )
    )
    story.append(PageBreak())

    # ── §4 The AI brain ───────────────────────────────────────────────────
    story.append(h1("4. The AI brain - how Claude actually reads the sign"))
    story.append(
        p(
            "When you photograph a parking sign, the Lambda function takes that image, packs "
            "it into a request, and sends it to Anthropic's API. The model on the other end "
            "is <b>Claude Sonnet 4.6</b>. A few things make this work."
        )
    )
    story.append(h2("Vision"))
    story.append(
        p(
            "Sonnet 4.6 is a <b>multimodal</b> model — it can take images as input, not just "
            "text. We send the image as a base64-encoded string alongside the system prompt "
            "(a long set of instructions about how to read Australian parking signs) and a "
            "small bit of context (the current time, the user's GPS coords resolved to a "
            "timezone). The model returns a structured JSON response with the rules it saw, "
            "whether you can park right now, and when you'd have to leave by."
        )
    )
    story.append(h2("Adaptive thinking"))
    story.append(
        p(
            "Parking signs in Melbourne CBD are nasty. A typical inner-city pole has three "
            "signs stacked: maybe <i>2P 8am–6pm Mon–Fri</i> on top, <i>1/4P 8am–6pm Mon–Fri</i> "
            "in the middle, <i>Permit Zone 8am–11pm Sat–Sun</i> at the bottom. The model has to "
            "compute the &ldquo;leave-by&rdquo; time for <i>each</i> rule, then pick the earliest "
            "one — because that's the one that catches you first."
        )
    )
    story.append(
        p(
            "This is multi-step reasoning, and it goes wrong without dedicated &ldquo;thinking&rdquo; "
            "time. Sonnet 4.6 supports <b>adaptive thinking</b> — the model decides how much "
            "internal reasoning to do before answering, and that thinking happens in its own "
            "private scratchpad before the final response. We tell it <code>thinking: { type: "
            "'adaptive' }</code> and let it pick. The result is correct math on stacked signs."
        )
    )
    story.append(
        p(
            "I tried the cheaper, faster Haiku 4.5 model. It doesn't support adaptive thinking "
            "at all. Without it, Haiku consistently picked the <i>latest</i> leave-by time "
            "instead of the earliest — exactly backwards. Sonnet 4.6 is the floor for this "
            "task; cheaper is not an option."
        )
    )
    story.append(h2("JSON schema enforcement"))
    story.append(
        p(
            "Asking an AI for &ldquo;structured output&rdquo; used to be a roll of the dice — "
            "you'd write a prompt saying &ldquo;return JSON like this&rdquo; and the model "
            "would mostly comply, occasionally returning markdown or a bonus sentence of "
            "explanation that broke your parser. Sonnet 4.6 lets you specify the exact JSON "
            "shape as a schema, and the model is <i>guaranteed</i> to return JSON matching it. "
            "No more parsing failures, no more &ldquo;I hope it remembered to escape the quotes&rdquo;."
        )
    )
    story.append(h2("Smart re-scan - text-only mode"))
    story.append(
        p(
            "Here's the optimisation I'm proudest of. If you parked at the same spot 6 hours "
            "ago and you're back now, ParkProof doesn't need to re-read the sign — the rules "
            "haven't changed. The signage is still the same physical object. What's changed "
            "is the time."
        )
    )
    story.append(
        p(
            "So instead of sending the photo again, the Lambda sends Claude only the rules "
            "text from the prior reading, plus the current time, and asks: &ldquo;Given these "
            "rules, can the user park right now, and until when?&rdquo; This is text-only, "
            "shorter, and skips the vision pipeline entirely. The result: <b>~3× faster and "
            "~4× cheaper</b> per re-scan."
        )
    )
    story.append(
        p(
            "The trigger is automatic: when you tap &ldquo;Scan a parking sign&rdquo; near a "
            "spot you've scanned in the last 7 days (within 40 metres), you see a "
            "&ldquo;You scanned this spot before — reuse the reading?&rdquo; card. Tap it, "
            "and the refresh runs."
        )
    )
    story.append(
        callout(
            "The AI brain is Sonnet 4.6 with adaptive thinking and JSON-schema output. "
            "Don't downgrade. Don't change the schema. Don't remove the worked examples in "
            "the system prompt — they were added after a regression where the model picked "
            "the wrong leave-by time."
        )
    )
    story.append(PageBreak())

    # ── §5 Data storage ───────────────────────────────────────────────────
    story.append(h1("5. Where the data lives"))
    story.append(
        p(
            "ParkProof stores user data in three different places, picked for what kind of "
            "data it is and how durable it needs to be."
        )
    )
    story.append(h2("localStorage - on your phone"))
    story.append(
        p(
            "Every browser has a small key/value storage that survives page reloads but never "
            "leaves the device. It holds ~5MB per origin. ParkProof writes all your saved "
            "sessions to localStorage <i>first</i>, before anything else happens. That means "
            "everything works offline: scan a sign with no signal, save the session, set a "
            "reminder — all of it works on local storage alone."
        )
    )
    story.append(
        p(
            "The cost of localStorage is the 5MB ceiling. Photos eat that fast. ParkProof "
            "resizes every photo down to 1200px on the longest edge and re-encodes as 82%-"
            "quality JPEG before it touches storage — turning a 5MB raw phone photo into a "
            "~200KB stored one. There's also a 3-phase auto-recovery: if storage hits the "
            "ceiling, the app strips car photos from expired sessions first, then sign photos, "
            "then evicts whole expired sessions. Active sessions are never touched."
        )
    )
    story.append(h2("DynamoDB - the cabinet in AWS"))
    story.append(
        p(
            "If you sign in (optional), the same sessions get mirrored to <b>DynamoDB</b>, "
            "AWS's managed NoSQL database. Think of it as a giant filing cabinet that AWS "
            "operates for you — you don't run the database server, you just send "
            "&ldquo;store this&rdquo; and &ldquo;read all rows where userId = X&rdquo; requests "
            "to its API."
        )
    )
    story.append(
        p(
            "ParkProof uses one table, <code>parkproof-sessions</code>, with two keys: "
            "<code>userId</code> as the partition key (which user) and <code>sessionId</code> "
            "as the sort key (which session). That structure means listing one user's sessions "
            "is a single, fast query — DynamoDB knows exactly which physical disk to look at."
        )
    )
    story.append(h2("S3 - the warehouse for photos"))
    story.append(
        p(
            "Photos don't go into DynamoDB (it's expensive to store binary blobs there). They "
            "go into <b>S3</b>, AWS's object storage — basically a giant warehouse where you "
            "can stash files of any size, organised by &ldquo;buckets&rdquo; (top-level "
            "containers) and &ldquo;keys&rdquo; (paths inside the bucket)."
        )
    )
    story.append(
        p(
            "ParkProof has two buckets: <code>parkproof-app-...</code> for the static website "
            "files (what CloudFront serves to your browser) and <code>parkproof-evidence-...</code> "
            "for user-uploaded photos. The evidence bucket organises photos under per-user "
            "prefixes (<code>{userId}/sessions/{sessionId}/sign.jpg</code>) so each user's "
            "files are cleanly partitioned."
        )
    )
    story.append(h2("Why local-first?"))
    story.append(
        p(
            "The natural SaaS instinct is &ldquo;require sign-up so you can build a user "
            "funnel&rdquo;. I deliberately did the opposite. A user who's just been screwed by "
            "a parking ticket is in <i>no mood</i> to create an account, verify an email, and "
            "agree to a privacy policy before they can translate a sign. Anonymous, local-"
            "first means there's zero friction tax on first use. The cloud sync (DynamoDB + S3) "
            "is a bonus you opt into when you want cross-device durability."
        )
    )
    story.append(
        callout(
            "Local-first is the default; cloud is the opt-in. The local copy is the source of "
            "truth — the cloud is just durability insurance."
        )
    )
    story.append(PageBreak())

    # ── §6 Auth & the bouncer ─────────────────────────────────────────────
    story.append(h1("6. Cloud sync, auth, and the bouncer"))
    story.append(
        p(
            "When you opt into cloud sync, ParkProof needs to know who you are without "
            "trusting your browser to just declare it. That's what <b>Amazon Cognito</b> does."
        )
    )
    story.append(h2("Cognito - the identity service"))
    story.append(
        p(
            "Cognito is AWS's managed user identity service. It handles the boring, dangerous "
            "stuff: password hashing, email verification, password reset, login throttling. "
            "ParkProof has one <b>User Pool</b> (a directory of users) plus a <b>Hosted UI</b> "
            "domain that handles the OAuth dance with Apple and Google when users choose "
            "&ldquo;Continue with Apple&rdquo; or &ldquo;Continue with Google&rdquo; instead of "
            "creating an email/password account."
        )
    )
    story.append(h2("JWT - the wristband"))
    story.append(
        p(
            "When you sign in, Cognito gives your browser three tokens: an <b>idToken</b>, an "
            "<b>accessToken</b>, and a <b>refreshToken</b>. The first two are <b>JWTs</b> — "
            "JSON Web Tokens — which are essentially signed JSON blobs that say &ldquo;this "
            "user is who they claim to be, here's their userId, this token is valid for the "
            "next hour&rdquo;. Cognito signs them with a private key only it has, so nobody "
            "can forge one."
        )
    )
    story.append(
        p(
            "Think of a JWT as a festival wristband. You got it at the entrance after showing "
            "your ID. Every time you want to go into a specific tent, the staff at the door "
            "just looks at the wristband — they don't need to call dispatch to re-verify you. "
            "The cryptographic signature is what makes the wristband impossible to fake."
        )
    )
    story.append(h2("The bouncer - API Gateway authorizer"))
    story.append(
        p(
            "Six of ParkProof's ten API routes are auth-gated. On each request to those "
            "routes, your browser attaches the JWT as an <code>Authorization: Bearer ...</code> "
            "header. <b>API Gateway's JWT authorizer</b> intercepts the request before it "
            "reaches Lambda, verifies the signature against Cognito's public key, checks the "
            "expiry, and (if valid) puts the user's <code>sub</code> claim (their unique ID) "
            "onto the request as metadata. Lambda then reads that <code>sub</code> and only "
            "returns data belonging to that user."
        )
    )
    story.append(
        p(
            "If the token is bad — missing, expired, signature mismatch — API Gateway returns "
            "a 401 directly without ever invoking Lambda. You don't pay compute time for "
            "rejecting unauthorised requests."
        )
    )
    story.append(h2("Federation - let people use existing IDs"))
    story.append(
        p(
            "Most users don't want yet another email/password to remember. Cognito Hosted UI "
            "supports OAuth federation with Apple and Google, which means &ldquo;Continue with "
            "Apple&rdquo; on the ParkProof sign-in screen redirects you to Apple's login page, "
            "you authenticate there (Face ID on iPhone, usually), and Apple sends you back to "
            "ParkProof with a token Cognito accepts. ParkProof never sees your Apple password "
            "and Apple never sees your ParkProof activity — Cognito is the trusted broker."
        )
    )
    story.append(
        callout(
            "Cognito holds identities, API Gateway checks tokens, Lambda only ever sees "
            "verified user IDs. Apple and Google federation means most users never have to "
            "create yet another password."
        )
    )
    story.append(PageBreak())

    # ── §7 Crypto signing ─────────────────────────────────────────────────
    story.append(h1("7. Cryptographic evidence signing"))
    story.append(
        p(
            "Here's the bit of ParkProof that gets the most &ldquo;you did <i>what?</i>&rdquo; "
            "reactions when I explain it. Every saved session is signed by an AWS-held key, "
            "so years from now someone can verify that the evidence record hasn't been "
            "tampered with."
        )
    )
    story.append(h2("Why signing, not just hashing?"))
    story.append(
        p(
            "If you just <b>hash</b> the photo (compute SHA-256), you can later show the same "
            "photo produces the same hash — but the user could have altered the photo right "
            "after saving and re-hashed it. The hash on its own proves nothing about <i>when</i> "
            "the photo existed in that form."
        )
    )
    story.append(
        p(
            "A <b>signature</b> is different. It's a hash that's been encrypted with a private "
            "key the user does not have access to. Anyone can verify the signature using the "
            "matching public key (which we publish openly), but only the holder of the private "
            "key could have produced it. So if you can verify a signature, you know: (a) the "
            "data hasn't changed since it was signed, AND (b) someone with access to the "
            "private key produced this signature at some point. The signed metadata includes "
            "a timestamp, so &ldquo;at some point&rdquo; becomes &ldquo;at this specific moment&rdquo;."
        )
    )
    story.append(h2("KMS - the notary"))
    story.append(
        p(
            "AWS <b>KMS</b> (Key Management Service) holds the private key. The key never "
            "leaves AWS — there's no API to download it, ever. The only thing you can ask KMS "
            "to do is &ldquo;please sign this blob with the private key and return me the "
            "signature&rdquo;. It's like having a notary public who'll stamp your documents "
            "but won't lend you their stamp."
        )
    )
    story.append(
        p(
            "ParkProof's key is <b>ECDSA P-256</b> (Elliptic Curve Digital Signature Algorithm, "
            "256-bit curve). It's an asymmetric algorithm — there are two keys, one for signing "
            "(private, held by KMS) and one for verifying (public, shipped at <code>/parkproof-"
            "public-key.pem</code> on the website). Anyone can download the public key and "
            "verify any signature ever produced by the private key."
        )
    )
    story.append(h2("The PDF appendix"))
    story.append(
        p(
            "When you export a session as an evidence PDF, the last page is an &ldquo;Evidence "
            "verification&rdquo; appendix. It includes the raw signature bytes (base64), the "
            "canonical data that was signed (timestamps, GPS, photo SHA-256 hashes), and a "
            "one-paragraph walkthrough showing exactly how to verify it with <code>openssl "
            "dgst -verify</code> against the public key. A council, court, or insurer can "
            "verify the evidence chain without ParkProof being in the loop. <i>That's</i> the "
            "real differentiator: not the AI, not the GPS — the verifiability."
        )
    )
    story.append(
        callout(
            "A hash proves &ldquo;these bytes match&rdquo;. A signature proves &ldquo;these "
            "bytes existed in this exact form at this specific moment, witnessed by someone "
            "with the private key&rdquo;. ParkProof signs everything important."
        )
    )
    story.append(PageBreak())

    # ── §8 Hosting ────────────────────────────────────────────────────────
    story.append(h1("8. Hosting the website"))
    story.append(
        p(
            "How does <code>www.parkproof.com.au</code> serve files to a phone in Melbourne "
            "(or anywhere else) fast and cheaply? Four moving parts."
        )
    )
    story.append(h2("S3 - the warehouse"))
    story.append(
        p(
            "The static website (HTML, JS bundles, CSS, icons, the parking-sign images, the "
            "OG card) lives in an S3 bucket called <code>parkproof-app-...</code>. S3 is "
            "cheap, durable, and infinitely scalable, but it's not optimised for low-latency "
            "delivery — a fetch from S3 in Sydney to a phone in Perth is fine, but to a phone "
            "in London it'd be sluggish."
        )
    )
    story.append(h2("CloudFront - the worldwide delivery network"))
    story.append(
        p(
            "<b>CloudFront</b> is AWS's CDN — Content Delivery Network. It has ~400 edge "
            "locations around the world, each of which caches a copy of your website's "
            "files. When someone in London visits the site, CloudFront serves them from its "
            "London edge — no round-trip to Sydney needed. When someone in Melbourne visits, "
            "they get served from <code>MEL51-P2</code>, an edge POP about 5km from the CBD."
        )
    )
    story.append(
        p(
            "Edge locations only pull from S3 on cache miss. After the first request to each "
            "asset, subsequent requests in that region are served from the edge cache. That "
            "means S3 sees maybe a few hundred requests per month even at moderate traffic. "
            "It also means an invalidation step at deploy time — &ldquo;forget the old version, "
            "fetch the new one&rdquo;."
        )
    )
    story.append(h2("OAC - the rule &ldquo;only CloudFront can pull&rdquo;"))
    story.append(
        p(
            "The S3 bucket is <i>private</i> — direct requests to it are rejected. The only "
            "thing allowed to pull from it is CloudFront, via a configuration called "
            "<b>Origin Access Control</b> (OAC). This is a security best-practice: it stops "
            "anyone from bypassing CloudFront and hitting S3 directly (which would skip the "
            "edge caching and could rack up egress bills if abused)."
        )
    )
    story.append(h2("ACM + DNS - the custom domain"))
    story.append(
        p(
            "By default, CloudFront gives you a URL like <code>d1jmpu2roekssu.cloudfront.net</code>. "
            "Functional, ugly. To use <code>www.parkproof.com.au</code> instead, you need "
            "two things: an SSL certificate for that domain (free from AWS Certificate "
            "Manager, <b>ACM</b>) and a DNS CNAME record at Cloudflare pointing "
            "<code>www.parkproof.com.au</code> &rarr; <code>d1jmpu2roekssu.cloudfront.net</code>. "
            "The apex <code>parkproof.com.au</code> (and both forms of <code>parkproof.au</code>) "
            "301-redirect to the canonical via Cloudflare Page Rules."
        )
    )
    story.append(
        p(
            "<i>(One memorable diversion: Network Solutions, where the domain is registered, "
            "has a wildcard A record on all subdomains pointing to their &ldquo;under "
            "construction&rdquo; parking page. Even after adding the CNAME, browsers kept "
            "hitting the parking page because the wildcard A was beating the explicit CNAME "
            "in their DNS responses. Fixed by deleting the wildcard. Total time to debug: "
            "longer than the actual implementation.)</i>"
        )
    )
    story.append(
        callout(
            "S3 stores it, CloudFront delivers it worldwide, OAC keeps S3 private, ACM + DNS "
            "give it a real domain name. The whole hosting stack runs at well under $1/month."
        )
    )
    story.append(PageBreak())

    # ── §9 Optimisations ──────────────────────────────────────────────────
    story.append(h1("9. The polish - optimisations that make it feel finished"))
    story.append(
        p(
            "A handful of small things, each of which would be invisible if it weren't there "
            "but together account for the &ldquo;this feels like a real app&rdquo; impression."
        )
    )
    story.append(h2("Photo resize"))
    story.append(
        p(
            "Every photo gets canvas-resized to 1200px on the longest edge and re-encoded as "
            "82%-quality JPEG before it ever hits storage or the API. A 5MB phone photo "
            "becomes ~200KB. The visible quality difference is none; the storage and API-"
            "payload savings are 25×."
        )
    )
    story.append(h2("localStorage quota recovery"))
    story.append(
        p(
            "If localStorage hits its 5MB ceiling, a 3-phase recovery runs against expired "
            "sessions only: <b>Phase 1</b> strip the car photos, <b>Phase 2</b> strip the sign "
            "photos, <b>Phase 3</b> evict the whole session record. Active sessions (and "
            "anything signed) are never touched. Without this, a heavy user would hit the "
            "<code>QuotaExceededError</code> within 1–2 sessions and the save flow would "
            "silently break."
        )
    )
    story.append(h2("i18n - 7 languages"))
    story.append(
        p(
            "The whole UI is internationalised via <code>react-i18next</code>, with 7 language "
            "packs: English, Mandarin, Vietnamese, Italian, Greek, Hindi, Punjabi. The list "
            "wasn't arbitrary — it's the top non-English languages spoken at home in the City "
            "of Melbourne LGA per the 2021 Census. The model output (the rules text) stays in "
            "English because that's what's literally on the sign; everything around it "
            "translates."
        )
    )
    story.append(h2("PWA install"))
    story.append(
        p(
            "Two files do most of the PWA work: a <code>manifest.webmanifest</code> (tells "
            "the browser the app's name, icon, theme colour, and start URL when installed) "
            "and a <code>service-worker.js</code> (a tiny script that runs even when the tab "
            "is closed, handling offline caching). The Vite PWA plugin generates both from "
            "configuration. The Apple touch icon and various Android icon sizes are auto-"
            "generated from a single source SVG."
        )
    )
    story.append(h2("Code-splitting"))
    story.append(
        p(
            "Heavy libraries (jsPDF for evidence export, ics for calendar generation, "
            "html2canvas for the PDF photo overlay, DOMPurify for sanitising AI letter "
            "output) are <b>lazy-loaded</b> — they only download when the user actually "
            "triggers the relevant feature. Result: the main bundle stays at ~225KB gzipped, "
            "fast on a 3G connection. Without code-splitting, the bundle would be 600KB+ and "
            "the first paint would noticeably stutter."
        )
    )
    story.append(
        callout(
            "Each of these is small in isolation. Together they're the difference between "
            "&ldquo;a developer wrote this&rdquo; and &ldquo;a product team shipped this&rdquo;."
        )
    )
    story.append(PageBreak())

    # ── §10 Feedback loop ─────────────────────────────────────────────────
    story.append(h1("10. The feedback loop - how I'd know if it's working"))
    story.append(
        p(
            "This is the part of the build I'm most proud of from a PM perspective, even "
            "though no real user has ever fired it. After each AI translation, the user sees "
            "two buttons: <i>&ldquo;Yes, looks right&rdquo;</i> and <i>&ldquo;Retake photo&rdquo;</i>. "
            "Tapping either sends a small JSON event to AWS CloudWatch Logs."
        )
    )
    story.append(h2("Layer 1 - verdict counts"))
    story.append(
        p(
            "The simplest version. Each event includes a verdict (<code>correct</code> or "
            "<code>retake</code>) and a UUID. Aggregated across all users, this gives you a "
            "single number: <i>the percentage of translations users actually trusted</i>. If "
            "it's 95%, the model is generally right. If it drops to 70%, something's broken."
        )
    )
    story.append(h2("Layer 2 - verdict + context"))
    story.append(
        p(
            "Layer 1 tells you <i>if</i> there's a problem. Layer 2 tells you <i>what kind</i>. "
            "Each event now also carries: the model's stated confidence (low/medium/high), "
            "whether the clarification step fired (i.e. was this a multi-variant sign?), the "
            "local hour of day, a 120-character excerpt of the rules text, and a flag for "
            "whether it was a smart re-scan (text-only refresh) or a fresh vision call."
        )
    )
    story.append(
        p(
            "With Layer 2 in place, you can slice the failure modes in <b>CloudWatch Logs "
            "Insights</b> (AWS's query tool for log data) and ask questions like:"
        )
    )
    story.append(
        p(
            "&bull; <i>&ldquo;Of all retake verdicts, what's the model's confidence distribution?&rdquo;</i> "
            "If retakes correlate with low confidence, the model is well-calibrated. If they "
            "correlate with <i>high</i> confidence, that's a prompt regression and I need to "
            "look immediately."
        )
    )
    story.append(
        p(
            "&bull; <i>&ldquo;Does retake rate spike at certain hours of day?&rdquo;</i> A retake "
            "spike at 8pm+ is a photo-quality issue (dim light), not a model issue."
        )
    )
    story.append(
        p(
            "&bull; <i>&ldquo;Are multi-variant signs (clarification = true) more error-prone "
            "than single signs?&rdquo;</i> If yes, that's where prompt work should focus."
        )
    )
    story.append(h2("Why this is the part most projects skip"))
    story.append(
        p(
            "Most AI features ship without a feedback loop at all. The team ships the model, "
            "the model degrades silently as the data drifts, and nobody knows until users "
            "start churning. Building the telemetry <i>before</i> there are users is exactly "
            "the wrong-feeling order — it's instinct to wait until you have real traffic. But "
            "the moment you have real traffic, you also have urgency, and the telemetry never "
            "gets built. Layer 1 + Layer 2 are five days of work that pay back tenfold the "
            "first time a regression silently lands."
        )
    )
    story.append(
        callout(
            "Telemetry is the part where the discipline of building the unsexy thing first "
            "compounds. Layer 1 alone is what most projects skip. Layer 2 is what separates "
            "&ldquo;we built an AI feature&rdquo; from &ldquo;we operate an AI feature&rdquo;."
        )
    )
    story.append(PageBreak())

    # ── §11 Cost ──────────────────────────────────────────────────────────
    story.append(h1("11. What it costs to run"))
    story.append(
        p(
            "At portfolio traffic (~100 visits per month, ~30 sign-translate calls, ~5 appeal "
            "drafts), ParkProof costs <b>~$5–7 per month</b>. Where does that go?"
        )
    )
    story.append(h2("The fixed costs (~$4–5/month)"))
    story.append(
        p(
            "&bull; <b>KMS asymmetric key — $1.00/month</b>. AWS charges this whether the key "
            "is used or not. It's the fee for keeping a customer-managed cryptographic key in "
            "their vault. The signing operations themselves are essentially free at our "
            "volume."
        )
    )
    story.append(
        p(
            "&bull; <b>Domain renewal — $3–4/month amortised</b>. <code>.tech</code> domains at "
            "Network Solutions renew ~$40–50/year. The only non-AWS fixed cost."
        )
    )
    story.append(h2("The usage costs (~$1–3/month at portfolio traffic)"))
    story.append(
        p(
            "&bull; <b>Anthropic API — $1.50–3/month</b>. About $0.05 per fresh sign translate "
            "(image-bearing call to Claude Sonnet 4.6), about $0.01 per refresh (text-only "
            "smart re-scan), about $0.06 per appeal draft. The image-bearing calls dominate."
        )
    )
    story.append(h2("Effectively free under AWS tiers"))
    story.append(
        p(
            "&bull; Lambda — well under the 1 million-requests/month always-free tier."
        )
    )
    story.append(
        p(
            "&bull; API Gateway HTTP — pennies at this volume even past the 12-month free tier."
        )
    )
    story.append(p("&bull; CloudFront — under the 1TB/month free transfer cap."))
    story.append(
        p("&bull; S3 — both buckets store <10MB, well under free-tier thresholds.")
    )
    story.append(p("&bull; DynamoDB — on-demand at our volume is effectively free."))
    story.append(p("&bull; Cognito — 50,000 monthly active users free forever."))
    story.append(p("&bull; CloudWatch Logs — under 1MB ingested per month."))
    story.append(p("&bull; ACM cert — free."))
    story.append(h2("The Budgets alarm"))
    story.append(
        p(
            "An <b>AWS Budgets alarm</b> is set at $10/month, emailing me if total spend "
            "trends to exceed that. It's the safety net for the &ldquo;a tech blog picked it "
            "up and 10,000 strangers are now scanning signs&rdquo; scenario, where the "
            "Anthropic costs would balloon to ~$500 in a day. The AWS surface itself scales "
            "gracefully — even at 1000× traffic, AWS stays under $20/month. Anthropic is the "
            "uncapped variable."
        )
    )
    story.append(
        callout(
            "Two costs dominate: KMS ($1) and the domain (~$4 amortised). Everything else is "
            "effectively free at portfolio scale. The $10/month budget alarm exists to catch "
            "the one scenario where a viral moment turns into a $500 Anthropic bill."
        )
    )

    # Final coda
    story.append(Spacer(1, 12))
    story.append(
        Paragraph(
            "<i>That's the whole stack. Eleven layers, each picked for a specific reason, "
            "each documented somewhere in the repo so you can re-read it in a year and "
            "remember why it's there. The discipline of writing it down is the same "
            "discipline that made the build possible: do the unsexy thing first, defer "
            "explicitly, and let the trade-offs be visible.</i>",
            styles["body"],
        )
    )

    # Build (multi-pass for the TOC to know real page numbers)
    doc.multiBuild(story)
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    build()
