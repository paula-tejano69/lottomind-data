#!/usr/bin/env python3
"""LottoMind Data Fetcher v4 — Uses megamillions.com + NY Open Data CSV"""

import json, re, sys, csv, io
from datetime import datetime, timezone
from urllib.request import urlopen, Request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
H  = {"User-Agent": UA, "Accept": "text/html,application/json,text/csv,*/*", "Accept-Language": "en-US,en;q=0.9"}

def get_url(url, timeout=25):
    try:
        req = Request(url, headers=H)
        with urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"  FAIL {url[:55]}: {e}", file=sys.stderr)
        return ""

def fmt(s):
    s = str(s).strip()
    for p in ["%m/%d/%Y","%Y-%m-%dT%H:%M:%S.%f","%Y-%m-%d","%B %d, %Y","%b %d, %Y"]:
        try: return datetime.strptime(s[:len(p)+4].strip(), p).strftime("%b %-d, %Y")
        except: pass
    try: return datetime.fromisoformat(s[:10]).strftime("%b %-d, %Y")
    except: return s

# ── NY Open Data CSV (most reliable for PB, NY Lotto, MFL) ───────────────────
def ny_csv(dsid, limit=15):
    text = get_url(f"https://data.ny.gov/api/views/{dsid}/rows.csv?accessType=DOWNLOAD")
    if not text: return []
    rows = list(csv.DictReader(io.StringIO(text)))
    date_col = next((k for k in (rows[0].keys() if rows else []) if "date" in k.lower()), None)
    if date_col:
        def dt(r):
            try: return datetime.strptime(r[date_col].strip(), "%m/%d/%Y")
            except:
                try: return datetime.fromisoformat(r[date_col][:10])
                except: return datetime.min
        rows.sort(key=dt, reverse=True)
    return rows[:limit]

def parse_ny(rows, n_main, has_spec, jackpot_val=""):
    out = []
    for r in rows:
        wn    = str(r.get("Winning Numbers", r.get("winning_numbers",""))).strip()
        parts = wn.split()
        nums  = [int(x) for x in parts[:n_main] if x.isdigit() and int(x)>0]
        spec  = int(parts[n_main]) if has_spec and len(parts)>n_main and parts[n_main].isdigit() else None
        dd    = r.get("Draw Date", r.get("draw_date",""))
        if len(nums)==n_main and (spec is not None or not has_spec):
            out.append({"date":fmt(dd),"nums":sorted(nums) if n_main>5 else nums,"spec":spec,"jackpot":jackpot_val})
    return out

# ── Mega Millions — scrape megamillions.com ──────────────────────────────────
def get_megamillions():
    html = get_url("https://www.megamillions.com/Winning-Numbers/Previous-Drawings.aspx")
    if not html:
        # fallback: try NY CSV
        rows = ny_csv("5xaw-6ayf", 15)
        return parse_ny(rows, 5, True)

    out = []
    # Pattern from megamillions.com HTML:
    # date like "5/1/2026" followed by numbers in spans/divs
    # Their page renders: "DRAW DATE WINNING NUMBERS MEGAPLIER"
    # e.g. "16 · 21 · 27 · 41 · 61 · 24"
    
    # Find date + number groups
    # The page has data like: "May\n1\n2026" then balls "16 21 27 41 61" + megaball "24"
    
    # Try JSON endpoint first (their internal API)
    json_urls = [
        "https://www.megamillions.com/cmspages/getwinningnumbersajax.aspx?startDate=01/01/2026&endDate=12/31/2026&numbers=undefined",
        "https://www.megamillions.com/cmspages/getwinningnumbersajax.aspx?startDate=03/01/2026&endDate=05/31/2026&numbers=undefined",
    ]
    for jurl in json_urls:
        jtext = get_url(jurl)
        if jtext and "[" in jtext:
            try:
                data = json.loads(jtext)
                if isinstance(data, list) and data:
                    for item in data[:15]:
                        dd   = item.get("DrawDate","")
                        nums = [item.get(f"N{i}",0) for i in range(1,6)]
                        mb   = item.get("MBall",0) or item.get("N6",0)
                        if all(n>0 for n in nums) and mb:
                            out.append({"date":fmt(dd),"nums":nums,"spec":int(mb),"jackpot":""})
                    if out:
                        print(f"  Got {len(out)} draws from MM JSON API")
                        return out
            except: pass

    # Scrape HTML: look for number sequences near dates
    # megamillions.com renders: Month Day Year then balls
    pattern = (
        r'(\d{1,2}/\d{1,2}/20\d{2})'   # date
        r'.{0,200}?'
        r'(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})'  # 5 white balls
        r'\D+(\d{1,2})'                  # mega ball
    )
    matches = re.findall(pattern, html, re.DOTALL)
    for m in matches[:15]:
        dd   = m[0]
        nums = [int(m[i]) for i in range(1,6)]
        mb   = int(m[6])
        if all(1<=n<=70 for n in nums) and 1<=mb<=25:
            out.append({"date":fmt(dd),"nums":sorted(nums),"spec":mb,"jackpot":""})
    
    if not out:
        # Last resort: NY CSV
        rows = ny_csv("5xaw-6ayf", 15)
        out = parse_ny(rows, 5, True)
    
    return out

