#!/usr/bin/env python3
"""
LottoMind Data Fetcher — FINAL VERSION
Confirmed working sources:
  Powerball:           NY Open Data CSV          (d6yy-54nr)
  Mega Millions:       Texas Lottery CSV          (texaslottery.com)
  NY Lotto:            NY Open Data CSV          (6nbc-h7bj)
  Millionaire for Life:NY Open Data CSV          (a4w9-a3tp)
  Lotto America:       lottoamerica.com/archive  (HTML scrape — 51 draws confirmed)
  2by2:                powerball.com/previous-results?gc=2by2 (HTML — 30 draws confirmed)
  NY Take 5:           NY Open Data CSV          (dg63-4siq — special column format)
  Tri-State Megabucks: beatlottery.com/tri-state-megabucks
  Gimme 5:             beatlottery.com/gimme-5
"""

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
        print(f"  FAIL {url[:65]}: {e}", file=sys.stderr)
        return ""

def fmt(s):
    s = str(s).strip()
    for p in ["%m/%d/%Y", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d",
              "%B %d, %Y", "%b %d, %Y", "%B %-d, %Y"]:
        try: return datetime.strptime(s[:20].strip(), p).strftime("%b %-d, %Y")
        except: pass
    try: return datetime.fromisoformat(s[:10]).strftime("%b %-d, %Y")
    except: return s

def ny_csv(dsid, limit=20):
    text = get(f"https://data.ny.gov/api/views/{dsid}/rows.csv?accessType=DOWNLOAD")
    if not text: return []
    rows = list(csv.DictReader(io.StringIO(text)))
    date_col = next((k for k in (rows[0].keys() if rows else []) if "date" in k.lower()), None)
    if date_col:
        def dt(r):
            v = r.get(date_col, "").strip()
            for p in ["%m/%d/%Y", "%Y-%m-%d"]:
                try: return datetime.strptime(v, p)
                except: pass
            return datetime.min
        rows.sort(key=dt, reverse=True)
    return rows[:limit]

def parse_ny(rows, n, has_spec, jackpot=""):
    out = []
    for r in rows:
        wn    = str(r.get("Winning Numbers", r.get("winning_numbers", ""))).strip()
        parts = wn.split()
        nums  = [int(x) for x in parts[:n] if x.isdigit() and int(x) > 0]
        spec  = int(parts[n]) if has_spec and len(parts) > n and parts[n].isdigit() else None
        dd    = r.get("Draw Date", r.get("draw_date", ""))
        if len(nums) == n and (spec or not has_spec):
            out.append({"date": fmt(dd),
                        "nums": sorted(nums) if n > 5 else nums,
                        "spec": spec, "jackpot": jackpot})
    return out

# ── POWERBALL ─────────────────────────────────────────────────────────────────
def get_powerball():
    return parse_ny(ny_csv("d6yy-54nr"), 5, True)

# ── MEGA MILLIONS ─────────────────────────────────────────────────────────────
def get_megamillions():
    text = get("https://www.texaslottery.com/export/sites/lottery/Games/Mega_Millions/Winning_Numbers/megamillions.csv")
    if not text:
        return parse_ny(ny_csv("5xaw-6ayf"), 5, True)
    rows = list(csv.reader(io.StringIO(text)))
    draws = []
    for row in rows:
        try:
            if len(row) < 10 or not row[3].strip().isdigit(): continue
            if int(row[3].strip()) < 2020: continue
            m, d, y = int(row[1]), int(row[2]), int(row[3])
            nums = sorted([int(row[i].strip()) for i in range(4, 9)])
            mb   = int(row[9].strip())
            if len(nums) == 5 and mb:
                draws.append((datetime(y, m, d),
                              {"date": datetime(y, m, d).strftime("%b %-d, %Y"),
                               "nums": nums, "spec": mb, "jackpot": ""}))
        except: continue
    draws.sort(key=lambda x: x[0], reverse=True)
    return [d for _, d in draws[:15]]

