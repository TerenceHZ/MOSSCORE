#!/usr/bin/env python3
"""MOSS CORE 服务端播报队列。

统一计算"当前该播哪个币"，让所有设备看到一致内容。
规则与客户端保持一致：
  · 左侧：胜率 >= 72 且 (stage == 'entry' 或 胜率 >= 82)
  · 右侧：自选 + 成交额 >= 200万 + 满足任一异动条件
  · 每个币播 5 分钟，最后一条播 15 分钟
  · 播完后 30 分钟冷却
"""

import json
import math
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

STATE_DB = Path(__file__).resolve().parent / "queue-state.db"
SLOT_MS = 5 * 60 * 1000
IDLE_MS = 15 * 60 * 1000
COOLDOWN_MS = 30 * 60 * 1000

_lock = threading.Lock()


def _now_ms():
    return int(time.time() * 1000)


def init():
    with sqlite3.connect(STATE_DB, timeout=10) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS played (
            side TEXT NOT NULL,
            symbol TEXT NOT NULL,
            played_at INTEGER NOT NULL,
            PRIMARY KEY (side, symbol)
        );
        CREATE TABLE IF NOT EXISTS slot (
            side TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            ends_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS last_played (
            side TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            played_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            side TEXT NOT NULL,
            symbol TEXT NOT NULL,
            played_at INTEGER NOT NULL,
            meta TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_history_side ON history(side, played_at DESC);
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            symbol TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            meta TEXT,
            UNIQUE(type, symbol, created_at)
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_time ON alerts(created_at DESC);
        """)


def calc_signal_win(r):
    """与客户端 calcSignal 的 win 计算完全一致。"""
    try:
        chg = float(r.get("change24h") or 0)
        oi5 = float(r.get("oi5m") or 0)
        oi15 = float(r.get("oi15m") or 0)
        vol = float(r.get("quoteVolume24h") or 0)
        score = float(r.get("score") or 0)
        pullback = float(r.get("pullback") or 0)
    except (TypeError, ValueError):
        return 20
    stage = r.get("stage") or "watch"
    win = 60 if stage == "entry" else (50 if stage == "watch" else 38)
    win += (score - 50) * 0.35
    win += max(-12, min(12, oi15 * 0.18))
    win += max(-6, min(6, oi5 * 0.25))
    if vol >= 5e7:
        win += 4
    elif vol >= 1e7:
        win += 2
    elif vol < 2e6:
        win -= 3
    if pullback > 10:
        win -= 4
    elif pullback < 3:
        win += 2
    if chg > 50:
        win -= 3
    return max(20, min(92, round(win)))


def left_qualifies(r):
    win = calc_signal_win(r)
    if win < 72:
        return False
    return (r.get("stage") == "entry") or win >= 82


def focus_hit(r):
    try:
        vol = float(r.get("quoteVolume24h") or 0)
        if vol < 2e6:
            return False
        return (
            abs(float(r.get("change24h") or 0)) >= 10
            or abs(float(r.get("oi15m") or 0)) >= 5
            or float(r.get("volRatio3m") or 0) >= 1.5
            or (float(r.get("largeUsdt") or 0) >= 5000 and float(r.get("largeMultiple") or 0) >= 20)
        )
    except (TypeError, ValueError):
        return False


def _load_played(db, side, now):
    rows = db.execute(
        "SELECT symbol, played_at FROM played WHERE side=?", (side,)
    ).fetchall()
    result = {}
    for sym, at in rows:
        if now - at < COOLDOWN_MS:
            result[sym] = at
    return result


def _prune(db, side, now):
    db.execute(
        "DELETE FROM played WHERE side=? AND played_at < ?",
        (side, now - COOLDOWN_MS),
    )


def compute_side(db, side, rows, now):
    """返回该侧当前应该播报的币。"""
    played = _load_played(db, side, now)
    slot = db.execute(
        "SELECT symbol, started_at, ends_at FROM slot WHERE side=?", (side,)
    ).fetchone()

    # 组建候选列表
    if side == "left":
        cands = [r for r in rows if left_qualifies(r)]
        cands.sort(key=lambda r: -calc_signal_win(r))
        def make_item(r):
            return {
                "symbol": r.get("symbol"),
                "win": calc_signal_win(r),
                "meta": {
                    "win": calc_signal_win(r),
                    "chg": r.get("change24h"),
                    "side": "long" if float(r.get("change24h") or 0) >= 0 else "short",
                    "score": r.get("score"),
                    "oi": r.get("oiNotional"),
                    "oi5": r.get("oi5m"),
                    "oi15": r.get("oi15m"),
                    "price": r.get("price"),
                    "target": None,
                    "stop": None,
                },
            }
    else:
        cands = [r for r in rows if r.get("focus") and focus_hit(r)]
        cands.sort(key=lambda r: -float(r.get("score") or 0))
        def make_item(r):
            oi15v = float(r.get("oi15m") or 0)
            oi = float(r.get("oiNotional") or 0)
            delta = oi * oi15v / (100 + oi15v) if oi else 0
            reasons = []
            if abs(float(r.get("change24h") or 0)) >= 10:
                reasons.append("24H %+.2f%%" % float(r.get("change24h") or 0))
            if abs(oi15v) >= 5:
                reasons.append("15M OI %+.2f%%" % oi15v)
            if float(r.get("volRatio3m") or 0) >= 1.5:
                reasons.append("3M 放量 %.1fx" % float(r.get("volRatio3m") or 0))
            if float(r.get("largeUsdt") or 0) >= 5000 and float(r.get("largeMultiple") or 0) >= 20:
                reasons.append("大单 %.1f万 %.0fx" % (float(r.get("largeUsdt") or 0) / 10000, float(r.get("largeMultiple") or 0)))
            return {
                "symbol": r.get("symbol"),
                "score": round(float(r.get("score") or 0), 1),
                "meta": {
                    "win": round(float(r.get("score") or 0)),
                    "chg": r.get("change24h"),
                    "side": "long" if float(r.get("change24h") or 0) >= 0 else "short",
                    "score": r.get("score"),
                    "oi": oi,
                    "oi5": r.get("oi5m"),
                    "oi15": oi15v,
                    "delta": delta,
                    "price": r.get("price"),
                    "vol24": r.get("quoteVolume24h"),
                    "reason": " · ".join(reasons) or "自选达标",
                },
            }

    pool = [make_item(r) for r in cands if r.get("symbol") not in played]

    # 当前槽位是否还有效（只要未到期就继续播，不因数据波动打断）
    if slot:
        sym, started_at, ends_at = slot
        if now < ends_at:
            return {
                "symbol": sym,
                "startedAt": started_at,
                "endsAt": ends_at,
                "remainingMs": ends_at - now,
                "queue": [c["symbol"] for c in pool if c["symbol"] != sym],
            }
        # 槽位到期 → 标记已播
        db.execute(
            "INSERT INTO played(side, symbol, played_at) VALUES(?,?,?) "
            "ON CONFLICT(side, symbol) DO UPDATE SET played_at=excluded.played_at",
            (side, sym, now),
        )
        db.execute("DELETE FROM slot WHERE side=?", (side,))
        played[sym] = now
        pool = [c for c in pool if c["symbol"] != sym]

    if not pool:
        # 无可用候选：返回最后一次播报的币，保证所有设备显示一致
        last = db.execute(
            "SELECT symbol, played_at FROM last_played WHERE side=?", (side,)
        ).fetchone()
        if last:
            return {
                "symbol": last[0],
                "startedAt": last[1],
                "endsAt": last[1],
                "remainingMs": 0,
                "queue": [],
                "stale": True,
            }
        return {"symbol": None, "queue": []}

    nxt = pool[0]
    # 队列里只有这一个候选：只锁定 5 分钟，好让后续新达标的币能及时插进来
    duration = SLOT_MS
    ends = now + duration
    db.execute(
        "INSERT INTO slot(side, symbol, started_at, ends_at) VALUES(?,?,?,?) "
        "ON CONFLICT(side) DO UPDATE SET symbol=excluded.symbol, "
        "started_at=excluded.started_at, ends_at=excluded.ends_at",
        (side, nxt["symbol"], now, ends),
    )
    db.execute(
        "INSERT INTO last_played(side, symbol, played_at) VALUES(?,?,?) "
        "ON CONFLICT(side) DO UPDATE SET symbol=excluded.symbol, played_at=excluded.played_at",
        (side, nxt["symbol"], now),
    )
    # 写播报历史（保留 meta 供客户端展示）
    meta = nxt.get("meta") or {}
    db.execute(
        "INSERT INTO history(side, symbol, played_at, meta) VALUES(?,?,?,?)",
        (side, nxt["symbol"], now, json.dumps(meta, ensure_ascii=False)),
    )
    return {
        "symbol": nxt["symbol"],
        "startedAt": now,
        "endsAt": ends,
        "remainingMs": duration,
        "queue": [c["symbol"] for c in pool[1:]],
    }


def build(snapshot_rows):
    """计算两侧队列，返回给客户端的结构。"""
    if not snapshot_rows:
        return {"ok": False, "error": "no_snapshot"}

    init()
    now = _now_ms()
    out = {"ok": True, "now": now, "updatedAt": datetime.now(timezone.utc).isoformat()}

    with _lock:
        with sqlite3.connect(STATE_DB, timeout=10) as db:
            db.execute("PRAGMA journal_mode=WAL")
            for side in ("left", "right"):
                _prune(db, side, now)
                out[side] = compute_side(db, side, snapshot_rows, now)
            db.commit()

    return out


def reset(side=None):
    """清空队列状态（管理员用）。"""
    init()
    with _lock:
        with sqlite3.connect(STATE_DB, timeout=10) as db:
            if side:
                db.execute("DELETE FROM played WHERE side=?", (side,))
                db.execute("DELETE FROM slot WHERE side=?", (side,))
                db.execute("DELETE FROM last_played WHERE side=?", (side,))
            else:
                db.execute("DELETE FROM played")
                db.execute("DELETE FROM slot")
                db.execute("DELETE FROM last_played")
                db.execute("DELETE FROM last_played")
            db.commit()
    return True


def get_history(side=None, limit=100):
    """返回播报历史，最新在前。"""
    init()
    with sqlite3.connect(STATE_DB, timeout=10) as db:
        db.row_factory = sqlite3.Row
        if side:
            rows = db.execute(
                "SELECT side, symbol, played_at, meta FROM history "
                "WHERE side=? ORDER BY played_at DESC LIMIT ?",
                (side, int(limit)),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT side, symbol, played_at, meta FROM history "
                "ORDER BY played_at DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            meta = json.loads(d.get("meta") or "{}")
        except Exception:
            meta = {}
        ts = d.get("played_at") or 0
        dt = datetime.fromtimestamp(ts / 1000.0, timezone.utc)
        out.append({
            "side": d.get("side"),
            "symbol": d.get("symbol"),
            "ts": ts,
            "time": dt.astimezone().strftime("%H:%M:%S"),
            "meta": meta,
        })
    return {"ok": True, "rows": out}


# ===== 三类异动事件（云端统一记录）=====
ALERT_TTL_MS = 24 * 60 * 60 * 1000
ALERT_MIN_GAP_MS = 10 * 60 * 1000   # 同币同类型 10 分钟内不重复


def detect_alerts(rows):
    """从快照中检测三类异动事件。"""
    out = []
    for r in rows or []:
        try:
            vol = float(r.get("quoteVolume24h") or 0)
            if vol < 2e6:
                continue
            sym = r.get("symbol")
            if not sym:
                continue

            oi15 = float(r.get("oi15m") or 0)
            oi5 = float(r.get("oi5m") or 0)
            vol_ratio = float(r.get("volRatio3m") or 0)
            large_usdt = float(r.get("largeUsdt") or 0)
            large_mult = float(r.get("largeMultiple") or 0)

            # 类型1：OI 异动
            if abs(oi15) >= 5 or abs(oi5) >= 3:
                pct = oi15 if abs(oi15) >= abs(oi5) else oi5
                oi = float(r.get("oiNotional") or 0)
                out.append({
                    "type": "oi",
                    "symbol": sym,
                    "meta": {
                        "pct": round(pct, 2),
                        "oi": oi,
                        "delta": round(abs(oi * pct / (100 + pct)) if pct else 0),
                        "price": r.get("price"),
                        "chg": r.get("change24h"),
                    },
                })

            # 类型2：大单
            if large_usdt >= 5000 and large_mult >= 20:
                out.append({
                    "type": "large",
                    "symbol": sym,
                    "meta": {
                        "usdt": large_usdt,
                        "multiple": large_mult,
                        "side": r.get("largeSide") or "",
                        "price": r.get("price"),
                        "chg": r.get("change24h"),
                    },
                })

            # 类型3：放量
            if vol_ratio >= 1.5:
                out.append({
                    "type": "volume",
                    "symbol": sym,
                    "meta": {
                        "ratio": round(vol_ratio, 2),
                        "chg3m": r.get("change3m"),
                        "price": r.get("price"),
                        "chg": r.get("change24h"),
                    },
                })
        except (TypeError, ValueError):
            continue
    return out


def record_alerts(rows):
    """把检测到的异动写入云端库（带去重和清理）。"""
    init()
    now = _now_ms()
    events = detect_alerts(rows)
    written = 0
    with _lock:
        with sqlite3.connect(STATE_DB, timeout=10) as db:
            db.execute("PRAGMA journal_mode=WAL")
            # 清理过期
            db.execute("DELETE FROM alerts WHERE created_at < ?", (now - ALERT_TTL_MS,))
            for ev in events:
                last = db.execute(
                    "SELECT created_at FROM alerts WHERE type=? AND symbol=? "
                    "ORDER BY created_at DESC LIMIT 1",
                    (ev["type"], ev["symbol"]),
                ).fetchone()
                if last and now - last[0] < ALERT_MIN_GAP_MS:
                    continue
                try:
                    db.execute(
                        "INSERT OR IGNORE INTO alerts(type, symbol, created_at, meta) VALUES(?,?,?,?)",
                        (ev["type"], ev["symbol"], now, json.dumps(ev["meta"], ensure_ascii=False)),
                    )
                    written += 1
                except Exception:
                    continue
            db.commit()
    return written


def get_alerts(limit=100, alert_type=None):
    """返回最近的异动事件。"""
    init()
    now = _now_ms()
    with sqlite3.connect(STATE_DB, timeout=10) as db:
        db.row_factory = sqlite3.Row
        db.execute("DELETE FROM alerts WHERE created_at < ?", (now - ALERT_TTL_MS,))
        if alert_type:
            rows = db.execute(
                "SELECT type, symbol, created_at, meta FROM alerts "
                "WHERE type=? ORDER BY created_at DESC LIMIT ?",
                (alert_type, int(limit)),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT type, symbol, created_at, meta FROM alerts "
                "ORDER BY created_at DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            meta = json.loads(d.get("meta") or "{}")
        except Exception:
            meta = {}
        ts = d.get("created_at") or 0
        dt = datetime.fromtimestamp(ts / 1000.0, timezone.utc)
        item = {
            "type": d.get("type"),
            "symbol": d.get("symbol"),
            "ts": ts,
            "time": dt.astimezone().strftime("%H:%M:%S"),
        }
        item.update(meta)
        out.append(item)
    return {"ok": True, "rows": out}