# ── NY Take 5 — scrape nylottery.org ─────────────────────────────────────────
def get_take5():
    # First try NY CSV
    rows = ny_csv("dg63-4siq", 15)
    if rows:
        return parse_ny(rows, 5, False)
    
    # Fallback: nylottery.org
    html = get_url("https://www.nylottery.org/take-5/past-winning-numbers")
    if not html: return []
    
    out = []
    # Find date + 5 numbers patterns
    matches = re.findall(
        r'(\d{1,2}/\d{1,2}/20\d{2}).{0,200}?'
        r'(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})',
        html, re.DOTALL
    )
    for m in matches[:15]:
        dd   = m[0]
        nums = sorted([int(m[i]) for i in range(1,6)])
        if all(1<=n<=39 for n in nums):
            out.append({"date":fmt(dd),"nums":nums,"spec":None,"jackpot":""})
    return out

# ── Lotto America — scrape from lottoamerica.com ─────────────────────────────
def get_lotto_america():
    html = get_url("https://www.lottoamerica.com/numbers/lotto-america")
    if not html:
        html = get_url("https://www.lottoamerica.com/")
    if not html: return []
    
    out = []
    # Look for dates and number groups in HTML
    matches = re.findall(
        r'(\d{1,2}/\d{1,2}/20\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+\d{1,2},?\s+20\d{2})'
        r'.{0,300}?'
        r'(\d{1,2})\D{1,5}(\d{1,2})\D{1,5}(\d{1,2})\D{1,5}(\d{1,2})\D{1,5}(\d{1,2})',
        html, re.DOTALL | re.IGNORECASE
    )
    seen_dates = set()
    for m in matches[:15]:
        dd   = m[0].strip()
        nums = sorted([int(m[i]) for i in range(1,6)])
        if len(set(nums))==5 and all(1<=n<=52 for n in nums) and dd not in seen_dates:
            seen_dates.add(dd)
            out.append({"date":fmt(dd),"nums":nums,"spec":None,"jackpot":""})
    return out[:10]

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now(timezone.utc)
    print(f"LottoMind Fetcher v4 | {ts.strftime('%Y-%m-%d %H:%M UTC')}")

    # Load existing (to preserve 2by2, static games)
    existing = {}
    try:
        with open("results.json") as f: existing = json.load(f)
        print(f"Loaded existing results.json ({len(existing)} keys)")
    except: print("Starting fresh")

    results = dict(existing)

    tasks = [
        ("powerball",          "Powerball",
         lambda: parse_ny(ny_csv("d6yy-54nr",15), 5, True)),
        ("megamillions",       "Mega Millions",       get_megamillions),
        ("ny_take5",           "NY Take 5",           get_take5),
        ("ny_lotto",           "NY Lotto",
         lambda: parse_ny(ny_csv("6nbc-h7bj",15), 6, False)),
        ("millionaireforlife", "Millionaire for Life",
         lambda: parse_ny(ny_csv("a4w9-a3tp",15), 5, False, "$1M/year")),
        ("lottoamerica",       "Lotto America",       get_lotto_america),
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
    results["_source"]  = "GitHub Actions daily fetch — v4"

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    live = [k for k,v in results.items() if not k.startswith("_") and isinstance(v,list) and v]
    total = sum(len(v) for k,v in results.items() if isinstance(v,list))
    print(f"\nDone. {len(live)} games: {', '.join(live)} | {total} total draws")

if __name__ == "__main__":
    main()
