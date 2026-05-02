#!/usr/bin/env python3
"""LottoMind Data Fetcher v6 — Final working version"""

import json, re, sys, csv, io
from datetime import datetime, timezone
from urllib.request import urlopen, Request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
H  = {"User-Agent": UA, "Accept": "text/html,text/csv,application/json,*/*"}

def get(url, timeout=25):
    try:
        req = Request(url, headers=H)
        with urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"  FAIL {url[:70]}: {e}", file=sys.stderr)
        return ""

def fmt(s):
    s = str(s).strip()
    for p in ["%m/%d/%Y","%Y-%m-%dT%H:%M:%S.%f","%Y-%m-%d","%B %d, %Y","%b %d, %Y"]:
        try: return datetime.strptime(s[:20].strip(), p).strftime("%b %-d, %Y")
        except: pass
    try: return datetime.fromisoformat(s[:10]).strftime("%b %-d, %Y")
    except: return s

def ny_csv_sorted(dsid, limit=15):
    text = get(f"https://data.ny.gov/api/views/{dsid}/rows.csv?accessType=DOWNLOAD")
    if not text: return []
    rows = list(csv.DictReader(io.StringIO(text)))
    date_col = next((k for k in (rows[0].keys() if rows else []) if "date" in k.lower()), None)
    if date_col:
        def dt(r):
            v = r.get(date_col,"").strip()
            for p in ["%m/%d/%Y","%Y-%m-%d"]:
                try: return datetime.strptime(v, p)
                except: pass
            return datetime.min
        rows.sort(key=dt, reverse=True)
    return rows[:limit]

def parse_ny(rows, n, has_spec, jackpot=""):
    out = []
    for r in rows:
        wn    = str(r.get("Winning Numbers", r.get("winning_numbers",""))).strip()
        parts = wn.split()
        nums  = [int(x) for x in parts[:n] if x.isdigit() and int(x)>0]
        spec  = int(parts[n]) if has_spec and len(parts)>n and parts[n].isdigit() else None
        dd    = r.get("Draw Date", r.get("draw_date",""))
        if len(nums)==n and (spec or not has_spec):
            out.append({"date":fmt(dd), "nums":sorted(nums) if n>5 else nums,
                        "spec":spec, "jackpot":jackpot})
    return out

# ── Powerball (NY Open Data CSV — confirmed working) ─────────────────────────
def get_powerball():
    return parse_ny(ny_csv_sorted("d6yy-54nr",15), 5, True)

# ── Mega Millions (Texas Lottery CSV — confirmed working) ─────────────────────
def get_megamillions():
    text = get("https://www.texaslottery.com/export/sites/lottery/Games/Mega_Millions/Winning_Numbers/megamillions.csv")
    if not text:
        return parse_ny(ny_csv_sorted("5xaw-6ayf",15), 5, True)
    rows  = list(csv.reader(io.StringIO(text)))
    draws = []
    for row in rows:
        try:
            if len(row)<10 or not row[3].strip().isdigit(): continue
            if int(row[3].strip()) < 2020: continue
            m,d,y = int(row[1]),int(row[2]),int(row[3])
            nums  = sorted([int(row[i].strip()) for i in range(4,9)])
            mb    = int(row[9].strip())
            if len(nums)==5 and mb:
                draws.append((datetime(y,m,d), {"date":datetime(y,m,d).strftime("%b %-d, %Y"),
                              "nums":nums,"spec":mb,"jackpot":""}))
        except: continue
    draws.sort(key=lambda x: x[0], reverse=True)
    return [d for _,d in draws[:15]]

# ── NY Take 5 — scrape nylottery.org past winning numbers page ────────────────
def get_take5():
    # First try NY Open Data CSV (dataset dg63-4siq)
    rows = ny_csv_sorted("dg63-4siq", 15)
    if rows:
        result = parse_ny(rows, 5, False)
        if result: return result

    # Fallback: scrape nylottery.org archive page for current year
    html = get("https://www.nylottery.org/take-5/past-winning-numbers")
    if not html: return []

    out = []
    # Pattern: date like "01/02/2026" then 5 numbers
    matches = re.findall(
        r'(\d{2}/\d{2}/20\d{2})'
        r'(?:.*?)'
        r'(\d{1,2})[^\d]+(\d{1,2})[^\d]+(\d{1,2})[^\d]+(\d{1,2})[^\d]+(\d{1,2})',
        html, re.DOTALL
    )
    seen = set()
    for m in matches:
        dd   = m[0]
        nums = sorted([int(m[i]) for i in range(1,6)])
        if dd not in seen and len(set(nums))==5 and all(1<=n<=39 for n in nums):
            seen.add(dd)
            out.append({"date":fmt(dd),"nums":nums,"spec":None,"jackpot":""})
        if len(out)>=15: break
    return out

