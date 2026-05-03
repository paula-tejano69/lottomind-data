#!/usr/bin/env python3
"""
LottoMind Data Fetcher — v8 with nosyapi integration
Confirmed working sources:
  Powerball:            NY Open Data CSV          (no change)
  Mega Millions:        Texas Lottery CSV          (no change)
  NY Lotto:             NY Open Data CSV          (no change)
  Millionaire for Life: NY Open Data CSV          (no change)
  NY Take 5:            NY Open Data CSV          (no change)
  ── NEW via nosyapi ────────────────────────────────────────────
  Lotto America:        nosyapi (gameID to discover)
  2by2:                 nosyapi
  Tri-State Megabucks:  nosyapi
  Gimme 5:              nosyapi
"""

import json, re, sys, csv, io
from datetime import datetime, timezone
from urllib.request import urlopen, Request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
H  = {"User-Agent": UA, "Accept": "text/html,text/csv,application/json,*/*"}

# ── nosyapi credentials ────────────────────────────────────────────────────────
RAPID_KEY  = "68f735b69emsh01a33ebf4e3d7e8p10aaecjsn1c4722929da1"
RAPID_HOST = "usa-lottery-result-all-state-api.p.rapidapi.com"
RAPID_BASE = f"https://{RAPID_HOST}"

def get(url, timeout=25, headers=None):
    try:
        h = headers or H
        req = Request(url, headers=h)
        with urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="ignore")
    except Exception as e:
        print(f"  FAIL {url[:65]}: {e}", file=sys.stderr)
        return ""

def rapid_get(path):
    """Call nosyapi endpoint"""
    url = f"{RAPID_BASE}{path}"
    headers = {
        "x-rapidapi-key":  RAPID_KEY,
        "x-rapidapi-host": RAPID_HOST,
        "Content-Type":    "application/json",
    }
    try:
        req = Request(url, headers=headers)
        with urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8", errors="ignore"))
    except Exception as e:
        print(f"  nosyapi FAIL {path}: {e}", file=sys.stderr)
        return None

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

# ── EXISTING WORKING FETCHERS (unchanged) ─────────────────────────────────────

def get_powerball():
    return parse_ny(ny_csv("d6yy-54nr"), 5, True)

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
        for col in ["Evening Winning Numbers", "Midday Winning Numbers", "Winning Numbers"]:
            wn = r.get(col, "").strip()
            if wn:
                nums = sorted([int(x) for x in wn.split() if x.isdigit() and 1 <= int(x) <= 39])
                if len(nums) == 5:
                    seen.add(dd)
                    out.append({"date": fmt(dd), "nums": nums, "spec": None, "jackpot": ""})
                    break
        if len(out) >= 15: break
    return out

def get_ny_lotto():
    return parse_ny(ny_csv("6nbc-h7bj"), 6, False)

def get_millionaire():
    return parse_ny(ny_csv("a4w9-a3tp"), 5, False, "$1M/year")

# ── NEW: nosyapi fetcher ───────────────────────────────────────────────────────

def parse_nosyapi_draws(data, game_name, n_main, has_spec):
    """Parse draws from nosyapi response"""
    out = []
    if not data: return out

    # nosyapi returns: {"status":"success","data":{"gameName":"...","results":[...]}}
    results = []
    if isinstance(data, dict):
        d = data.get("data", data)
        results = d.get("results", d.get("draws", d.get("data", [])))
    elif isinstance(data, list):
        results = data

    for r in results:
        try:
            # Date field
            dd = r.get("drawDate", r.get("date", r.get("draw_date", "")))
            # Numbers - various field names
            nums_raw = r.get("numbers", r.get("winningNumbers", r.get("winning_numbers", [])))
            spec_raw = r.get("bonusNumber", r.get("bonus", r.get("specialBall", r.get("starBall", None))))

            # Parse numbers
            if isinstance(nums_raw, list):
                nums = sorted([int(x) for x in nums_raw if str(x).isdigit()])
            elif isinstance(nums_raw, str):
                nums = sorted([int(x) for x in nums_raw.split() if x.isdigit()])
            else:
                continue

            # For 2by2: has white and red balls separately
            white = r.get("whiteBalls", r.get("white", []))
            red   = r.get("redBalls",   r.get("red",   []))
            if white and red:
                nums = sorted([int(x) for x in white])
                spec = sorted([int(x) for x in red])
                if len(nums) == 2 and len(spec) == 2:
                    out.append({"date": fmt(dd), "nums": nums, "spec": spec, "jackpot": "$22K"})
                continue

            if has_spec and spec_raw is not None:
                spec = int(str(spec_raw).strip()) if str(spec_raw).strip().isdigit() else None
            else:
                spec = None

            if len(nums) >= n_main:
                entry = {"date": fmt(dd), "nums": nums[:n_main], "spec": spec, "jackpot": ""}
                if has_spec and spec:
                    out.append(entry)
                elif not has_spec:
                    out.append(entry)
        except Exception as e:
            continue

    return out[:15]

