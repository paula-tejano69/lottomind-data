#!/usr/bin/env python3
"""LottoMind Data Fetcher v7 — Fixed Take5 column format + LottoAmerica scraping"""

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

# ── Powerball ─────────────────────────────────────────────────────────────────
def get_powerball():
    return parse_ny(ny_csv_sorted("d6yy-54nr",15), 5, True)

# ── Mega Millions (Texas Lottery CSV) ─────────────────────────────────────────
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

# ── NY Take 5 — FIXED: CSV has "Evening Winning Numbers" column with "02 05 10 15 18" format
def get_take5():
    rows = ny_csv_sorted("dg63-4siq", 30)  # get more rows since we need recent ones
    if not rows:
        return []

    print(f"  Take5 CSV columns: {list(rows[0].keys())[:6] if rows else 'none'}")

    out  = []
    seen = set()
    for r in rows:
        dd = r.get("Draw Date","").strip()
        if not dd or dd in seen: continue

        # Try Evening numbers first, then Midday
        for col in ["Evening Winning Numbers", "Midday Winning Numbers",
                    "Winning Numbers", "winning_numbers"]:
            wn = str(r.get(col,"")).strip()
            if not wn: continue
            # Format is "02 05 10 15 18" — space separated within the cell
            nums = sorted([int(x) for x in wn.split() if x.isdigit() and 1<=int(x)<=39])
            if len(nums) == 5:
                seen.add(dd)
                out.append({"date":fmt(dd), "nums":nums, "spec":None, "jackpot":""})
                break  # one entry per date (evening preferred)

        if len(out) >= 15: break
    return out

# ── NY Lotto ──────────────────────────────────────────────────────────────────
def get_ny_lotto():
    return parse_ny(ny_csv_sorted("6nbc-h7bj",15), 6, False)

# ── Millionaire for Life ──────────────────────────────────────────────────────
def get_millionaire():
    return parse_ny(ny_csv_sorted("a4w9-a3tp",15), 5, False, "$1M/year")

# ── Lotto America — scrape lottoamerica.com/archive/2026 ──────────────────────
def get_lotto_america():
    year = datetime.now().year
    html = get(f"https://www.lottoamerica.com/archive/{year}")
    if not html:
        return []

    # The page has draw entries with dates and numbers
    # Pattern from the page structure: look for date links and numbers nearby
    # dates appear as "Monday 27th April 2026" or "04/27/2026" or similar
    # numbers appear as individual digits in spans/tds

    # Strategy: find all number sequences of exactly 5 numbers (1-52) + 1 star ball (1-10)
    # near date patterns

    out  = []
    seen = set()

    # Try to find date + number blocks
    # lottoamerica.com uses format like: href="/results/2026-04-27" then numbers
    date_links = re.findall(r'href="[^"]*?/results?/(\d{4}-\d{2}-\d{2})"', html)
    if date_links:
        print(f"  Found {len(date_links)} date links on lottoamerica.com")
        # For each date, find the numbers near it in the HTML
        for date_str in date_links[:20]:
            if date_str in seen: continue
            # Find position of this date in HTML
            pos = html.find(date_str)
            if pos == -1: continue
            # Look at the 500 chars after the date link
            snippet = html[pos:pos+500]
            # Find all 1-2 digit numbers in that snippet
            all_nums = [int(x) for x in re.findall(r'\b(\d{1,2})\b', snippet)
                       if 1 <= int(x) <= 52]
            if len(all_nums) >= 5:
                main = sorted(all_nums[:5])
                # Star ball: 1-10
                star_candidates = [x for x in all_nums[5:10] if 1<=x<=10]
                spec = star_candidates[0] if star_candidates else None
                if len(set(main))==5:
                    seen.add(date_str)
                    out.append({"date":fmt(date_str), "nums":main,
                                "spec":spec, "jackpot":""})
    else:
        # Fallback: find numbers in table rows
        # Look for rows with exactly 5 numbers + optional star ball
        print("  No date links found, trying table scrape")
        # Find all sequences of 5-6 small numbers separated by common delimiters
        rows_html = re.findall(
            r'<tr[^>]*>(.{50,600}?)</tr>', html, re.DOTALL
        )
        date_re = re.compile(r'(\d{1,2}/\d{1,2}/20\d{2}|20\d{2}-\d{2}-\d{2})')
        for row in rows_html:
            date_m = date_re.search(row)
            if not date_m: continue
            dd = date_m.group(1)
            if dd in seen: continue
            nums = [int(x) for x in re.findall(r'\b(\d{1,2})\b', row)
                   if 1<=int(x)<=52]
            if len(nums)>=5:
                main = sorted(nums[:5])
                spec_cands = [x for x in nums[5:8] if 1<=x<=10]
                if len(set(main))==5:
                    seen.add(dd)
                    out.append({"date":fmt(dd),"nums":main,
                                "spec":spec_cands[0] if spec_cands else None,
                                "jackpot":""})
            if len(out)>=15: break

    # Sort newest first
    def parse_dt(item):
        try: return datetime.strptime(item["date"], "%b %-d, %Y")
        except:
            try: return datetime.strptime(item["date"], "%b %d, %Y")
            except: return datetime.min
    out.sort(key=parse_dt, reverse=True)
    return out[:15]

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now(timezone.utc)
    print(f"LottoMind Fetcher v7 | {ts.strftime('%Y-%m-%d %H:%M UTC')}")

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
    results["_source"]  = "GitHub Actions daily fetch — v7"

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    live  = [k for k,v in results.items() if not k.startswith("_") and isinstance(v,list) and v]
    total = sum(len(v) for k,v in results.items() if isinstance(v,list))
    print(f"\nDone. {len(live)} games: {', '.join(live)} | {total} total draws")

if __name__ == "__main__":
    main()
