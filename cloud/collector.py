#!/usr/bin/env python3
"""MOSS CORE central collector.

Polls public Binance USDⓈ-M futures data once every minute, keeps a snapshot
for all imported symbols, and serves it to trusted MOSS clients.

No API key is used. The HTTP endpoint requires a local bearer token.
"""
import json
import math
import os
import secrets
import signal
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WATCHLIST = ROOT / "watchlist.json"
TOKEN_FILE = ROOT / "token.txt"
SNAPSHOT_FILE = ROOT / "snapshot.json"
LOG_FILE = ROOT / "collector.log"

API = "https://fapi.binance.com"
FNG = "https://api.alternative.me/fng/?limit=2"
POLL_SECONDS = int(os.environ.get("MOSS_POLL", "60"))
PORT = int(os.environ.get("MOSS_PORT", "8787"))
BIND = os.environ.get("MOSS_BIND", "127.0.0.1")

_lock = threading.Lock()
_snapshot = None
_status = {"ok": False, "updatedAt": None, "lastError": None, "weight": None}
_cooldown_until = 0.0


def token():
    if TOKEN_FILE.exists():
        return TOKEN_FILE.read_text(encoding="utf-8").strip()
    value = secrets.token_urlsafe(32)
    TOKEN_FILE.write_text(value, encoding="utf-8")
    try:
        TOKEN_FILE.chmod(0o600)
    except OSError:
        pass
    return value


def log(msg):
    line = f"[{datetime.now().astimezone().isoformat(timespec='seconds')}] {msg}\n"
    try:
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        pass