def nosyapi_game(game_id, game_name, n_main, has_spec, jackpot=""):
    """Fetch a game from nosyapi by gameID"""
    # Try Past Draws endpoint first
    data = rapid_get(f"/lottery-results/old/past-draws-dates?gameID={game_id}")
    if not data:
        data = rapid_get(f"/lottery-results/drawing-result?gameID={game_id}")
    out = parse_nosyapi_draws(data, game_name, n_main, has_spec)
    if out and jackpot:
        for item in out: item["jackpot"] = jackpot
    return out

def discover_game_ids():
    """Fetch state game list to find game IDs for our target games"""
    print("  Discovering game IDs from nosyapi...")
    data = rapid_get("/lottery-results/state-game-list?stateCode=NH")
    if not data:
        # NH has Tri-State Megabucks and Gimme 5
        print("  NH game list failed, trying all states list...")
        data = rapid_get("/lottery-results/state-list")
    
    # Also try getting multi-state games
    ms_data = rapid_get("/lottery-results/powerball-mega-millions")
    
    # Try to find game IDs in the responses
    target_names = {
        'lotto america':    'lottoamerica',
        'lotto-america':    'lottoamerica', 
        '2by2':             '2by2',
        'two by two':       '2by2',
        'gimme 5':          'gimme5',
        'gimme5':           'gimme5',
        'gimme-5':          'gimme5',
        'tri-state megabucks': 'tristatemegabucks',
        'megabucks':        'tristatemegabucks',
    }
    
    game_ids = {}
    for response in [data, ms_data]:
        if not response: continue
        text = json.dumps(response).lower()
        # Look for gameID patterns
        matches = re.findall(r'"gameid"\s*:\s*(\d+)[^}]*?"gamename"\s*:\s*"([^"]+)"', text, re.IGNORECASE)
        matches += re.findall(r'"gamename"\s*:\s*"([^"]+)"[^}]*?"gameid"\s*:\s*(\d+)', text, re.IGNORECASE)
        for m in matches:
            gid, gname = (m[0], m[1]) if m[0].isdigit() else (m[1], m[0])
            for target, key in target_names.items():
                if target in gname.lower() and key not in game_ids:
                    game_ids[key] = int(gid)
                    print(f"    Found: {gname} → ID {gid} → {key}")
    
    return game_ids

def get_lotto_america_v2():
    """Try nosyapi first, fall back to HTML scraping"""
    # nosyapi gameID for Lotto America - typically 9 or similar
    for game_id in [9, 10, 11, 12, 13, 14]:
        data = rapid_get(f"/lottery-results/old/past-draws-dates?gameID={game_id}")
        if data:
            text = json.dumps(data).lower()
            if 'lotto america' in text or 'lottoamerica' in text:
                print(f"  Found Lotto America at gameID={game_id}")
                out = parse_nosyapi_draws(data, 'Lotto America', 5, True)
                if out: return out
    
    # HTML fallback
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
        main  = re.findall(r'<li>(\d+)</li>', balls_html)
        bonus = re.search(r'<li class="bonus">(\d+)</li>', balls_html)
        if main and bonus:
            dt   = datetime.strptime(date_iso, '%Y-%m-%d')
            nums = sorted([int(x) for x in main])
            out.append({"date": dt.strftime("%b %-d, %Y"), "nums": nums,
                        "spec": int(bonus.group(1)), "jackpot": ""})
    return out[:15]

