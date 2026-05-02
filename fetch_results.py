#!/usr/bin/env python3
"""
LottoMind Data Fetcher — v2
Runs daily via GitHub Actions.
Fixed endpoints for all games.
"""

import json, re, sys, csv, io
from datetime import datetime, timezone
from urllib.request import urlopen, Request

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/csv, */*",
}

def fetch_json(url):
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8", errors="ignore"))
    except Exception as e:
        print(f"  warn json({url[:55]}): {e}", file=sys.stderr)
        return None

def fetch_csv(url):
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"  warn csv({url[:55]}): {e}", file=sys.stderr)
        return None

def fetch_html(url):
    try:
        req = Request(url, headers=HEADERS)
        with urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"  warn html({url[:55]}): {e}", file=sys.stderr)
        return None

def fmt_date(s):
    try:
        d = datetime.fromisoformat(str(s)[:10])
        return d.strftime("%b %-d, %Y")
    except:
        return str(s)[:10]

def ny_csv(dataset_id, limit=15):
    """Download CSV from NY Open Data - more reliable than JSON API"""
    url = f"https://data.ny.gov/api/views/{dataset_id}/rows.csv?accessType=DOWNLOAD"
    text = fetch_csv(url)
    if not text:
        return []
    rows = list(csv.DictReader(io.StringIO(text)))
    # Sort newest first
    for date_field in ["Draw Date", "draw_date"]:
        if rows and date_field in rows[0]:
            try:
                rows.sort(key=lambda r: r.get(date_field,""), reverse=True)
            except:
                pass
            break
    return rows[:limit]

def ny_json(dataset_id, limit=15):
    """Socrata JSON API fallback"""
    url = f"https://data.ny.gov/resource/{dataset_id}.json?$limit={limit}&$order=draw_date+DESC"
    return fetch_json(url) or []

def parse_ny_5ball_spec(rows, main_count=5):
    out = []
    for r in rows:
        wn    = str(r.get("Winning Numbers", r.get("winning_numbers", ""))).strip()
        parts = wn.split()
        nums  = [int(x) for x in parts[:main_count] if x.isdigit()]
        spec  = int(parts[main_count]) if len(parts) > main_count and parts[main_count].isdigit() else 0
        dd    = r.get("Draw Date", r.get("draw_date", ""))
        if len(nums) == main_count and spec:
            out.append({"date": fmt_date(dd), "nums": nums, "spec": spec, "jackpot": ""})
    return out

def parse_ny_6ball(rows):
    out = []
    for r in rows:
        wn    = str(r.get("Winning Numbers", r.get("winning_numbers", ""))).strip()
        parts = wn.split()
        nums  = sorted([int(x) for x in parts[:6] if x.isdigit()])
        bonus = int(parts[6]) if len(parts) > 6 and parts[6].isdigit() else None
        dd    = r.get("Draw Date", r.get("draw_date", ""))
        if len(nums) == 6:
            out.append({"date": fmt_date(dd), "nums": nums, "spec": bonus, "jackpot": ""})
    return out

def parse_ny_5ball_nospec(rows):
    out = []
    for r in rows:
        wn    = str(r.get("Winning Numbers", r.get("winning_numbers", ""))).strip()
        parts = wn.split()
        nums  = sorted([int(x) for x in parts[:5] if x.isdigit()])
        dd    = r.get("Draw Date", r.get("draw_date", ""))
        if len(nums) == 5:
            out.append({"date": fmt_date(dd), "nums": nums, "spec": None, "jackpot": ""})
    return out

# ── INDIVIDUAL FETCHERS ───────────────────────────────────────────────────────

def fetch_powerball():
    rows = ny_csv("d6yy-54nr") or ny_json("d6yy-54nr")
    return parse_ny_5ball_spec(rows, 5)

def fetch_megamillions():
    rows = ny_csv("5xaw-6ayf") or ny_json("5xaw-6ayf")
    return parse_ny_5ball_spec(rows, 5)

def fetch_take5():
    rows = ny_csv("dg63-4siq") or ny_json("dg63-4siq")
    return parse_ny_5ball_nospec(rows)

def fetch_ny_lotto():
    rows = ny_csv("6nbc-h7bj") or ny_json("6nbc-h7bj")
    return parse_ny_6ball(rows)

def fetch_millionaire():
    rows = ny_csv("a4w9-a3tp") or ny_json("a4w9-a3tp")
    out = []
    for r in rows:
        wn    = str(r.get("Winning Numbers", r.get("winning_numbers", ""))).strip()
        parts = wn.split()
        nums  = sorted([int(x) for x in parts[:5] if x.isdigit()])
        spec  = int(parts[5]) if len(parts) > 5 and parts[5].isdigit() else None
        dd    = r.get("Draw Date", r.get("draw_date", ""))
        if len(nums) == 5:
            out.append({"date": fmt_date(dd), "nums": nums, "spec": spec, "jackpot": "$1M/year"})
    return out

def fetch_lotto_america():
    """Try lottoamerica.com results page"""
    html = fetch_html("https://www.lottoamerica.com/numbers/lotto-america")
    if not html:
        return []
    out = []
    # Find draw result blocks - look for date + numbers pattern
    # lottoamerica.com shows results in a consistent table format
    date_re = r'((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+202\d)'
    rows = re.findall(
        date_re + r'.{10,400}?(?:winning numbers?|results?)?(.{20,150}?)(?=(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2}|$)',
        html, re.DOTALL | re.IGNORECASE
    )
    for date_str, num_str in rows[:10]:
        nums = [int(x) for x in re.findall(r'\b([1-9]|[1-4]\d|5[012])\b', num_str)]
        if len(nums) >= 5:
            main = sorted(nums[:5])
            spec = nums[5] if len(nums) > 5 and 1 <= nums[5] <= 10 else None
            out.append({"date": date_str.strip(), "nums": main, "spec": spec, "jackpot": ""})
    return out

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now(timezone.utc)
    print(f"LottoMind Fetcher v2 | {ts.strftime('%Y-%m-%d %H:%M UTC')}")

    # Load existing results.json to preserve static data
    existing = {}
    try:
        with open("results.json") as f:
            existing = json.load(f)
        print(f"Loaded existing results.json")
    except:
        print("No existing results.json - starting fresh")

    results = dict(existing)  # start with everything we have

    fetchers = [
        ("powerball",          "Powerball",           fetch_powerball),
        ("megamillions",       "Mega Millions",        fetch_megamillions),
        ("ny_take5",           "NY Take 5",            fetch_take5),
        ("ny_lotto",           "NY Lotto",             fetch_ny_lotto),
        ("millionaireforlife", "Millionaire for Life", fetch_millionaire),
        ("lottoamerica",       "Lotto America",        fetch_lotto_america),
    ]

    ok, empty = [], []
    for key, name, fn in fetchers:
        print(f"\n[{name}]", end=" ")
        try:
            data = fn()
            if data:
                results[key] = data
                print(f"{len(data)} draws — latest: {data[0]['date']}")
                ok.append(key)
            else:
                print("empty — keeping existing data")
                empty.append(key)
        except Exception as e:
            print(f"ERROR: {e}")
            empty.append(key)

    results["_updated"] = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    results["_source"]  = "GitHub Actions daily fetch"

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    total = sum(len(v) for k, v in results.items() if isinstance(v, list))
    print(f"\nDone. Live: {ok} | Static: {empty} | Total draws: {total}")

if __name__ == "__main__":
    main()