def get_json(url, timeout=25):
    req = urllib.request.Request(url, headers={
        "User-Agent": "MOSS-CORE-Collector/1.0",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code in (418, 429):
            global _cooldown_until
            _cooldown_until = time.time() + 15 * 60
            log(f" Binance HTTP {e.code}; cooldown 15 minutes")
        raise


def n(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def pair(symbol):
    for quote in ("USDT", "USDC", "BUSD", "FDUSD"):
        if symbol.endswith(quote):
            return symbol[:-len(quote)] + "/" + quote
    return symbol


def load_watchlist():
    data = json.loads(WATCHLIST.read_text(encoding="utf-8"))
    imported = [s for s in data.get("symbols", data.get("imported", [])) if isinstance(s, str)]
    focus = [s for s in data.get("focus", []) if isinstance(s, str)]
    return imported, focus


def binance_rows(imported, focus):
    info = get_json(API + "/fapi/v1/exchangeInfo")
    meta = {}
    for s in info.get("symbols", []):
        if (s.get("contractType") == "PERPETUAL" and s.get("quoteAsset") == "USDT"
                and s.get("status") == "TRADING" and "TRADIFI" not in s.get("symbol", "")):
            meta[s["symbol"]] = s
    allowed = set(imported) if imported else set(meta)
    tickers = get_json(API + "/fapi/v1/ticker/24hr")
    rows = []
    for t in tickers:
        sym = t.get("symbol", "")
        if sym not in allowed or sym not in meta:
            continue
        volume = n(t.get("quoteVolume"))
        if volume <= 0:
            continue
        rows.append({
            "symbol": sym,
            "baseAsset": meta[sym].get("baseAsset", sym),
            "price": n(t.get("lastPrice")),
            "change24h": n(t.get("priceChangePercent")),
            "change1m": 0, "change5m": 0,
            "quoteVolume24h": volume,
            "oi": 0, "oiNotional": 0, "oi5m": 0, "oi15m": 0,
            "oi24h": 0, "oi24hDelta": 0,
            "pullback": 0, "score": 0, "stage": "low", "stageLabel": "观察",
            "focus": sym in set(focus),
            "volRatio3m": 0, "change3m": 0, "change30s": 0,
            "largeUsdt": 0, "largeMultiple": 0, "largeSide": "",
        })
    rows.sort(key=lambda r: r["quoteVolume24h"], reverse=True)
    return rows


def enrich(row):
    s = row["symbol"]
    p = row["price"]
    try:
        oi = get_json(API + "/fapi/v1/openInterest?symbol=" + urllib.parse.quote(s))
        row["oi"] = n(oi.get("openInterest"))
    except Exception:
        pass
    try:
        hist = get_json(API + "/futures/data/openInterestHist?symbol=" + urllib.parse.quote(s) + "&period=5m&limit=4")
        if isinstance(hist, list) and hist:
            last = n(hist[-1].get("sumOpenInterestValue"))
            row["oiNotional"] = last or row["oi"] * p
            if len(hist) >= 2:
                prev = n(hist[-2].get("sumOpenInterestValue"))
                if prev: row["oi5m"] = (last - prev) / prev * 100
            if len(hist) >= 4:
                prev = n(hist[0].get("sumOpenInterestValue"))
                if prev: row["oi15m"] = (last - prev) / prev * 100
    except Exception:
        pass
    if not row["oiNotional"] and row["oi"]:
        row["oiNotional"] = row["oi"] * p
    try:
        h = get_json(API + "/futures/data/openInterestHist?symbol=" + urllib.parse.quote(s) + "&period=1h&limit=25")
        if isinstance(h, list) and len(h) >= 2:
            now = n(h[-1].get("sumOpenInterestValue"))
            prev = n(h[0].get("sumOpenInterestValue"))
            if prev:
                row["oi24h"] = (now - prev) / prev * 100
                row["oi24hDelta"] = now - prev
    except Exception:
        pass
    try:
        k = get_json(API + "/fapi/v1/klines?symbol=" + urllib.parse.quote(s) + "&interval=1m&limit=48")
        if isinstance(k, list) and len(k) >= 48:
            vol = lambda i: n(k[i][5])
            cur = vol(45) + vol(46) + vol(47)
            avg = sum(vol(w * 3) + vol(w * 3 + 1) + vol(w * 3 + 2) for w in range(15)) / 15
            if avg: row["volRatio3m"] = cur / avg
            c0 = n(k[44][4])
            if c0: row["change3m"] = (n(k[47][4]) - c0) / c0 * 100
    except Exception:
        pass
    try:
        a = get_json(API + "/fapi/v1/aggTrades?symbol=" + urllib.parse.quote(s) + "&limit=1000")
        if isinstance(a, list) and a:
            total = 0.0
            mx = 0.0
            side = ""
            last_t = 0
            for t in a:
                notional = n(t.get("p")) * n(t.get("q"))
                total += notional
                if notional > mx:
                    mx = notional
                    side = "sell" if t.get("m") else "buy"
                last_t = max(last_t, int(n(t.get("T"))))
            avg = total / len(a)
            row["largeUsdt"] = mx
            row["largeSide"] = side
            if avg: row["largeMultiple"] = mx / avg
            if last_t:
                last_price = n(a[-1].get("p"))
                first = next((t for t in a if int(n(t.get("T"))) >= last_t - 30000), None)
                if first:
                    p0 = n(first.get("p"))
                    if p0: row["change30s"] = (last_price - p0) / p0 * 100
    except Exception:
        pass
    row["score"] = max(0, min(100, 50 + row["change24h"] * .7 + row["oi15m"] * .6 + (8 if row["quoteVolume24h"] > 1e8 else 4)))
    row["stage"] = "entry" if row["score"] >= 72 else "watch" if row["score"] >= 55 else "low"
    row["stageLabel"] = {"entry": "开仓信号", "watch": "重点候选", "low": "观察"}[row["stage"]]


def fetch_fng():
    try:
        j = get_json(FNG)
        data = j.get("data", [])
        if not data:
            return None
        a = data[0]
        b = data[1] if len(data) > 1 else a
        ts = int(n(a.get("timestamp")))
        date = datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().strftime("%m-%d")
        return {"value": int(n(a.get("value"))), "label": a.get("value_classification", ""),
                "previous": int(n(b.get("value"))), "date": date}
    except Exception:
        return None


def collect():
    global _snapshot
    if time.time() < _cooldown_until:
        return
    started = time.time()
    imported, focus = load_watchlist()
    rows = binance_rows(imported, focus)
    # Keep details for the 12 largest focus symbols plus the 3 gainers / 3 losers.
    by_vol = sorted(rows, key=lambda r: r["quoteVolume24h"], reverse=True)
    focus_rows = [r for r in by_vol if r["symbol"] in set(focus)][:12]
    movers = sorted(rows, key=lambda r: r["change24h"], reverse=True)[:3] + sorted(rows, key=lambda r: r["change24h"])[:3]
    detail = {}
    for r in focus_rows + movers:
        detail[r["symbol"]] = r
    for r in detail.values():
        enrich(r)
    rows.sort(key=lambda r: r["score"], reverse=True)
    payload = {
        "updatedAt": datetime.now().astimezone().strftime("%H:%M:%S"),
        "source": "BINANCE USDⓈ-M FUTURES · CLOUD",
        "rows": rows,
        "fearGreed": fetch_fng(),
    }
    tmp = SNAPSHOT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp.replace(SNAPSHOT_FILE)
    with _lock:
        _snapshot = payload
        _status.update(ok=True, updatedAt=payload["updatedAt"], lastError=None)
    log(f"snapshot rows={len(rows)} focus={len(focus)} detail={len(detail)} elapsed={time.time()-started:.1f}s")


def poll_loop():
    while True:
        try:
            collect()
        except Exception as e:
            with _lock:
                _status.update(ok=False, lastError=str(e)[:300])
            log(f"ERROR {e}")
        wait = max(15, POLL_SECONDS)
        if time.time() < _cooldown_until:
            wait = max(wait, int(_cooldown_until - time.time()) + 1)
        time.sleep(wait)


class Handler(BaseHTTPRequestHandler):
    server_version = "MOSSCoreCollector/1.0"

    def log_message(self, *args):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            with _lock:
                self.send_json({"ok": _status["ok"], "updatedAt": _status["updatedAt"], "lastError": _status["lastError"]})
            return
        if self.path != "/snapshot":
            self.send_json({"error": "not found"}, 404)
            return
        auth = self.headers.get("Authorization", "")
        supplied = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not supplied:
            supplied = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("token", [""])[0]
        if not supplied or supplied != token():
            self.send_json({"error": "unauthorized"}, 401)
            return
        with _lock:
            snap = _snapshot
        if snap is None:
            self.send_json({"error": "not ready"}, 503)
            return
        self.send_json(snap)


def main():
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    token()
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()
    log(f"collector started bind={BIND}:{PORT} poll={POLL_SECONDS}s")
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