def get_2by2_v2():
    """Try nosyapi first, fall back to HTML scraping"""
    for game_id in [1, 2, 3, 4, 5, 6, 7, 8]:
        data = rapid_get(f"/lottery-results/old/past-draws-dates?gameID={game_id}")
        if data:
            text = json.dumps(data).lower()
            if '2by2' in text or 'two by two' in text:
                print(f"  Found 2by2 at gameID={game_id}")
                out = parse_nosyapi_draws(data, '2by2', 2, False)
                if out: return out
    
    # HTML fallback
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
        reds   = [int(x) for x in re.findall(r'red-balls.*?<div>\s*(\d+)\s*</div>', balls_html, re.DOTALL)]
        whites = [int(x) for x in re.findall(r'white-balls.*?<div>\s*(\d+)\s*</div>', balls_html, re.DOTALL)]
        if len(reds) == 2 and len(whites) == 2:
            dt = datetime.strptime(date_iso, '%Y-%m-%d')
            out.append({"date": dt.strftime("%b %-d, %Y"),
                        "nums": sorted(reds), "spec": sorted(whites), "jackpot": "$22K"})
    return out

def get_megabucks_v2():
    """Tri-State Megabucks via nosyapi"""
    for game_id in range(1, 20):
        data = rapid_get(f"/lottery-results/old/past-draws-dates?gameID={game_id}")
        if data:
            text = json.dumps(data).lower()
            if 'megabucks' in text:
                print(f"  Found Megabucks at gameID={game_id}")
                return parse_nosyapi_draws(data, 'Megabucks', 6, False)
    return []

def get_gimme5_v2():
    """Gimme 5 via nosyapi"""
    for game_id in range(1, 20):
        data = rapid_get(f"/lottery-results/old/past-draws-dates?gameID={game_id}")
        if data:
            text = json.dumps(data).lower()
            if 'gimme' in text:
                print(f"  Found Gimme5 at gameID={game_id}")
                return parse_nosyapi_draws(data, 'Gimme5', 5, False)
    return []

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    ts = datetime.now(timezone.utc)
    print(f"LottoMind Fetcher v8 | {ts.strftime('%Y-%m-%d %H:%M UTC')}")

    existing = {}
    try:
        with open("results.json") as f: existing = json.load(f)
        print(f"Loaded existing results.json")
    except: print("Starting fresh")

    results = dict(existing)

    # First: discover game IDs from nosyapi
    print("\n[Discovering nosyapi game IDs...]")
    game_ids = discover_game_ids()
    print(f"  Discovered: {game_ids}")

    tasks = [
        ("powerball",          "Powerball",            get_powerball),
        ("megamillions",       "Mega Millions",         get_megamillions),
        ("ny_take5",           "NY Take 5",             get_take5),
        ("ny_lotto",           "NY Lotto",              get_ny_lotto),
        ("millionaireforlife", "Millionaire for Life",  get_millionaire),
        ("lottoamerica",       "Lotto America",         get_lotto_america_v2),
        ("2by2",               "2by2",                  get_2by2_v2),
        ("tristatemegabucks",  "Tri-State Megabucks",   get_megabucks_v2),
        ("gimme5",             "Gimme 5",               get_gimme5_v2),
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
    results["_source"]  = "GitHub Actions — v8 with nosyapi"

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    total = sum(len(v) for k, v in results.items() if isinstance(v, list))
    print(f"\n{'='*55}")
    print(f"OK    ({len(ok)}): {', '.join(ok)}")
    if empty: print(f"EMPTY ({len(empty)}): {', '.join(empty)}")
    print(f"Total draws: {total} | File: {len(json.dumps(results))} bytes")
    print(f"{'='*55}")

if __name__ == "__main__":
    main()
