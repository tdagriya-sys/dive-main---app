from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import Response, HTMLResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import html
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFont


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=2000)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ----------------------------------------------------------------------------
# MOCK DATA - DIVE (Diversify My Investment) investor demo
# All amounts in INR. Deterministic, internally consistent.
# ----------------------------------------------------------------------------

SECTORS = {
    "Reliance Industries": "Energy / Conglomerate",
    "HDFC Bank": "Financials",
    "ICICI Bank": "Financials",
    "Infosys": "IT",
    "TCS": "IT",
    "Others (diversified)": "Diversified",
    "Gold": "Commodities",
    "Govt / Bank": "Fixed Income",
    "Embassy REIT": "Real Estate",
    "IndiGrid InvIT": "Infrastructure",
}

# Profile 1: Aarav — hidden concentration (Reliance-heavy). Keeps REIT/InvIT at zero (the hook).
AARAV_HOLDINGS = [
    {"id": "eq1", "name": "Reliance Industries", "segment": "Equity", "type": "Direct Stock",
     "amount": 110000, "rating": "AA", "ratingWhy": "Large, profitable conglomerate but heavy debt from telecom & retail bets.",
     "lookthrough": [{"company": "Reliance Industries", "pct": 100}]},
    {"id": "mf1", "name": "Nippon Large Cap Fund", "segment": "Mutual Funds", "type": "Equity MF",
     "amount": 30000, "rating": "AA+", "ratingWhy": "Well-managed large-cap fund, but top-heavy in index leaders.",
     "expenseRatio": "1.65%",
     "lookthrough": [
         {"company": "Reliance Industries", "pct": 42},
         {"company": "HDFC Bank", "pct": 18},
         {"company": "Infosys", "pct": 15},
         {"company": "ICICI Bank", "pct": 12},
         {"company": "TCS", "pct": 8},
         {"company": "Others (diversified)", "pct": 5},
     ]},
    {"id": "bd1", "name": "Reliance Corp Bond 2029", "segment": "Bonds", "type": "Corporate Bond",
     "amount": 48000, "rating": "AA", "ratingWhy": "Same issuer as your equity — no real diversification benefit.",
     "yield": "7.9%", "duration": "4.2 yrs",
     "lookthrough": [{"company": "Reliance Industries", "pct": 100}]},
    {"id": "etf1", "name": "Nifty 50 ETF", "segment": "ETF", "type": "Index ETF",
     "amount": 12000, "rating": "AA+", "ratingWhy": "Tracks the index — but the index itself is top-heavy in Reliance.",
     "expenseRatio": "0.05%",
     "lookthrough": [
         {"company": "Reliance Industries", "pct": 10}, {"company": "HDFC Bank", "pct": 12},
         {"company": "ICICI Bank", "pct": 8}, {"company": "Infosys", "pct": 6},
         {"company": "TCS", "pct": 5}, {"company": "Others (diversified)", "pct": 59}]},
    {"id": "ul1", "name": "SmartWealth ULIP Plan", "segment": "Insurance", "type": "ULIP (equity fund)",
     "amount": 12000, "rating": "A", "ratingWhy": "High charges eat into returns; equity fund mirrors large-caps.",
     "lookthrough": [
         {"company": "Reliance Industries", "pct": 8}, {"company": "HDFC Bank", "pct": 10},
         {"company": "Infosys", "pct": 7}, {"company": "Others (diversified)", "pct": 75}]},
    {"id": "gd1", "name": "Sovereign Gold Bond", "segment": "Gold/Silver", "type": "SGB",
     "amount": 10000, "rating": "AAA", "ratingWhy": "Govt-backed, no credit risk.",
     "lookthrough": [{"company": "Gold", "pct": 100}]},
    {"id": "fd1", "name": "HDFC Bank Fixed Deposit", "segment": "FD", "type": "Fixed Deposit",
     "amount": 8000, "rating": "AAA", "ratingWhy": "Insured up to 5L, safest tier.",
     "lookthrough": [{"company": "Govt / Bank", "pct": 100}]},
]

