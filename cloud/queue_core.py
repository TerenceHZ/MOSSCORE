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
        make_item = lambda r: {"symbol": r.get("symbol"), "win": calc_signal_win(r)}
    else:
        cands = [r for r in rows if r.get("focus") and focus_hit(r)]
        cands.sort(key=lambda r: -float(r.get("score") or 0))
        make_item = lambda r: {"symbol": r.get("symbol"), "score": round(float(r.get("score") or 0), 1)}

    pool = [make_item(r) for r in cands if r.get("symbol") not in played]

    # 当前槽位是否还有效
    if slot:
        sym, started_at, ends_at = slot
        if now < ends_at:
            still = any(c["symbol"] == sym for c in pool)
            if still:
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
        return {"symbol": None, "queue": []}

    nxt = pool[0]
    duration = SLOT_MS if len(pool) > 1 else IDLE_MS
    ends = now + duration
    db.execute(
        "INSERT INTO slot(side, symbol, started_at, ends_at) VALUES(?,?,?,?) "
        "ON CONFLICT(side) DO UPDATE SET symbol=excluded.symbol, "
        "started_at=excluded.started_at, ends_at=excluded.ends_at",
        (side, nxt["symbol"], now, ends),
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
            else:
                db.execute("DELETE FROM played")
                db.execute("DELETE FROM slot")
            db.commit()
    return True
