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

import license_core

ROOT = Path(__file__).resolve().parent
WATCHLIST = ROOT / "watchlist.json"
TOKEN_FILE = ROOT / "token.txt"
SNAPSHOT_FILE = ROOT / "snapshot.json"
LOG_FILE = ROOT / "collector.log"
ADMIN_FILE = ROOT / "admin.txt"

ADMIN_SESSIONS = {}
ADMIN_LOCK = threading.Lock()


def admin_password():
    if ADMIN_FILE.exists():
        return ADMIN_FILE.read_text(encoding="utf-8").strip()
    password = secrets.token_urlsafe(18)
    ADMIN_FILE.write_text(password, encoding="utf-8")
    try:
        ADMIN_FILE.chmod(0o600)
    except OSError:
        pass
    return password


def admin_cookie_ok(header):
    for part in (header or "").split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        if key.strip() != "moss_admin":
            continue
        with ADMIN_LOCK:
            expires = ADMIN_SESSIONS.get(value.strip())
            if expires and expires > time.time():
                return True
    return False


def admin_login_page(error=""):
    err = f'<div class="err">{error}</div>' if error else ""
    return f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MOSS CORE · 管理后台</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;background:#05070a;color:#ece5d5;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
.wrap{{max-width:430px;margin:12vh auto;padding:28px;border:1px solid #3b3324;background:#090c10;box-shadow:0 0 60px #000}}
h1{{margin:0 0 6px;color:#e8a020;font:600 22px Consolas,monospace;letter-spacing:.08em}}
p{{color:#827664;margin:0 0 22px}} label{{display:block;color:#b8aa91;margin:14px 0 6px}}
input{{width:100%;padding:12px;background:#11151a;border:1px solid #3b3324;color:#fff;font:15px Consolas,monospace;outline:none}}
button{{margin-top:18px;width:100%;padding:12px;border:0;background:#e8a020;color:#171006;font-weight:700;cursor:pointer}}
.err{{margin:12px 0;padding:10px;border:1px solid #8a3b33;color:#e08a7f;background:#1a0d0b}}
</style><div class="wrap"><h1>MOSS CORE</h1><p>邀请码管理后台 · 仅限管理员</p>{err}
<form method="post" action="/admin/login"><label>管理员密码</label>
<input type="password" name="password" autofocus autocomplete="current-password">
<button type="submit">进入后台</button></form></div></html>"""


def admin_dashboard():
    return """<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MOSS CORE · 管理后台</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#05070a;color:#ece5d5;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.wrap{max-width:960px;margin:36px auto;padding:0 20px}h1{color:#e8a020;font:600 23px Consolas,monospace;letter-spacing:.08em;margin:0 0 6px}
.sub{color:#827664;margin-bottom:24px}.panel{border:1px solid #3b3324;background:#090c10;padding:20px;margin-bottom:18px}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:end}label{display:block;color:#b8aa91;margin-bottom:6px;font-size:12px}
input,select{padding:10px;background:#11151a;border:1px solid #3b3324;color:#fff;font:13px Consolas,monospace}
button{padding:10px 18px;border:0;background:#e8a020;color:#171006;font-weight:700;cursor:pointer}
button.ghost{background:#171b20;color:#c9bda6;border:1px solid #3b3324}
#code{margin-top:16px;padding:12px 14px;border:1px dashed #8a6a2a;background:#12100a;color:#ffc043;font:700 20px Consolas,monospace;letter-spacing:.08em;display:none;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
#code.visible{display:flex}
#code .code-value{word-break:break-all}
button.copy{padding:7px 10px;font-size:11px;font-weight:500;background:#2a2113;color:#e8c27a;border:1px solid #6b5225;white-space:nowrap}
button.copy:hover{background:#3a2c16;color:#ffe0a0}
button.copy:disabled{opacity:.35;cursor:default}
button.toggle{background:#172019;color:#9dd8b3;border-color:#315c43}
button.toggle:hover{background:#1c2b21;color:#c5f3d8}
button.danger{background:#241313;color:#e0a39b;border-color:#66332d}
button.danger:hover{background:#331919;color:#ffc7bd}
td.actions{white-space:nowrap}td.actions button{margin-right:5px}
.table-wrap{width:100%;overflow-x:auto}
table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;min-width:760px}th,td{text-align:left;padding:9px 8px;border-bottom:1px solid #1f2328;white-space:nowrap}
td.code-cell{font-family:Consolas,monospace;color:#e5c27e;letter-spacing:.04em}td.muted-cell{color:#6f6352}
th{color:#827664;font-weight:500}.hint{color:#827664;font-size:12px}.err{color:#e08a7f}
</style>
<div class="wrap"><h1>MOSS CORE · 管理后台</h1><div class="sub">生成邀请码 · 查看设备 · 解绑换机</div>
<div class="panel"><div class="row"><div><label>有效期（天）</label><input id="days" type="number" value="365" min="1" style="width:130px"></div>
<div><label>可绑定设备数</label><input id="devices" type="number" value="1" min="1" style="width:130px"></div>
<button onclick="createCode()">生成邀请码</button><button class="ghost" onclick="loadList()">刷新列表</button>
<button class="ghost" onclick="logout()">退出</button></div><div id="code"><span class="code-value" id="codeText"></span><button class="copy" id="copyGenerated" onclick="copyGenerated()">复制</button></div></div>
<div class="panel"><div class="row"><div style="flex:1"><label>解绑邀请码</label><input id="resetCode" placeholder="MOSS-XXXX-XXXX-XXXX" style="width:100%"></div>
<button onclick="resetCode()">解绑旧设备</button></div><div class="hint" style="margin-top:10px">解绑后该码可以给新电脑重新激活。</div></div>
<div class="panel"><div class="row" style="justify-content:space-between"><b>邀请码列表</b><span class="hint">完整邀请码仅管理员可见，可直接复制</span></div>
<div class="table-wrap"><table><thead><tr><th>ID</th><th>邀请码</th><th>设备数</th><th>有效期</th><th>状态</th><th>已绑定</th><th>操作</th></tr></thead><tbody id="list"></tbody></table></div></div></div>
<script>
async function api(path, body){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  if(r.status===401){location='/admin';throw new Error('unauthorized')}
  return await r.json();
}
async function copyText(text, btn){
  try{
    await navigator.clipboard.writeText(text);
  }catch(e){
    const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
  }
  const old=btn.textContent;btn.textContent='已复制';setTimeout(()=>btn.textContent=old,1400);
}
let generatedCode='';
async function createCode(){
  const el=document.getElementById('code');el.classList.remove('visible');
  const days=Number(document.getElementById('days').value||365);
  const devices=Number(document.getElementById('devices').value||1);
  const r=await api('/admin/api/create',{days,devices});
  if(!r.ok){document.getElementById('codeText').textContent='生成失败：'+(r.error||'unknown');el.classList.add('visible');return}
  generatedCode=r.code;
  document.getElementById('codeText').textContent=r.code;
  el.classList.add('visible');loadList();
}
async function copyGenerated(){
  if(!generatedCode)return;
  await copyText(generatedCode,document.getElementById('copyGenerated'));
}
async function resetCode(){
  const code=document.getElementById('resetCode').value.trim();
  if(!code)return alert('请输入完整邀请码');
  if(!confirm('确定解绑这个邀请码的所有旧设备？'))return;
  const r=await api('/admin/api/reset',{code});
  alert(r.ok?'已解绑，可以让新电脑重新激活':'未找到该邀请码');loadList();
}
async function toggleCode(id, revoked){
  const enabled=!!revoked;
  if(!confirm(enabled?'确定启用这个邀请码？':'停用后，该码绑定的客户端会立即失效。确定停用？'))return;
  const r=await api('/admin/api/toggle',{id,enabled});
  alert(r.ok?(enabled?'已启用':'已停用'):'操作失败');loadList();
}
async function deleteCode(id){
  if(!confirm('确定永久删除这个邀请码？\\n绑定设备会立即失效，且无法恢复。'))return;
  const r=await api('/admin/api/delete',{id});
  alert(r.ok?'已删除':'删除失败');loadList();
}
async function loadList(){
  const r=await api('/admin/api/list',{});
  const tb=document.getElementById('list');tb.innerHTML='';
  for(const c of (r.codes||[])){
    const tr=document.createElement('tr');
    const id=document.createElement('td');id.textContent=c.id;tr.appendChild(id);
    const codeTd=document.createElement('td');codeTd.className='code-cell';
    const full=c.code_plain||'';
    codeTd.textContent=full||`旧码 · 仅后四位 ${c.code_hint}`;
    if(!full)codeTd.classList.add('muted-cell');
    tr.appendChild(codeTd);
    for(const v of [c.max_devices,c.expires_at?new Date(c.expires_at).toLocaleDateString():'永久',c.revoked?'停用':'启用',c.active_devices]){
      const td=document.createElement('td');td.textContent=v==null?'':v;tr.appendChild(td);
    }
    const op=document.createElement('td');op.className='actions';
    const btn=document.createElement('button');btn.className='copy';btn.textContent='复制';btn.disabled=!full;
    if(full)btn.addEventListener('click',()=>copyText(full,btn));
    op.appendChild(btn);
    const toggle=document.createElement('button');toggle.className='copy toggle';toggle.textContent=c.revoked?'启用':'停用';
    toggle.addEventListener('click',()=>toggleCode(c.id,!!c.revoked));
    op.appendChild(toggle);
    const del=document.createElement('button');del.className='copy danger';del.textContent='删除';
    del.addEventListener('click',()=>deleteCode(c.id));
    op.appendChild(del);
    tr.appendChild(op);
    tb.appendChild(tr);
  }
}
async function logout(){await fetch('/admin/logout',{method:'POST'});location='/admin'}
loadList();
</script></html>"""


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

    def send_html(self, text, code=200):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/admin/login":
            try:
                length = int(self.headers.get("Content-Length", "0") or 0)
                raw = self.rfile.read(length).decode("utf-8") if length else ""
                form = urllib.parse.parse_qs(raw)
                password = form.get("password", [""])[0]
                if not secrets.compare_digest(password, admin_password()):
                    self.send_html(admin_login_page("密码错误"), 401)
                    return
                token = secrets.token_urlsafe(24)
                with ADMIN_LOCK:
                    ADMIN_SESSIONS[token] = time.time() + 8 * 3600
                self.send_response(303)
                self.send_header("Set-Cookie", f"moss_admin={token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800")
                self.send_header("Location", "/admin")
                self.send_header("Content-Length", "0")
                self.end_headers()
            except Exception:
                self.send_html(admin_login_page("登录失败"), 400)
            return
        if path == "/admin/logout":
            self.send_response(303)
            self.send_header("Set-Cookie", "moss_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0")
            self.send_header("Location", "/admin")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path.startswith("/admin/api/"):
            if not admin_cookie_ok(self.headers.get("Cookie", "")):
                self.send_json({"ok": False, "error": "unauthorized"}, 401)
                return
            try:
                length = int(self.headers.get("Content-Length", "0") or 0)
                data = json.loads(self.rfile.read(length).decode("utf-8") or "{}") if length else {}
            except Exception:
                self.send_json({"ok": False, "error": "invalid_json"}, 400)
                return
            if path == "/admin/api/create":
                code = license_core.create_code(
                    max(1, int(data.get("devices", 1))),
                    max(1, int(data.get("days", 365))),
                )
                self.send_json({"ok": True, "code": code})
                return
            if path == "/admin/api/list":
                self.send_json({"ok": True, "codes": license_core.list_codes()})
                return
            if path == "/admin/api/reset":
                ok = license_core.reset_code(str(data.get("code", "")))
                self.send_json({"ok": ok})
                return
            if path == "/admin/api/toggle":
                try:
                    code_id = int(data.get("id"))
                except (TypeError, ValueError):
                    self.send_json({"ok": False, "error": "invalid_id"}, 400)
                    return
                ok = license_core.set_code_status(code_id, bool(data.get("enabled")))
                self.send_json({"ok": ok})
                return
            if path == "/admin/api/delete":
                try:
                    code_id = int(data.get("id"))
                except (TypeError, ValueError):
                    self.send_json({"ok": False, "error": "invalid_id"}, 400)
                    return
                ok = license_core.delete_code(code_id)
                self.send_json({"ok": ok})
                return
            self.send_json({"ok": False, "error": "not found"}, 404)
            return
        try:
            if "chunked" in (self.headers.get("Transfer-Encoding", "").lower()):
                parts = []
                while True:
                    line = self.rfile.readline().strip()
                    if not line:
                        break
                    size = int(line.split(b";", 1)[0], 16)
                    if size == 0:
                        self.rfile.readline()
                        break
                    parts.append(self.rfile.read(size))
                    self.rfile.read(2)
                body = b"".join(parts)
            else:
                length = int(self.headers.get("Content-Length", "0") or 0)
                body = self.rfile.read(length) if length else b"{}"
            data = json.loads(body.decode("utf-8") or "{}")
        except Exception as e:
            log(f"POST parse error: {e}")
            self.send_json({"ok": False, "error": "invalid_json"}, 400)
            return
        path = urllib.parse.urlparse(self.path).path
        if path == "/license/activate":
            code = str(data.get("code", "")).strip()
            device_id = str(data.get("device_id", "")).strip()
            device_name = str(data.get("device_name", "")).strip()
            result, status = license_core.activate(code, device_id, device_name)
            self.send_json(result, status)
            return
        if path == "/license/validate":
            key = str(data.get("license", "")).strip()
            row = license_core.validate_license(key)
            if row is None:
                self.send_json({"ok": False, "error": "invalid_license"}, 401)
            else:
                self.send_json({"ok": True, "expires_at": row["code_expires_at"], "device_id": row["device_id"]})
            return
        if path == "/license/release":
            key = str(data.get("license", "")).strip()
            ok = license_core.release(key)
            self.send_json({"ok": ok}, 200 if ok else 404)
            return
        self.send_json({"error": "not found"}, 404)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/admin":
            if admin_cookie_ok(self.headers.get("Cookie", "")):
                self.send_html(admin_dashboard())
            else:
                self.send_html(admin_login_page())
            return
        if path == "/health":
            with _lock:
                self.send_json({"ok": _status["ok"], "updatedAt": _status["updatedAt"], "lastError": _status["lastError"]})
            return
        if path != "/snapshot":
            self.send_json({"error": "not found"}, 404)
            return
        auth = self.headers.get("Authorization", "")
        supplied = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        if not supplied:
            supplied = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("token", [""])[0]
        if not supplied or (supplied != token() and license_core.validate_license(supplied) is None):
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
    admin_password()
    license_core.init()
    t = threading.Thread(target=poll_loop, daemon=True)
    t.start()
    log(f"collector started bind={BIND}:{PORT} poll={POLL_SECONDS}s")
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