# ── NY TAKE 5 — CSV has "Evening Winning Numbers" column ─────────────────────
def get_take5():
    text = get("https://data.ny.gov/api/views/dg63-4siq/rows.csv?accessType=DOWNLOAD")
    if not text: return []
    rows = list(csv.DictReader(io.StringIO(text)))

    def dt(r):
        v = r.get("Draw Date", "").strip()
        try: return datetime.strptime(v, "%m/%d/%Y")
        except: return datetime.min
    rows.sort(key=dt, reverse=True)

    out, seen = [], set()
    for r in rows:
        dd = r.get("Draw Date", "").strip()
        if not dd or dd in seen: continue
        for col in ["Evening Winning Numbers", "Midday Winning Numbers",
                    "Winning Numbers", "winning_numbers"]:
            wn = r.get(col, "").strip()
            if wn:
                nums = sorted([int(x) for x in wn.split()
                               if x.isdigit() and 1 <= int(x) <= 39])
                if len(nums) == 5:
                    seen.add(dd)
                    out.append({"date": fmt(dd), "nums": nums,
                                "spec": None, "jackpot": ""})
                    break
        if len(out) >= 15: break
    return out

# ── NY LOTTO ──────────────────────────────────────────────────────────────────
def get_ny_lotto():
    return parse_ny(ny_csv("6nbc-h7bj"), 6, False)

# ── MILLIONAIRE FOR LIFE ──────────────────────────────────────────────────────
def get_millionaire():
    return parse_ny(ny_csv("a4w9-a3tp"), 5, False, "$1M/year")

# ── LOTTO AMERICA — lottoamerica.com/archive/YEAR (51 draws confirmed) ────────
def get_lotto_america():
    year = datetime.now().year
    html = get(f"https://www.lottoamerica.com/archive/{year}")
    if not html: return []
    blocks = re.findall(
        r'class="_result">\s*<div class="_date[^"]*">.*?</div>\s*'
        r'<ul class="balls[^"]*">(.*?)</ul>.*?'
        r'href="/numbers/(\d{4}-\d{2}-\d{2})"',
        html, re.DOTALL
    )
    out = []
    for balls_html, date_iso in blocks:
        main = re.findall(r'<li>(\d+)</li>', balls_html)
        bonus = re.search(r'<li class="bonus">(\d+)</li>', balls_html)
        if main and bonus:
            dt   = datetime.strptime(date_iso, '%Y-%m-%d')
            nums = sorted([int(x) for x in main])
            spec = int(bonus.group(1))
            out.append({"date": dt.strftime("%b %-d, %Y"),
                        "nums": nums, "spec": spec, "jackpot": ""})
    return out[:15]

# ── 2by2 — powerball.com/previous-results?gc=2by2 (30 draws confirmed) ───────
def get_2by2():
    html = get("https://www.powerball.com/previous-results?gc=2by2")
    if not html: return []
    blocks = re.findall(
        r'date=(\d{4}-\d{2}-\d{2})">'
        r'(?:(?!<a class="card").)*?'
        r'((?:<div class="form-control col (?:red|white)-balls item-2by2">.*?</div>\s*</div>\s*){4})',
        html, re.DOTALL
    )
    out = []
    for date_iso, balls_html in blocks[:15]:
        reds   = [int(x) for x in re.findall(
            r'red-balls.*?<div>\s*(\d+)\s*</div>', balls_html, re.DOTALL)]
        whites = [int(x) for x in re.findall(
            r'white-balls.*?<div>\s*(\d+)\s*</div>', balls_html, re.DOTALL)]
        if len(reds) == 2 and len(whites) == 2:
            dt = datetime.strptime(date_iso, '%Y-%m-%d')
            out.append({"date": dt.strftime("%b %-d, %Y"),
                        "nums": sorted(reds), "spec": sorted(whites),
                        "jackpot": "$22K"})
    return out

