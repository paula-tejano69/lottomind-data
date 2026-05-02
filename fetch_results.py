#!/usr/bin/env python3
"""
LottoMind Data Fetcher
Runs daily via GitHub Actions.
Fetches results from:
  - NY Open Data API (Powerball, Mega Millions) — free, no key
  - powerball.com     (Lotto America, 2by2, Millionaire for Life)
  - nhlottery.com     (Tri-State Megabucks, Gimme 5)
  - Individual state lottery sites for state games
Saves everything to results.json (read by LottoMind frontend)
"""

import json, re, sys
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; LottoMindBot/1.0)",
    "Accept": "application/json, text/html, */*",
}

def fetch(url, as_json=True):
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=15) as r:
            body = r.read().decode("utf-8", errors="ignore")
            return json.loads(body) if as_json else body
    except Exception as e:
        print(f"  WARN fetch({url}): {e}", file=sys.stderr)
        return None

def fmt_date(iso):
    """2026-04-29T00:00:00.000 → Apr 29, 2026"""
    try:
        d = datetime.fromisoformat(iso[:10])
        return d.strftime("%b %-d, %Y")
    except:
        return iso[:10]

# ── NY OPEN DATA ──────────────────────────────────────────────────────────────
def fetch_ny(endpoint, limit=15):
    url = f"https://data.ny.gov/resource/{endpoint}.json?$order=draw_date+DESC&$limit={limit}"
    return fetch(url) or []

def parse_ny_powerball(rows):
    out = []
    for r in rows:
        parts = str(r.get("winning_numbers","")).split()
        nums = [int(x) for x in parts[:5] if x.isdigit()]
        pb   = int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else 0
        if len(nums) == 5 and pb:
            out.append({"date": fmt_date(r["draw_date"]), "nums": nums, "spec": pb, "jackpot": ""})
    return out

def parse_ny_megamillions(rows):
    out = []
    for r in rows:
        parts = str(r.get("winning_numbers","")).split()
        nums = [int(x) for x in parts[:5] if x.isdigit()]
        mb   = int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else 0
        if len(nums) == 5 and mb:
            out.append({"date": fmt_date(r["draw_date"]), "nums": nums, "spec": mb, "jackpot": ""})
    return out

# ── POWERBALL.COM (JSON endpoint) ─────────────────────────────────────────────
def fetch_powerball_com(game_code, limit=10):
    """
    powerball.com has a public JSON endpoint for draw results.
    game_code examples: lotto-america, 2by2, millionaire-for-life
    """
    url = f"https://www.powerball.com/api/v1/drawings/powerball?limit={limit}&game={game_code}"
    data = fetch(url)
    if not data:
        # Try alternate endpoint format
        url2 = f"https://www.powerball.com/api/v1/drawings/{game_code}?limit={limit}"
        data = fetch(url2)
    return data

def parse_lotto_america(data):
    if not data or not isinstance(data, list):
        return []
    out = []
    for r in data[:10]:
        try:
            nums = [int(x) for x in str(r.get("numbersDrawn","")).split(",") if x.strip().isdigit()][:5]
            spec = int(str(r.get("starBall","0")).strip()) if r.get("starBall") else 0
            date = r.get("drawDate","")
            if nums:
                out.append({"date": date, "nums": sorted(nums), "spec": spec, "jackpot": r.get("jackpot","")})
        except:
            pass
    return out

# ── SCRAPE HTML fallback ──────────────────────────────────────────────────────
def scrape_numbers(html, pattern):
    """Generic regex scraper for number sequences in HTML."""
    matches = re.findall(pattern, html or "")
    return matches

# ── STATE LOTTERY SCRAPERS ────────────────────────────────────────────────────
# Each state function returns list of {date, nums, spec, jackpot}
# We only implement the most popular / reliable ones

def fetch_ny_take5():
    rows = fetch_ny("dg63-4siq", 15)  # Take 5 dataset on NY Open Data
    out = []
    for r in rows:
        parts = str(r.get("winning_numbers","")).split()
        nums = sorted([int(x) for x in parts[:5] if x.isdigit()])
        if len(nums) == 5:
            out.append({"date": fmt_date(r["draw_date"]), "nums": nums, "spec": None, "jackpot": ""})
    return out

def fetch_ny_lotto():
    rows = fetch_ny("6nbc-h7bj", 10)
    out = []
    for r in rows:
        parts = str(r.get("winning_numbers","")).split()
        nums = sorted([int(x) for x in parts[:6] if x.isdigit()])
        bonus = int(parts[6]) if len(parts) > 6 and parts[6].isdigit() else 0
        if len(nums) == 6:
            out.append({"date": fmt_date(r["draw_date"]), "nums": nums, "spec": bonus if bonus else None, "jackpot": ""})
    return out

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    print("LottoMind Data Fetcher — " + datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    results = {}

    # 1. POWERBALL via NY Open Data
    print("Fetching Powerball...")
    pb_rows = fetch_ny("d6yy-54nr", 15)
    results["powerball"] = parse_ny_powerball(pb_rows)
    print(f"  Got {len(results['powerball'])} draws")

    # 2. MEGA MILLIONS via NY Open Data
    print("Fetching Mega Millions...")
    mm_rows = fetch_ny("5xaw-6ayf", 15)
    results["megamillions"] = parse_ny_megamillions(mm_rows)
    print(f"  Got {len(results['megamillions'])} draws")

    # 3. NY TAKE 5 via NY Open Data
    print("Fetching NY Take 5...")
    results["ny_take5"] = fetch_ny_take5()
    print(f"  Got {len(results['ny_take5'])} draws")

    # 4. NY LOTTO via NY Open Data
    print("Fetching NY Lotto...")
    results["ny_lotto"] = fetch_ny_lotto()
    print(f"  Got {len(results['ny_lotto'])} draws")

    # 5. LOTTO AMERICA via powerball.com API
    print("Fetching Lotto America...")
    la_data = fetch_powerball_com("lotto-america")
    results["lottoamerica"] = parse_lotto_america(la_data) if la_data else []
    print(f"  Got {len(results['lottoamerica'])} draws")

    # 6. MILLIONAIRE FOR LIFE via NY Open Data (dataset: a4w9-a3tp)
    print("Fetching Millionaire for Life...")
    mfl_rows = fetch_ny("a4w9-a3tp", 10)
    mfl_out = []
    for r in mfl_rows:
        try:
            parts = str(r.get("winning_numbers","")).split()
            nums = sorted([int(x) for x in parts[:5] if x.isdigit()])
            spec = int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else 0
            if nums:
                mfl_out.append({"date": fmt_date(r["draw_date"]), "nums": nums, "spec": spec or None, "jackpot": "$1M/year"})
        except:
            pass
    results["millionaireforlife"] = mfl_out
    print(f"  Got {len(results['millionaireforlife'])} draws")

    # 7. Mark last updated
    results["_updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    results["_source"]  = "GitHub Actions daily fetch"

    # Write output
    out_path = "results.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved {out_path} ({len(json.dumps(results))} bytes)")

    # Report coverage
    covered = [k for k,v in results.items() if not k.startswith("_") and isinstance(v,list) and len(v) > 0]
    print(f"Games with data: {len(covered)} — {', '.join(covered)}")

if __name__ == "__main__":
    main()
