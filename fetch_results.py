#!/usr/bin/env python3
"""LottoMind Data Fetcher v3 — Fixed sorting, dates, and MM/Take5 endpoints"""

import json, re, sys, csv, io
from datetime import datetime, timezone
from urllib.request import urlopen, Request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Accept": "application/json, text/csv, */*"}

def fetch_json(url):
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8", errors="ignore"))
    except Exception as e:
        print(f"  warn json: {e}", file=sys.stderr); return None

def fetch_csv_rows(dataset_id, limit=15):
    """Download CSV and return rows sorted newest-first"""
    url = f"https://data.ny.gov/api/views/{dataset_id}/rows.csv?accessType=DOWNLOAD"
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=30) as r:
            text = r.read().decode("utf-8", errors="ignore")
        rows = list(csv.DictReader(io.StringIO(text)))
        if not rows:
            return []
        # Find the date column
        date_col = next((k for k in rows[0].keys() if "date" in k.lower()), None)
        if date_col:
            def parse_dt(r):
                try: return datetime.strptime(r[date_col].strip(), "%m/%d/%Y")
                except:
                    try: return datetime.fromisoformat(r[date_col][:10])
                    except: return datetime.min
            rows.sort(key=parse_dt, reverse=True)
        return rows[:limit]
    except Exception as e:
        print(f"  warn csv({dataset_id}): {e}", file=sys.stderr); return []

def fetch_json_api(dataset_id, limit=15):
    """Socrata JSON API"""
    url = f"https://data.ny.gov/resource/{dataset_id}.json?$limit={limit}&$order=draw_date+DESC"
    return fetch_json(url) or []

def fmt(s):
    """Convert any date string to 'Apr 29, 2026' format"""
    s = str(s).strip()
    for fmt_try in ["%m/%d/%Y", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d"]:
        try:
            d = datetime.strptime(s[:len(fmt_try)+2], fmt_try)
            return d.strftime("%b %-d, %Y")
        except: pass
    try:
        d = datetime.fromisoformat(s[:10])
        return d.strftime("%b %-d, %Y")
    except: return s

def get_field(row, *keys):
    for k in keys:
        if k in row and row[k]: return str(row[k]).strip()
    return ""

def parse_5spec(rows, nspec=5):
    out = []
    for r in rows:
        wn    = get_field(r, "Winning Numbers", "winning_numbers")
        parts = wn.split()
        nums  = [int(x) for x in parts[:nspec] if x.lstrip("-").isdigit() and int(x) > 0]
        spec  = int(parts[nspec]) if len(parts) > nspec and parts[nspec].isdigit() else 0
        dd    = get_field(r, "Draw Date", "draw_date")
        if len(nums) == nspec and spec > 0:
            out.append({"date": fmt(dd), "nums": nums, "spec": spec, "jackpot": ""})
    return out

def parse_6nospec(rows):
    out = []
    for r in rows:
        wn    = get_field(r, "Winning Numbers", "winning_numbers")
        parts = wn.split()
        nums  = sorted([int(x) for x in parts[:6] if x.isdigit() and int(x) > 0])
        dd    = get_field(r, "Draw Date", "draw_date")
        if len(nums) == 6:
            out.append({"date": fmt(dd), "nums": nums, "spec": None, "jackpot": ""})
    return out

def parse_5nospec(rows):
    out = []
    for r in rows:
        wn    = get_field(r, "Winning Numbers", "winning_numbers")
        parts = wn.split()
        nums  = sorted([int(x) for x in parts[:5] if x.isdigit() and int(x) > 0])
        dd    = get_field(r, "Draw Date", "draw_date")
        if len(nums) == 5:
            out.append({"date": fmt(dd), "nums": nums, "spec": None, "jackpot": ""})
    return out

def parse_mfl(rows):
    out = []
    for r in rows:
        wn    = get_field(r, "Winning Numbers", "winning_numbers")
        parts = wn.split()
        nums  = sorted([int(x) for x in parts[:5] if x.isdigit() and int(x) > 0])
        spec  = int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else None
        dd    = get_field(r, "Draw Date", "draw_date")
        if len(nums) == 5:
            out.append({"date": fmt(dd), "nums": nums, "spec": spec, "jackpot": "$1M/year"})
    return out

# ── FETCHERS ──────────────────────────────────────────────────────────────────

def get_powerball():
    rows = fetch_csv_rows("d6yy-54nr", 15) or fetch_json_api("d6yy-54nr", 15)
    return parse_5spec(rows, 5)

def get_megamillions():
    # Try CSV first, then JSON, then direct download URL
    rows = fetch_csv_rows("5xaw-6ayf", 15)
    if not rows:
        rows = fetch_json_api("5xaw-6ayf", 15)
    if not rows:
        # Try alternate direct download
        try:
            req = Request(
                "https://data.ny.gov/api/views/5xaw-6ayf/rows.csv?accessType=DOWNLOAD&sorting=true",
                headers=HEADERS
            )
            with urlopen(req, timeout=30) as r:
                text = r.read().decode("utf-8", errors="ignore")
            all_rows = list(csv.DictReader(io.StringIO(text)))
            def parse_dt(r):
                try: return datetime.strptime(get_field(r,"Draw Date","draw_date"), "%m/%d/%Y")
                except: return datetime.min
            all_rows.sort(key=parse_dt, reverse=True)
            rows = all_rows[:15]
        except Exception as e:
            print(f"  MM alt fetch failed: {e}", file=sys.stderr)
    return parse_5spec(rows, 5)

def get_take5():
    rows = fetch_csv_rows("dg63-4siq", 15) or fetch_json_api("dg63-4siq", 15)
    return parse_5nospec(rows)

def get_ny_lotto():
    rows = fetch_csv_rows("6nbc-h7bj", 15) or fetch_json_api("6nbc-h7bj", 15)
    return parse_6nospec(rows)

def get_millionaire():
    rows = fetch_csv_rows("a4w9-a3tp", 15) or fetch_json_api("a4w9-a3tp", 15)
    return parse_mfl(rows)

def get_lotto_america():
    """Scrape lottoamerica.com — no public API available"""
    try:
        req = Request("https://www.lottoamerica.com/numbers/lotto-america", headers=HEADERS)
        with urlopen(req, timeout=20) as r:
            html = r.read().decode("utf-8", errors="ignore")
        out = []
        # Find result blocks: date followed by numbers
        blocks = re.findall(
            r'(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2})'
            r'.{0,500}?'
            r'((?:\b\d{1,2}\b[\s,]+){4}\b\d{1,2}\b)',
            html, re.DOTALL | re.IGNORECASE
        )
        for date_str, num_str in blocks[:10]:
            nums = sorted([int(x) for x in re.findall(r'\b(\d{1,2})\b', num_str) if 1 <= int(x) <= 52])
            if len(nums) >= 5:
                out.append({"date": date_str.strip().replace(",", ""), "nums": nums[:5], "spec": None, "jackpot": ""})
        return out
    except Exception as e:
        print(f"  LottoAmerica scrape failed: {e}", file=sys.stderr)
        return []

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now(timezone.utc)
    print(f"LottoMind Fetcher v3 | {ts.strftime('%Y-%m-%d %H:%M UTC')}")

    # Load existing to preserve static data (2by2, tristatemegabucks, etc.)
    existing = {}
    try:
        with open("results.json") as f:
            existing = json.load(f)
        print(f"Loaded existing: {list(existing.keys())}")
    except:
        print("No existing results.json")

    results = dict(existing)

    tasks = [
        ("powerball",          "Powerball",           get_powerball),
        ("megamillions",       "Mega Millions",        get_megamillions),
        ("ny_take5",           "NY Take 5",            get_take5),
        ("ny_lotto",           "NY Lotto",             get_ny_lotto),
        ("millionaireforlife", "Millionaire for Life", get_millionaire),
        ("lottoamerica",       "Lotto America",        get_lotto_america),
    ]

    for key, name, fn in tasks:
        print(f"\n[{name}]", end=" ", flush=True)
        try:
            data = fn()
            if data:
                results[key] = data
                print(f"{len(data)} draws | latest: {data[0]['date']}")
            else:
                print("empty — keeping existing")
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)

    results["_updated"] = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    results["_source"]  = "GitHub Actions daily fetch — v3"

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    live = [k for k,v in results.items() if not k.startswith("_") and isinstance(v,list) and v]
    print(f"\n✓ Done. {len(live)} games with data: {', '.join(live)}")
    total = sum(len(v) for k,v in results.items() if isinstance(v,list))
    print(f"  Total draws: {total} | File: {len(json.dumps(results))} bytes")

if __name__ == "__main__":
    main()
