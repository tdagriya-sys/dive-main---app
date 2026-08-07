"""DIVE backend regression tests (iteration 2)."""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://dive-score-reveal.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def test_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("message") == "DIVE API"


def test_portfolio_aarav_has_etf_insurance_no_reit(s):
    r = s.get(f"{API}/portfolio/aarav")
    assert r.status_code == 200
    data = r.json()
    assert data["profile"] == "aarav"
    holdings = data["holdings"]
    assert len(holdings) == 7, f"expected 7 holdings, got {len(holdings)}"
    segments = {h["segment"] for h in holdings}
    assert "ETF" in segments
    assert "Insurance" in segments
    assert "REIT/InvIT" not in segments
    # Confirm etf1 (Nifty 50 ETF) and ul1 (ULIP)
    ids = {h["id"] for h in holdings}
    assert "etf1" in ids and "ul1" in ids
    # look-through of etf1 has multiple companies
    etf1 = next(h for h in holdings if h["id"] == "etf1")
    assert len(etf1["lookthrough"]) >= 5


def test_portfolio_meera_has_reit_invit_etf_insurance(s):
    r = s.get(f"{API}/portfolio/meera")
    assert r.status_code == 200
    data = r.json()
    holdings = data["holdings"]
    assert len(holdings) == 9
    segments = [h["segment"] for h in holdings]
    assert segments.count("REIT/InvIT") >= 2
    assert "ETF" in segments and "Insurance" in segments
    names = {h["name"] for h in holdings}
    assert "Embassy Office REIT" in names
    assert "IndiGrid InvIT" in names


def test_portfolio_invalid_404(s):
    r = s.get(f"{API}/portfolio/xyz")
    assert r.status_code == 404


def test_ideal_ranges(s):
    r = s.get(f"{API}/ideal-ranges")
    assert r.status_code == 200
    d = r.json()
    for k in ("Conservative", "Balanced", "Aggressive"):
        assert k in d


def test_instruments_list(s):
    r = s.get(f"{API}/instruments")
    assert r.status_code == 200
    ids = {i["id"] for i in r.json()}
    assert {"reliance", "ppfcf", "hdfcbond"}.issubset(ids)


@pytest.mark.parametrize("iid", ["reliance", "ppfcf", "hdfcbond"])
def test_instrument_detail(s, iid):
    r = s.get(f"{API}/instruments/{iid}")
    assert r.status_code == 200
    assert r.json()["id"] == iid


def test_instrument_404(s):
    r = s.get(f"{API}/instruments/unknown-xyz")
    assert r.status_code == 404


def test_stress_tests(s):
    r = s.get(f"{API}/stress-tests")
    assert r.status_code == 200
    arr = r.json()
    assert len(arr) >= 3
    assert all("aarav" in x and "meera" in x for x in arr)


@pytest.mark.parametrize("p", ["aarav", "meera"])
def test_insights(s, p):
    r = s.get(f"{API}/insights/{p}")
    assert r.status_code == 200
    d = r.json()
    assert "feed" in d and "badges" in d


def test_preferences_post_get(s):
    payload = {
        "profile": "aarav", "risk": "Aggressive", "returnExpectation": "High",
        "diversificationPriority": "High", "preferred": ["Equity", "REIT/InvIT"], "excluded": ["FD"],
    }
    r = s.post(f"{API}/preferences", json=payload)
    assert r.status_code == 200
    r2 = s.get(f"{API}/preferences/aarav")
    assert r2.status_code == 200
    d = r2.json()
    assert d["risk"] == "Aggressive"
    assert d["excluded"] == ["FD"]
    assert "_id" not in d


# ---------------- Iteration 3: simulations, og-image, share ---------------

def test_simulations_post_get_and_clear(s):
    # Post with one sim
    payload = {"profile": "aarav", "sims": [{"segment": "REIT/InvIT", "amount": 50000}]}
    r = s.post(f"{API}/simulations", json=payload)
    assert r.status_code == 200
    d = r.json()
    assert d["profile"] == "aarav"
    assert d["sims"][0]["segment"] == "REIT/InvIT"
    assert d["sims"][0]["amount"] == 50000

    # Get returns saved
    r2 = s.get(f"{API}/simulations/aarav")
    assert r2.status_code == 200
    d2 = r2.json()
    assert "_id" not in d2
    assert len(d2["sims"]) == 1
    assert d2["sims"][0]["segment"] == "REIT/InvIT"
    assert d2["sims"][0]["amount"] == 50000

    # Clear (empty list)
    r3 = s.post(f"{API}/simulations", json={"profile": "aarav", "sims": []})
    assert r3.status_code == 200
    r4 = s.get(f"{API}/simulations/aarav")
    assert r4.status_code == 200
    assert r4.json()["sims"] == []


def test_simulations_empty_default_for_new_profile(s):
    r = s.get(f"{API}/simulations/nobody-xyz")
    assert r.status_code == 200
    d = r.json()
    assert d["profile"] == "nobody-xyz"
    assert d["sims"] == []


def test_og_image_returns_png(s):
    r = s.get(f"{API}/og-image/62", params={"u": "Aarav", "top": 75})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert len(r.content) > 5000  # non-trivial image
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_share_page_has_og_meta(s):
    r = s.get(f"{API}/share/62", params={"u": "Aarav", "top": 75})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    body = r.text
    assert 'property="og:image"' in body
    assert 'property="og:title"' in body
    assert 'name="twitter:image"' in body
    assert "/api/og-image/62" in body
    assert "My DIVE Score is 62/100" in body
