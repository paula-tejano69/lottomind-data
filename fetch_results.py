#!/usr/bin/env python3
"""LottoMind Data Fetcher v5 — Texas Lottery CSV for MM, NY Open Data for rest"""

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
        print(f"  FAIL {url[:60]}: {e}", file=sys.stderr); return ""

def fmt(s):
    s = str(s).strip()
    for p in ["%m/%d/%Y","%Y-%m-%dT%H:%M:%S.%f","%Y-%m-%d","%B %d, %Y","%b %d, %Y","%b %-d, %Y"]:
        try: return datetime.strptime(s[:20].strip(), p).strftime("%b %-d, %Y")
        except: pass
    try: return datetime.fromisoformat(s[:10]).strftime("%b %-d, %Y")
    except: return s

# ── NY Open Data CSV ──────────────────────────────────────────────────────────
def ny_csv(dsid, limit=15):
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
            out.append({"date":fmt(dd), "nums":sorted(nums) if n>5 else nums, "spec":spec, "jackpot":jackpot})
    return out

# ── Mega Millions — Texas Lottery CSV (direct download, no auth, no CORS) ────
def get_megamillions():
    # Texas Lottery provides a direct CSV download for Mega Millions
    # Format: Game Name, Month, Day, Year, N1, N2, N3, N4, N5, Mega Ball, Megaplier
    text = get("https://www.texaslottery.com/export/sites/lottery/Games/Mega_Millions/Winning_Numbers/megamillions.csv")
    if not text:
        # Fallback: NY Open Data JSON Socrata API
        text = get("https://data.ny.gov/resource/5xaw-6ayf.json?$limit=15&$order=draw_date+DESC")
        if text:
            try:
                data = json.loads(text)
                return parse_ny(data, 5, True)
            except: pass
        return []

    rows = list(csv.reader(io.StringIO(text)))
    if not rows: return []

    # Texas CSV format — newest entries are at the END, so reverse
    rows.reverse()
    out = []
    for row in rows:
        try:
            # Skip header rows
            if not row or not row[0].strip().lstrip("0123456789").strip(): continue
            # Format: Game, Month, Day, Year, N1, N2, N3, N4, N5, MegaBall, Megaplier
            if len(row) < 10: continue
            # Try to parse month/day/year
            month, day, year = row[1].strip(), row[2].strip(), row[3].strip()
            if not year.isdigit() or int(year) < 2020: continue
            nums = sorted([int(row[i].strip()) for i in range(4,9) if row[i].strip().isdigit()])
            mb   = int(row[9].strip()) if row[9].strip().isdigit() else 0
            if len(nums)==5 and mb:
                dt = datetime(int(year), int(month), int(day))
                out.append({"date": dt.strftime("%b %-d, %Y"), "nums": nums, "spec": mb, "jackpot": ""})
        except: continue

    # Already reversed so newest is first — take top 15
    return out[:15]

# ── NY Take 5 — try NY Open Data JSON (Socrata) which has different auth than CSV ─
def get_take5():
    # Try Socrata JSON first
    text = get("https://data.ny.gov/resource/dg63-4siq.json?$limit=15&$order=draw_date+DESC")
    if text:
        try:
            data = json.loads(text)
            if data:
                return parse_ny(data, 5, False)
        except: pass

    # Try CSV download
    rows = ny_csv("dg63-4siq", 15)
    if rows: return parse_ny(rows, 5, False)

    # Fallback: nylottery.org JSON API (unofficial)
    text = get("https://www.nylottery.org/api/1.0/past_winning_numbers?game=take5&count=15")
    if text:
        try:
            data = json.loads(text)
            out = []
            for item in (data.get("past_winning_numbers") or data if isinstance(data, list) else []):
                dd   = item.get("draw_date", item.get("date",""))
                wn   = item.get("winning_numbers","")
                nums = sorted([int(x) for x in str(wn).split() if x.isdigit() and int(x)>0])[:5]
                if len(nums)==5:
                    out.append({"date":fmt(dd),"nums":nums,"spec":None,"jackpot":""})
            if out: return out
        except: pass
    return []

# ── Lotto America — lottoamerica.com JSON/CSV ─────────────────────────────────
def get_lotto_america():
    # Try lottoamerica.com internal API
    for url in [
        "https://www.lottoamerica.com/api/results?game=lotto-america&count=10",
        "https://www.lottoamerica.com/numbers/lotto-america.json",
    ]:
        text = get(url)
        if text and ("{" in text or "[" in text):
            try:
                data = json.loads(text)
                items = data if isinstance(data, list) else data.get("results", data.get("data",[]))
                out = []
                for item in items[:10]:
                    nums = [int(x) for x in str(item.get("numbers","")).split(",") if x.strip().isdigit()]
                    spec = int(str(item.get("star_ball", item.get("starBall","0"))).strip() or 0)
                    dd   = item.get("date", item.get("draw_date",""))
                    if nums:
                        out.append({"date":fmt(dd),"nums":sorted(nums[:5]),"spec":spec or None,"jackpot":""})
                if out: return out
            except: pass
    return []

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now(timezone.utc)
    print(f"LottoMind Fetcher v5 | {ts.strftime('%Y-%m-%d %H:%M UTC')}")

    existing = {}
    try:
        with open("results.json") as f: existing = json.load(f)
        print(f"Loaded existing results.json")
    except: print("Starting fresh")

    results = dict(existing)

    tasks = [
        ("powerball",           "Powerball",
            lambda: parse_ny(ny_csv("d6yy-54nr",15), 5, True)),
        ("megamillions",        "Mega Millions",       get_megamillions),
        ("ny_take5",            "NY Take 5",           get_take5),
        ("ny_lotto",            "NY Lotto",
            lambda: parse_ny(ny_csv("6nbc-h7bj",15), 6, False)),
        ("millionaireforlife",  "Millionaire for Life",
            lambda: parse_ny(ny_csv("a4w9-a3tp",15), 5, False, "$1M/year")),
        ("lottoamerica",        "Lotto America",       get_lotto_america),
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
    results["_source"]  = "GitHub Actions daily fetch — v5"

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    live = [k for k,v in results.items() if not k.startswith("_") and isinstance(v,list) and v]
    total = sum(len(v) for k,v in results.items() if isinstance(v,list))
    print(f"\nDone. {len(live)} games with data: {', '.join(live)}")
    print(f"Total draws: {total} | File: {len(json.dumps(results))} bytes")

if __name__ == "__main__":
    main()