# Profile 2: Meera — well diversified (incl. REIT, InvIT, ETF, ULIP)
MEERA_HOLDINGS = [
    {"id": "eq1", "name": "Direct Equity Basket", "segment": "Equity", "type": "Direct Stocks",
     "amount": 45000, "rating": "AA+", "ratingWhy": "Spread across 8 names, no single stock over 20%.",
     "lookthrough": [
         {"company": "HDFC Bank", "pct": 20}, {"company": "Infosys", "pct": 18},
         {"company": "Reliance Industries", "pct": 15}, {"company": "ICICI Bank", "pct": 15},
         {"company": "TCS", "pct": 12}, {"company": "Others (diversified)", "pct": 20}]},
    {"id": "mf1", "name": "Parag Parikh Flexi Cap", "segment": "Mutual Funds", "type": "Flexi Cap MF",
     "amount": 60000, "rating": "AAA", "ratingWhy": "Diversified across geographies & market caps.", "expenseRatio": "0.63%",
     "lookthrough": [
         {"company": "HDFC Bank", "pct": 12}, {"company": "ICICI Bank", "pct": 10},
         {"company": "Infosys", "pct": 8}, {"company": "Reliance Industries", "pct": 6},
         {"company": "Others (diversified)", "pct": 64}]},
    {"id": "bd1", "name": "Govt Securities Fund", "segment": "Bonds", "type": "Debt Fund",
     "amount": 40000, "rating": "AAA", "ratingWhy": "Sovereign-backed, minimal credit risk.", "yield": "7.1%", "duration": "6.0 yrs",
     "lookthrough": [{"company": "Govt / Bank", "pct": 100}]},
    {"id": "etf1", "name": "Nifty Next 50 ETF", "segment": "ETF", "type": "Index ETF",
     "amount": 20000, "rating": "AA+", "ratingWhy": "Broad exposure beyond the top-10 index names.", "expenseRatio": "0.10%",
     "lookthrough": [
         {"company": "Reliance Industries", "pct": 4}, {"company": "ICICI Bank", "pct": 6},
         {"company": "Others (diversified)", "pct": 90}]},
    {"id": "gd1", "name": "Gold ETF", "segment": "Gold/Silver", "type": "Gold ETF",
     "amount": 20000, "rating": "AAA", "ratingWhy": "Physical gold backed.",
     "lookthrough": [{"company": "Gold", "pct": 100}]},
    {"id": "rt1", "name": "Embassy Office REIT", "segment": "REIT/InvIT", "type": "REIT",
     "amount": 20000, "rating": "AA+", "ratingWhy": "Grade-A office assets, stable rental yield.",
     "lookthrough": [{"company": "Embassy REIT", "pct": 100}]},
    {"id": "iv1", "name": "IndiGrid InvIT", "segment": "REIT/InvIT", "type": "InvIT",
     "amount": 15000, "rating": "AAA", "ratingWhy": "Power-transmission infra with regulated, stable cashflows.",
     "lookthrough": [{"company": "IndiGrid InvIT", "pct": 100}]},
    {"id": "ul1", "name": "Term + Guaranteed Plan", "segment": "Insurance", "type": "Guaranteed (debt-like)",
     "amount": 15000, "rating": "AAA", "ratingWhy": "Capital-protected, debt-like returns.",
     "lookthrough": [{"company": "Govt / Bank", "pct": 100}]},
    {"id": "fd1", "name": "Bank Fixed Deposit", "segment": "FD", "type": "Fixed Deposit",
     "amount": 15000, "rating": "AAA", "ratingWhy": "Insured, safest tier.",
     "lookthrough": [{"company": "Govt / Bank", "pct": 100}]},
]

