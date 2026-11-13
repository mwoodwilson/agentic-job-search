#!/usr/bin/env python3
"""Builds the README poster: docs/assets/workflow-poster.svg (the source), the HTML page that previews it, and
workflow-poster.png (the image the README shows, made by opening the page in Chrome without a window).
Run it with:  python3 -I docs/assets/make-poster.py          (add --no-png to skip the PNG)
Transit-map metaphor: the hourly run is the blue line, the fact-check loop is red, the agents are green,
and station shapes say who does each step (code, a Claude skill, an agent, or you).
When tests are added or removed, update TESTS below to the number `node --test` prints."""
import glob
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.sax.saxutils import escape as esc

TESTS = 462   # from `node --test`
EVALS = 5     # the fact-checker cases in evals/

OUT = Path(__file__).resolve().parent
W = 1600
C = dict(paper="#F2F4F1", card="#FFFFFF", ink="#14202B", muted="#56636D", rule="#D5DBD6",
         blue="#2457D6", red="#C9372C", amber="#D9822B", green="#1C8C5E")
# System fonts only, so the poster looks the same on any Mac and loads nothing from the web.
DISPLAY = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif"
MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

y1, y2, y3 = 480, 830, 1180
svg = []
add = svg.append

def text(x, y, s, size=18, weight=400, fill=C["ink"], anchor="middle", family=DISPLAY, spacing=0, halo=None):
    ls = f' letter-spacing="{spacing}"' if spacing else ""
    hl = f' stroke="{halo}" stroke-width="6" stroke-linejoin="round" paint-order="stroke"' if halo else ""
    add(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{ls}{hl}>{esc(s)}</text>')

def label(x, y, title, sub, anchor="middle"):
    text(x, y, title, 22, 700, anchor=anchor, halo=C["paper"])
    for i, line in enumerate(sub):
        text(x, y + 25 + i * 21, line, 16.5, 400, C["muted"], anchor=anchor, halo=C["paper"])

def station(x, y, kind, color=None):
    color = color or C["blue"]
    if kind == "code":
        add(f'<rect x="{x-17}" y="{y-17}" width="34" height="34" rx="5" fill="{C["card"]}" stroke="{color}" stroke-width="6"/>')
    elif kind == "claude":
        add(f'<circle cx="{x}" cy="{y}" r="19" fill="{C["card"]}" stroke="{C["amber"]}" stroke-width="7"/>')
        add(f'<circle cx="{x}" cy="{y}" r="6" fill="{C["amber"]}"/>')
    elif kind == "agent":
        add(f'<circle cx="{x}" cy="{y}" r="15" fill="{C["card"]}" stroke="{C["green"]}" stroke-width="6"/>')
    elif kind == "you":
        add(f'<circle cx="{x}" cy="{y}" r="22" fill="{C["ink"]}"/>')
        add(f'<circle cx="{x}" cy="{y}" r="12" fill="{C["card"]}"/>')

def pill(x, y, s="MAC ONLY"):
    """A small tag under a label: this step uses a Mac-only app."""
    w = int(len(s) * 8.4 + 22)
    add(f'<rect x="{x-w/2}" y="{y}" width="{w}" height="22" rx="11" fill="{C["card"]}" stroke="{C["ink"]}" stroke-width="1.5"/>')
    text(x, y + 15.5, s, 12, 500, C["ink"], "middle", MONO, 1)

# ---------- background and header ----------
text(100, 108, "AGENTIC JOB SEARCH  ·  BUILT WITH CLAUDE CODE", 17, 500, C["green"], "start", MONO, 2)
text(100, 190, "A job search that runs itself, and never lies for you.", 58, 800, anchor="start")
for i, line in enumerate([
    "Every hour it finds new roles, writes a resume for each one from your own experience, and fact-checks",
    "every line against your files. Notifications stay off until you want them. Agents only propose changes.",
]):
    text(100, 248 + i * 34, line, 24, 400, C["muted"], "start")

# ---------- the blue line (the hourly run) ----------
add(f'<path d="M 200 {y1} H 1080 Q 1140 {y1} 1140 {y1+60} V {y2-60} Q 1140 {y2} 1080 {y2} H 140 '
    f'Q 80 {y2} 80 {y2+60} V {y3-60} Q 80 {y3} 140 {y3} H 740" fill="none" stroke="{C["blue"]}" '
    f'stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>')

# ---------- the red loop (writer <-> fact-check) and the held spur ----------
add(f'<defs><marker id="arrowRed" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">'
    f'<path d="M0,0 L10,5 L0,10 z" fill="{C["red"]}"/></marker>'
    f'<marker id="arrowGreen" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">'
    f'<path d="M0,0 L10,5 L0,10 z" fill="{C["green"]}"/></marker>'
    f'<marker id="arrowInk" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">'
    f'<path d="M0,0 L10,5 L0,10 z" fill="{C["ink"]}"/></marker></defs>')
add(f'<path d="M 470 {y2-28} C 470 {y2-165}, 1010 {y2-165}, 1010 {y2-34}" fill="none" stroke="{C["red"]}" '
    f'stroke-width="7" stroke-dasharray="2 13" stroke-linecap="round" marker-end="url(#arrowRed)"/>')
text(740, y2 - 146, "a problem? back to the writer to revise · up to 3 tries", 17, 500, C["red"])
add(f'<path d="M 470 {y2+24} V {y2+150}" stroke="{C["red"]}" stroke-width="7" stroke-linecap="round"/>')

# ---------- stations on the hourly run ----------
row1 = [(200, "code", "Every hour", ["launchd starts the run", "on your Mac"]),
        (470, "code", "Pull job boards", ["Greenhouse · Lever · Ashby", "Gem · Workday"]),
        (740, "code", "Filter and dedupe", ["title · place (remote in text) · pay", "no repost twice; new req ID kept"]),
        (1010, "code", "List the role", ["data/jobs.csv + the full", "description in archives/"])]
row2 = [(1010, "claude", "Write the resume", ["writer: tailor-resume", "up to 3 roles at once"]),
        (740, "code", "Code checks", ["5 of the 6 hard rules", "+ your own rules"]),
        (240, "code", "Build Word + PDF", ["one page, in your template", "PDF is made by Pages"])]
row3 = [(400, "code", "Notify, if turned on", ["text · email · Numbers sheet", "never sent twice"]),
        (740, "you", "You review and apply", ["keep adding true detail to", "profile.md and stories.md"])]
for x, k, t, s in row1: station(x, y1, k); label(x, y1 + 50, t, s)
for x, k, t, s in row2: station(x, y2, k); label(x, y2 + 50, t, s)
station(470, y2, "claude")
label(446, y2 - 100, "Fact-checker", ["a separate Claude run: every line", "quoted from your files, quotes", "confirmed by code (rule 5)"], anchor="end")
for x, k, t, s in row3: station(x, y3, k); label(x, y3 + 52, t, s)
station(470, y2 + 160, "you")
label(440, y2 + 164, "Held for your review", ["after 3 tries, with the", "reasons in the log"], anchor="end")
pill(200, y1 + 108)
pill(240, y2 + 108)
pill(400, y3 + 110)

# ---------- the optional inbox joins the job list ----------
ix, iy, iw, ih = 850, 298, 340, 92
add(f'<rect x="{ix}" y="{iy}" width="{iw}" height="{ih}" rx="12" fill="{C["card"]}" stroke="{C["rule"]}" stroke-width="2"/>')
text(ix + 24, iy + 33, "OPTIONAL INBOX", 14.5, 500, C["amber"], "start", MONO, 1.5)
for i, line in enumerate(["inbox.md, filled by you, OpenClaw", "or any agent. Read on the next run."]):
    text(ix + 24, iy + 58 + i * 23, line, 17, 500, anchor="start")
# the join is drawn over the green line below it with a paper-coloured gap, like a bridge on a transit map
add(f'<path d="M 1010 {iy+ih+2} V {y1-22}" stroke="{C["paper"]}" stroke-width="13" fill="none"/>')
add(f'<path d="M 1010 {iy+ih+2} V {y1-22}" stroke="{C["ink"]}" stroke-width="4" fill="none" marker-end="url(#arrowInk)"/>')

# ---------- "your files" card ----------
add(f'<rect x="650" y="{y2+140}" width="440" height="140" rx="12" fill="{C["card"]}" stroke="{C["rule"]}" stroke-width="2"/>')
text(674, y2 + 176, "WHAT IT WRITES FROM: YOUR FILES", 14.5, 500, C["amber"], "start", MONO, 1.5)
for i, line in enumerate(["config/preferences.json", "profile/profile.md · profile/stories.md", "profile/resume-rules.md"]):
    text(674, y2 + 208 + i * 26, line, 16.5, 500, anchor="start", family=MONO)

# ---------- the log card ----------
lx0, ly0, lw0, lh0 = 880, y3 - 48, 310, 130
add(f'<rect x="{lx0}" y="{ly0}" width="{lw0}" height="{lh0}" rx="12" fill="{C["card"]}" stroke="{C["rule"]}" stroke-width="2"/>')
text(lx0 + 24, ly0 + 36, "ALERTS AND PROBLEMS", 14.5, 500, C["red"], "start", MONO, 1.5)
for i, line in enumerate(["go to data/workflow-log.md,", "one line each. Never to", "your phone."]):
    text(lx0 + 24, ly0 + 66 + i * 24, line, 17.5, 500, anchor="start")

# ---------- the agents panel ----------
px, py, pw, ph = 1220, 410, 312, 845
add(f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="16" fill="{C["card"]}" stroke="{C["rule"]}" stroke-width="2"/>')
text(px + 28, py + 46, "AGENTS KEEP IT GROWING", 15, 500, C["green"], "start", MONO, 1.5)
la, lb, lx = px + 36, px + 70, px + 94
add(f'<path d="M {la} {py+100} V 1180" stroke="{C["green"]}" stroke-width="8" stroke-linecap="round"/>')
add(f'<path d="M {lb} {py+440} V 1180" stroke="{C["green"]}" stroke-width="8" stroke-linecap="round"/>')
agents = [(la, py + 100, "A board breaks", ["or goes quiet", "3 runs in a row"]),
          (la, py + 210, "Repair agent", ["investigates the board", "with web access"]),
          (la, py + 320, "Proposes a fix", ["it can't edit code", "or data"]),
          (lb, py + 440, "Once a week", ["on the day you set,", "if you turn it on"]),
          (lb, py + 530, "Scout agent", ["finds companies that", "fit your profile"]),
          (lb, py + 640, "Proposes companies", ["each job board", "checked and readable"])]
for x, y, t, s in agents:
    station(x, y, "agent")
    text(lx, y + 7, t, 21, 700, anchor="start")
    for i, line in enumerate(s):
        text(lx, y + 31 + i * 20, line, 16, 400, C["muted"], "start")
add(f'<rect x="{la-24}" y="1158" width="{lb-la+48}" height="44" rx="22" fill="{C["ink"]}"/>')
add(f'<rect x="{la-12}" y="1170" width="{lb-la+24}" height="20" rx="10" fill="{C["card"]}"/>')
text(lx + 6, 1176, "You approve", 21, 700, anchor="start")
text(lx + 6, 1200, "then Claude applies it", 16, 400, C["muted"], "start")
# approved changes feed the hourly pull
add(f'<path d="M {px} {y1-58} H 470 V {y1-30}" fill="none" stroke="{C["green"]}" stroke-width="5" '
    f'stroke-dasharray="12 9" marker-end="url(#arrowGreen)"/>')
text(660, y1 - 70, "approved fixes and new companies feed the hourly pull", 17, 500, C["green"])

# ---------- legend ----------
ly = 1380
add(f'<line x1="100" y1="{ly-48}" x2="1500" y2="{ly-48}" stroke="{C["rule"]}" stroke-width="2"/>')
items = [("code", "Code: fixed steps, always the same"), ("claude", "Claude skill: language and judgment"),
         ("agent", "Agent: open-ended, proposals only"), ("you", "You: every approval and every send"),
         ("mac", "Mac-only: needs a Mac app")]
for n, (kind, t) in enumerate(items):
    x, yy = 120 + (n % 3) * 470, ly + (n // 3) * 52
    if kind == "mac":
        add(f'<rect x="{x-24}" y="{yy-11}" width="48" height="22" rx="11" fill="{C["card"]}" stroke="{C["ink"]}" stroke-width="1.5"/>')
        text(x, yy + 4, "MAC", 12, 500, C["ink"], "middle", MONO, 1)
        text(x + 36, yy + 7, t, 19, 500, anchor="start")
        continue
    station(x, yy, kind, C["blue"] if kind == "code" else None)
    text(x + 36, yy + 7, t, 19, 500, anchor="start")

# ---------- guardrails ----------
gy = 1540
text(100, gy, "Built to run unattended", 34, 800, anchor="start")
chips = ["Each Claude step writes only its named files", "Dollar cap on every Claude run", "Code checks every resume",
         "Every claim quoted from your files", "Quotes confirmed by code", "Nothing sent twice", "One run at a time",
         "Every run saved to a local history", "Alerts go to the log, never your phone",
         "Notifications off until you turn them on", f"{TESTS} tests + {EVALS} fact-checker evals"]
cx, cy = 100, gy + 34
for c in chips:
    w = int(len(c) * 9.6 + 40)
    if cx + w > 1500:
        cx, cy = 100, cy + 62
    add(f'<rect x="{cx}" y="{cy}" width="{w}" height="46" rx="23" fill="{C["card"]}" stroke="{C["rule"]}" stroke-width="2"/>')
    text(cx + w / 2, cy + 30, c, 18, 500)
    cx += w + 14

# ---------- what's in the repo ----------
ry = cy + 130
text(100, ry, "What's in the repo", 34, 800, anchor="start")
cols = [("6 SKILLS THE RUN USES", ["tailor-resume", "check-resume", "update-competencies", "import-jobs",
                                  "diagnose-board", "scout-companies"]),
        ("4 SKILLS YOU RUN", ["setup", "research-resume-rules", "craft-stories", "interview-prep"]),
        ("THE SCRIPTS", ["scripts/job-pull.mjs", "checked, capped Claude runs", "writer + fact-checker loop",
                         "title, place and pay rules", "Word builder and notifications", "tests/ and evals/"]),
        ("BRING YOUR OWN", ["config/preferences.json", "profile/profile.md", "profile/stories.md",
                            "profile/resume-rules.md", "a Word template, if you like"])]
rows = max(len(lines) for _, lines in cols)
for i, (head, lines) in enumerate(cols):
    x = 100 + i * 350
    text(x, ry + 50, head, 15, 500, [C["amber"], C["amber"], C["blue"], C["green"]][i], "start", MONO, 1.5)
    for j, line in enumerate(lines):
        mono = i in (0, 1) or line.startswith(("scripts/", "tests/", "config/", "profile/"))
        text(x, ry + 88 + j * 30, line, 19 if mono else 20, 500 if mono else 400,
             C["ink"], "start", MONO if mono else DISPLAY)
last = ry + 88 + (rows - 1) * 30
fy = last + 90
H = fy + 50
add(f'<line x1="100" y1="{fy-38}" x2="1500" y2="{fy-38}" stroke="{C["rule"]}" stroke-width="2"/>')
text(100, fy, "Mac-only parts: launchd schedule · Messages · Mail · Numbers · Pages. The rest is Node 20 and Claude Code.", 16, 500, C["muted"], "start", MONO)

svg.insert(0, f'<rect width="{W}" height="{H}" fill="{C["paper"]}"/>')
body = "\n".join(svg)
svg_doc = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" '
           f'aria-label="Agentic job search workflow: an hourly run pulls company job boards, filters and lists roles, writes a resume '
           f'for each, checks the hard rules in code, fact-checks every line against your files with each quote confirmed by code, '
           f'tries up to 3 times, and builds Word and PDF files; notifications are off until you turn them on, and alerts go to the log. '
           f'An optional inbox adds jobs. A repair agent and a scout agent only propose fixes and new companies for your approval.">\n{body}\n</svg>\n')
(OUT / "workflow-poster.svg").write_text(svg_doc, encoding="utf-8")

page = f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agentic Job Search Workflow</title>
<style>
:root {{ --paper: {C["paper"]}; color-scheme: light; }}
html, body {{ background: var(--paper); margin: 0; }}
body {{ padding: 16px; }}
.poster {{ max-width: {W}px; margin: 0 auto; }}
.poster svg {{ width: 100%; height: auto; display: block; }}
body.render {{ padding: 0; }}
body.render .poster {{ max-width: none; width: {W}px; }}
</style>
<figure class="poster" style="margin:0 auto">
{svg_doc}
</figure>
<script>if (location.hash === "#render") document.body.classList.add("render");</script>
"""
(OUT / "workflow-poster.html").write_text(page, encoding="utf-8")
print("wrote", OUT / "workflow-poster.svg", "and", OUT / "workflow-poster.html")


# ---------- the PNG for the README ----------
def find_chrome():
    """Chrome (or Chromium) on this Mac; set CHROME to use another browser."""
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    for pattern in ("/Applications/*Chrom*.app/Contents/MacOS/*Chrom*", os.path.expanduser("~/Applications/*Chrom*.app/Contents/MacOS/*Chrom*")):
        for path in sorted(glob.glob(pattern)):
            if "Helper" not in path:
                return path
    return shutil.which("chromium") or shutil.which("chrome")


def render_png():
    chrome = find_chrome()
    if not chrome:
        print("No Chrome found, so workflow-poster.png was not made. Install Chrome, or set CHROME to its path, and run this again.")
        return 1
    png = OUT / "workflow-poster.png"
    with tempfile.TemporaryDirectory() as profile:   # a throwaway profile, so a Chrome you have open is left alone
        subprocess.run([chrome, "--headless=new", "--hide-scrollbars", f"--user-data-dir={profile}",
                        "--force-device-scale-factor=2", f"--window-size={W},{H}", "--virtual-time-budget=4000",
                        f"--screenshot={png}", (OUT / "workflow-poster.html").as_uri() + "#render"],
                       check=True, capture_output=True, timeout=120)
    print("wrote", png)
    return 0


if "--no-png" not in sys.argv[1:]:
    sys.exit(render_png())