# ── TRI-STATE MEGABUCKS — beatlottery.com ─────────────────────────────────────
def get_megabucks():
    year = datetime.now().year
    for url in [
        f"https://www.beatlottery.com/tri-state-megabucks/draw-history/year/{year}",
        f"https://www.beatlottery.com/megabucks-doubler/draw-history/year/{year}",
        "https://www.beatlottery.com/tri-state-megabucks/draw-history",
    ]:
        html = get(url)
        if not html or "<html" not in html.lower(): continue
        # beatlottery shows: date | N1 N2 N3 N4 N5 N6 in table rows
        rows = re.findall(
            r'(\d{2}/\d{2}/\d{4})'
            r'(?:.*?)'
            r'(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})',
            html, re.DOTALL
        )
        out, seen = [], set()
        for m in rows[:15]:
            dd   = m[0]
            nums = sorted([int(m[i]) for i in range(1, 7)])
            if dd not in seen and len(set(nums)) == 6 and all(1 <= n <= 49 for n in nums):
                seen.add(dd)
                out.append({"date": fmt(dd), "nums": nums,
                            "spec": None, "jackpot": ""})
        if out:
            return out
    return []

# ── GIMME 5 — beatlottery.com ────────────────────────────────────────────────
def get_gimme5():
    year = datetime.now().year
    for url in [
        f"https://www.beatlottery.com/gimme-5/draw-history/year/{year}",
        "https://www.beatlottery.com/gimme-5/draw-history",
    ]:
        html = get(url)
        if not html or "<html" not in html.lower(): continue
        rows = re.findall(
            r'(\d{2}/\d{2}/\d{4})'
            r'(?:.*?)'
            r'(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})',
            html, re.DOTALL
        )
        out, seen = [], set()
        for m in rows[:15]:
            dd   = m[0]
            nums = sorted([int(m[i]) for i in range(1, 6)])
            if dd not in seen and len(set(nums)) == 5 and all(1 <= n <= 39 for n in nums):
                seen.add(dd)
                out.append({"date": fmt(dd), "nums": nums,
                            "spec": None, "jackpot": ""})
        if out:
            return out
    return []

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now(timezone.utc)
    print(f"LottoMind Fetcher FINAL | {ts.strftime('%Y-%m-%d %H:%M UTC')}")

    existing = {}
    try:
        with open("results.json") as f: existing = json.load(f)
        print(f"Loaded existing results.json")
    except: print("Starting fresh")

    results = dict(existing)

    tasks = [
        ("powerball",          "Powerball",            get_powerball),
        ("megamillions",       "Mega Millions",         get_megamillions),
        ("ny_take5",           "NY Take 5",             get_take5),
        ("ny_lotto",           "NY Lotto",              get_ny_lotto),
        ("millionaireforlife", "Millionaire for Life",  get_millionaire),
        ("lottoamerica",       "Lotto America",         get_lotto_america),
        ("2by2",               "2by2",                  get_2by2),
        ("tristatemegabucks",  "Tri-State Megabucks",   get_megabucks),
        ("gimme5",             "Gimme 5",               get_gimme5),
    ]

    ok, empty = [], []
    for key, name, fn in tasks:
        print(f"\n[{name}]", end=" ", flush=True)
        try:
            data = fn()
            if data:
                results[key] = data
                print(f"{len(data)} draws | latest: {data[0]['date']}")
                ok.append(key)
            else:
                print("empty — keeping existing data")
                empty.append(key)
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            import traceback; traceback.print_exc(file=sys.stderr)
            empty.append(key)

    results["_updated"] = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
    results["_source"]  = "GitHub Actions daily fetch — FINAL"

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    total = sum(len(v) for k, v in results.items() if isinstance(v, list))
    print(f"\n{'='*50}")
    print(f"OK    ({len(ok)}): {', '.join(ok)}")
    if empty:
        print(f"EMPTY ({len(empty)}): {', '.join(empty)}")
    print(f"Total draws saved: {total}")
    print(f"File size: {len(json.dumps(results))} bytes")
    print(f"{'='*50}")

if __name__ == "__main__":
    main()