# ── NY Lotto (NY Open Data CSV — confirmed working) ───────────────────────────
def get_ny_lotto():
    return parse_ny(ny_csv_sorted("6nbc-h7bj",15), 6, False)

# ── Millionaire for Life (NY Open Data CSV — confirmed working) ───────────────
def get_millionaire():
    return parse_ny(ny_csv_sorted("a4w9-a3tp",15), 5, False, "$1M/year")

# ── Lotto America — beatlottery.com CSV download ──────────────────────────────
def get_lotto_america():
    # beatlottery.com has direct CSV download for Lotto America
    year = datetime.now().year
    csv_url = f"https://www.beatlottery.com/lotto-america/draw-history/year/{year}/csv"
    text = get(csv_url)
    if not text:
        csv_url2 = "https://www.beatlottery.com/lotto-america/draw-history/csv"
        text = get(csv_url2)
    if text and "," in text:
        rows = list(csv.DictReader(io.StringIO(text)))
        out  = []
        for r in rows:
            # Typical columns: Date, N1, N2, N3, N4, N5, StarBall (or similar)
            dd   = r.get("Date","") or r.get("Draw Date","") or r.get("date","")
            keys = list(r.keys())
            # Find number columns
            num_cols = [k for k in keys if re.search(r'\bN\d\b|ball|number', k, re.I) and k != dd]
            star_col = next((k for k in keys if "star" in k.lower()), None)
            try:
                nums = sorted([int(r[k]) for k in num_cols[:5] if r.get(k,"").strip().isdigit()])
                spec = int(r[star_col]) if star_col and r.get(star_col,"").strip().isdigit() else None
                if len(nums)==5 and dd:
                    out.append({"date":fmt(dd),"nums":nums,"spec":spec,"jackpot":""})
            except: continue
        if out:
            # Sort newest first
            out.sort(key=lambda x: datetime.strptime(x["date"], "%b %d, %Y")
                     if len(x["date"])>8 else datetime.min, reverse=True)
            return out[:15]

    # Fallback: scrape lottoamerica.com archive
    html = get(f"https://www.lottoamerica.com/archive/{year}")
    if not html: return []
    out  = []
    seen = set()
    matches = re.findall(
        r'(\d{1,2}/\d{1,2}/20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+20\d{2})'
        r'.{0,400}?'
        r'(\d{1,2})\D{1,8}(\d{1,2})\D{1,8}(\d{1,2})\D{1,8}(\d{1,2})\D{1,8}(\d{1,2})'
        r'(?:\D{1,8}(\d{1,2}))?',
        html, re.DOTALL|re.IGNORECASE
    )
    for m in matches:
        dd   = m[0].strip()
        nums = sorted([int(m[i]) for i in range(1,6)])
        spec = int(m[6]) if m[6] and 1<=int(m[6])<=10 else None
        if dd not in seen and len(set(nums))==5 and all(1<=n<=52 for n in nums):
            seen.add(dd)
            out.append({"date":fmt(dd),"nums":nums,"spec":spec,"jackpot":""})
        if len(out)>=15: break
    return out

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now(timezone.utc)
    print(f"LottoMind Fetcher v6 | {ts.strftime('%Y-%m-%d %H:%M UTC')}")

    existing = {}
    try:
        with open("results.json") as f: existing = json.load(f)
        print(f"Loaded existing results.json")
    except: print("Starting fresh")

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
                print("empty — keeping existing data")
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)

    results["_updated"] = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    results["_source"]  = "GitHub Actions daily fetch — v6"

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    live  = [k for k,v in results.items() if not k.startswith("_") and isinstance(v,list) and v]
    total = sum(len(v) for k,v in results.items() if isinstance(v,list))
    print(f"\nDone. {len(live)} games with data: {', '.join(live)}")
    print(f"Total draws: {total} | File: {len(json.dumps(results))} bytes")

if __name__ == "__main__":
    main()