# Ideal allocation ranges by risk profile (% of portfolio)
IDEAL_RANGES = {
    "Conservative": {
        "Equity": [20, 30], "Mutual Funds": [15, 25], "Bonds": [20, 30],
        "Gold/Silver": [8, 12], "REIT/InvIT": [5, 10], "FD": [10, 20]},
    "Balanced": {
        "Equity": [25, 35], "Mutual Funds": [20, 30], "Bonds": [15, 25],
        "Gold/Silver": [8, 12], "REIT/InvIT": [8, 12], "FD": [8, 15]},
    "Aggressive": {
        "Equity": [35, 50], "Mutual Funds": [20, 30], "Bonds": [5, 15],
        "Gold/Silver": [5, 10], "REIT/InvIT": [8, 15], "FD": [3, 8]},
}

INSTRUMENTS = [
    {"id": "reliance", "name": "Reliance Industries", "kind": "Stock", "sector": "Energy / Conglomerate",
     "fundamental": "Strong balance sheet with diversified revenue across energy, retail and telecom. Debt levels are moderate-to-high after aggressive expansion, but cash flows remain robust.",
     "technical": "Trading near its 52-week high after a strong run. Momentum is positive but slightly overbought — some analysts see limited near-term upside.",
     "valuation": "Trading at a ~15% premium to its 5-year average P/E. Priced for continued growth, so leaves little margin for error.",
     "fit": "You already hold heavy exposure to this company (direct stock + a bond + inside your mutual fund). Adding more would push your single-company concentration even higher — the opposite of what your DIVE Score needs.",
     "fitSignal": "danger"},
    {"id": "ppfcf", "name": "Parag Parikh Flexi Cap Fund", "kind": "Mutual Fund", "sector": "Flexi Cap",
     "fundamental": "Consistently top-quartile flexi-cap fund with a value tilt and meaningful international exposure. Low expense ratio (0.63%) for a direct plan.",
     "technical": "NAV trend is steady with lower drawdowns than category peers in corrections.",
     "valuation": "Portfolio holds a mix of fairly-valued and undervalued names — not chasing expensive momentum stocks.",
     "fit": "Only ~6% of this fund overlaps with your existing Reliance exposure, and it adds global + mid-cap names you don't own. This would genuinely broaden your portfolio and nudge your DIVE Score up.",
     "fitSignal": "green", "expenseRatio": "0.63%", "overlap": "~9% overlap with your current holdings"},
    {"id": "hdfcbond", "name": "HDFC Bond 2029", "kind": "Bond", "sector": "Fixed Income",
     "fundamental": "AAA-rated issuer with strong coverage ratios. Very low default risk.",
     "technical": "Yields have stabilised; price sensitivity is moderate at current rate levels.",
     "valuation": "Yield of 7.4% is fair versus comparable AAA bonds of similar duration.",
     "fit": "This is a different issuer from your existing Reliance bond, so it adds real issuer diversification to your fixed-income sleeve. A healthy addition for your profile.",
     "fitSignal": "green", "yield": "7.4%", "duration": "4.5 yrs"},
]

STRESS_SCENARIOS = [
    {"id": "geo", "name": "Geopolitical Shock", "desc": "Oil spikes, markets wobble.",
     "aarav": {"before": 42, "after": 68}, "meera": {"before": 74, "after": 78}},
    {"id": "rate", "name": "Interest Rate Hike", "desc": "RBI raises rates sharply.",
     "aarav": {"before": 48, "after": 66}, "meera": {"before": 72, "after": 76}},
    {"id": "sector", "name": "Sector-Specific Crash", "desc": "Energy/conglomerate selloff.",
     "aarav": {"before": 24, "after": 61}, "meera": {"before": 70, "after": 75}},
]

INSIGHTS_FEED = {
    "aarav": [
        {"when": "Today", "icon": "alert", "text": "DIVE found 76% of your money is tied to one company across 3 different products."},
        {"when": "Yesterday", "icon": "trophy", "text": "You explored REIT/InvIT for the first time instead of adding more equity."},
        {"when": "3 days ago", "icon": "warning", "text": "DIVE flagged a bond from an issuer you were already overexposed to."},
        {"when": "1 week ago", "icon": "check", "text": "Your gold allocation stayed within a healthy 5-10% band."},
    ],
    "meera": [
        {"when": "Today", "icon": "check", "text": "Your portfolio is well spread — no single company above 20%."},
        {"when": "2 days ago", "icon": "trophy", "text": "You earned the 'Risk-Balanced' badge."},
    ],
}

BADGES = [
    {"id": "diversifier", "name": "Diversifier", "earned": True, "desc": "Spread across 4+ categories"},
    {"id": "explorer", "name": "Explorer", "earned": False, "desc": "Invest in a brand-new category"},
    {"id": "risk_balanced", "name": "Risk-Balanced", "earned": False, "desc": "Keep top exposure under 40%"},
]

PROFILES = {
    "aarav": {"id": "aarav", "name": "Aarav", "avatar": "https://images.pexels.com/photos/6784744/pexels-photo-6784744.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
              "holdings": AARAV_HOLDINGS, "risk": "Balanced"},
    "meera": {"id": "meera", "name": "Meera", "avatar": "https://images.pexels.com/photos/6784744/pexels-photo-6784744.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
              "holdings": MEERA_HOLDINGS, "risk": "Balanced"},
}


# ----------------------------- Models --------------------------------------
class Preferences(BaseModel):
    profile: str
    risk: str = "Balanced"
    returnExpectation: str = "Moderate"
    diversificationPriority: str = "High"
    preferred: List[str] = []
    excluded: List[str] = []
    updatedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class SimAllocation(BaseModel):
    segment: str
    amount: float


class Simulations(BaseModel):
    profile: str
    sims: List[SimAllocation] = []
    updatedAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


FONT_DIR = ROOT_DIR / "assets" / "fonts"


def _font(bold: bool, size: int):
    name = "VeraBd.ttf" if bold else "Vera.ttf"
    try:
        return ImageFont.truetype(str(FONT_DIR / name), size)
    except Exception:
        return ImageFont.load_default()


def _score_color(score: int):
    if score >= 75:
        return (52, 211, 153)
    if score >= 55:
        return (227, 184, 86)
    if score >= 40:
        return (251, 191, 36)
    return (248, 113, 113)


# ----------------------------- Routes --------------------------------------
@api_router.get("/")
async def root():
    return {"message": "DIVE API"}


@api_router.get("/profiles")
async def get_profiles():
    return [{"id": p["id"], "name": p["name"], "risk": p["risk"], "avatar": p["avatar"]} for p in PROFILES.values()]


@api_router.get("/portfolio/{profile}")
async def get_portfolio(profile: str):
    p = PROFILES.get(profile)
    if not p:
        raise HTTPException(status_code=404, detail="Profile not found")
    return {
        "profile": p["id"], "name": p["name"], "avatar": p["avatar"], "risk": p["risk"],
        "holdings": p["holdings"], "sectors": SECTORS,
    }


@api_router.get("/ideal-ranges")
async def get_ideal_ranges():
    return IDEAL_RANGES


@api_router.get("/instruments")
async def get_instruments():
    return [{"id": i["id"], "name": i["name"], "kind": i["kind"], "sector": i["sector"]} for i in INSTRUMENTS]


@api_router.get("/instruments/{instrument_id}")
async def get_instrument(instrument_id: str):
    for i in INSTRUMENTS:
        if i["id"] == instrument_id:
            return i
    raise HTTPException(status_code=404, detail="Instrument not found")


@api_router.get("/stress-tests")
async def get_stress_tests():
    return STRESS_SCENARIOS


@api_router.get("/insights/{profile}")
async def get_insights(profile: str):
    return {"feed": INSIGHTS_FEED.get(profile, []), "badges": BADGES}


@api_router.post("/preferences")
async def save_preferences(prefs: Preferences):
    doc = prefs.model_dump()
    await db.preferences.update_one({"profile": prefs.profile}, {"$set": doc}, upsert=True)
    return doc


@api_router.get("/preferences/{profile}")
async def get_preferences(profile: str):
    doc = await db.preferences.find_one({"profile": profile}, {"_id": 0})
    if not doc:
        return Preferences(profile=profile).model_dump()
    return doc


@api_router.post("/simulations")
async def save_simulations(sim: Simulations):
    doc = sim.model_dump()
    doc["updatedAt"] = datetime.now(timezone.utc).isoformat()
    await db.simulations.update_one({"profile": sim.profile}, {"$set": doc}, upsert=True)
    return doc


@api_router.get("/simulations/{profile}")
async def get_simulations(profile: str):
    doc = await db.simulations.find_one({"profile": profile}, {"_id": 0})
    if not doc:
        return {"profile": profile, "sims": []}
    return doc


@api_router.get("/og-image/{score}")
async def og_image(score: int, u: str = "me", top: int = 0):
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), (10, 10, 11))
    d = ImageDraw.Draw(img)
    # subtle gold glow top-right
    for i in range(60):
        alpha = int(28 * (1 - i / 60))
        d.ellipse([W - 520 + i * 4, -260 + i * 4, W + 60 - i * 4, 300 - i * 4], fill=(26 + alpha // 3, 22 + alpha // 4, 8))
    gold = (227, 184, 86)
    # brand
    d.text((70, 64), "DIVE", font=_font(True, 54), fill=gold)
    d.text((190, 82), "Diversify My Investment", font=_font(False, 26), fill=(150, 150, 156))
    # score ring
    cx, cy, r = 250, 360, 150
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(38, 38, 42), width=26)
    sc_col = _score_color(int(score))
    sweep = max(0, min(360, int(360 * int(score) / 100)))
    d.arc([cx - r, cy - r, cx + r, cy + r], start=-90, end=-90 + sweep, fill=sc_col, width=26)
    sv = str(int(score))
    f_big = _font(True, 120)
    tw = d.textlength(sv, font=f_big)
    d.text((cx - tw / 2, cy - 78), sv, font=f_big, fill=sc_col)
    d.text((cx - 44, cy + 52), "/ 100", font=_font(True, 34), fill=(150, 150, 156))
    # right column text
    d.text((470, 250), "My DIVE Score", font=_font(True, 40), fill=(250, 250, 247))
    line = f"{int(top)}% of my money was secretly" if int(top) else "See your real diversification"
    d.text((470, 320), line, font=_font(False, 34), fill=(180, 180, 186))
    if int(top):
        d.text((470, 366), "tied to ONE company.", font=_font(True, 34), fill=(248, 113, 113))
    d.text((470, 470), "Dive deeper. Invest smarter.", font=_font(True, 34), fill=gold)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@api_router.get("/share/{score}", response_class=HTMLResponse)
async def share_page(score: int, u: str = "me", top: int = 0):
    base = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
    og = f"{base}/api/og-image/{score}?u={html.escape(u)}&top={top}"
    title = f"My DIVE Score is {score}/100"
    desc = (f"{top}% of my money was secretly tied to one company. What's your real diversification? "
            "Dive deeper. Invest smarter.")
    redirect = base or "/"
    page = f"""<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="{html.escape(title)}"/>
<meta property="og:description" content="{html.escape(desc)}"/>
<meta property="og:image" content="{og}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="{html.escape(title)}"/>
<meta name="twitter:description" content="{html.escape(desc)}"/>
<meta name="twitter:image" content="{og}"/>
<meta http-equiv="refresh" content="1;url={redirect}"/>
<style>body{{margin:0;background:#0A0A0B;color:#FAFAF7;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;flex-direction:column;gap:20px}}img{{max-width:92%;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.6)}}a{{color:#E3B856;font-weight:700;text-decoration:none}}</style>
</head><body>
<img src="{og}" alt="My DIVE Score {score}"/>
<a href="{redirect}">Open DIVE →</a>
</body></html>"""
    return HTMLResponse(content=page)


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
