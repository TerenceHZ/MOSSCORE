#!/usr/bin/env python3
"""Invite-code licensing for MOSS CORE.

The public client only receives opaque device license keys. Invite codes and
license keys are stored as SHA-256 hashes in SQLite.
"""
import hashlib
import json
import secrets
import shutil
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent / "licenses.db"
BACKUP_DIR = Path(__file__).resolve().parent / "license-backups"


def backup():
    """Keep a timestamped copy before administrative changes/restarts."""
    try:
        if not DB_PATH.exists() or DB_PATH.stat().st_size < 4096:
            return
        BACKUP_DIR.mkdir(exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        shutil.copy2(DB_PATH, BACKUP_DIR / f"licenses-{stamp}.db")
        old = sorted(BACKUP_DIR.glob("licenses-*.db"))
        for item in old[:-20]:
            item.unlink(missing_ok=True)
    except Exception:
        pass


def now():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def parse(value):
    return datetime.fromisoformat(value)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_code(code):
    return "".join(ch for ch in str(code).upper() if ch.isalnum())


def connect():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code_hash TEXT NOT NULL UNIQUE,
            code_hint TEXT NOT NULL,
            max_devices INTEGER NOT NULL DEFAULT 1,
            expires_at TEXT,
            revoked INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS devices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code_id INTEGER NOT NULL,
            device_id TEXT NOT NULL,
            device_name TEXT NOT NULL DEFAULT '',
            license_hash TEXT NOT NULL UNIQUE,
            activated_at TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            revoked INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_devices_code ON devices(code_id);
        """)
        cols = {row["name"] for row in db.execute("PRAGMA table_info(codes)").fetchall()}
        if "code_plain" not in cols:
            db.execute("ALTER TABLE codes ADD COLUMN code_plain TEXT")
        if "features" not in cols:
            db.execute("ALTER TABLE codes ADD COLUMN features TEXT DEFAULT '{}'")


def create_code(max_devices=1, days=365):
    init()
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(12))
    code = "MOSS-" + "-".join(raw[i:i + 4] for i in range(0, 12, 4))
    expires = iso(now() + timedelta(days=days)) if days else None
    with connect() as db:
        db.execute(
            "INSERT INTO codes(code_hash, code_hint, code_plain, max_devices, expires_at, created_at) VALUES(?,?,?,?,?,?)",
            (digest(normalize_code(code)), code[-4:], code, int(max_devices), expires, iso(now())),
        )
    return code


def _code(db, code):
    return db.execute(
        "SELECT * FROM codes WHERE code_hash=?", (digest(normalize_code(code)),)
    ).fetchone()


def _expired(row):
    return bool(row["expires_at"] and parse(row["expires_at"]) <= now())


def activate(code, device_id, device_name=""):
    init()
    device_id = str(device_id).strip()
    if not code or not device_id:
        return {"ok": False, "error": "missing_code_or_device"}, 400
    with connect() as db:
        row = _code(db, code)
        if not row:
            return {"ok": False, "error": "invalid_code"}, 404
        if row["revoked"] or _expired(row):
            return {"ok": False, "error": "code_expired_or_revoked"}, 403
        existing = db.execute(
            "SELECT * FROM devices WHERE code_id=? AND device_id=? AND revoked=0",
            (row["id"], device_id),
        ).fetchone()
        if existing:
            license_key = secrets.token_urlsafe(32)
            db.execute(
                "UPDATE devices SET license_hash=?, last_seen=?, device_name=? WHERE id=?",
                (digest(license_key), iso(now()), device_name[:120], existing["id"]),
            )
            return {"ok": True, "license": license_key, "expires_at": row["expires_at"],
                    "device_id": device_id, "reactivated": True}, 200
        count = db.execute(
            "SELECT COUNT(*) n FROM devices WHERE code_id=? AND revoked=0", (row["id"],)
        ).fetchone()["n"]
        if count >= row["max_devices"]:
            return {"ok": False, "error": "already_bound"}, 409
        license_key = secrets.token_urlsafe(32)
        db.execute(
            "INSERT INTO devices(code_id, device_id, device_name, license_hash, activated_at, last_seen) VALUES(?,?,?,?,?,?)",
            (row["id"], device_id, device_name[:120], digest(license_key), iso(now()), iso(now())),
        )
        return {"ok": True, "license": license_key, "expires_at": row["expires_at"],
                "device_id": device_id, "reactivated": False}, 200


def validate_license(license_key):
    if not license_key:
        return None
    init()
    with connect() as db:
        row = db.execute(
            "SELECT d.*, c.revoked code_revoked, c.expires_at code_expires_at, c.features code_features "
            "FROM devices d JOIN codes c ON c.id=d.code_id WHERE d.license_hash=?",
            (digest(license_key),),
        ).fetchone()
        if not row or row["revoked"] or row["code_revoked"]:
            return None
        if row["code_expires_at"] and parse(row["code_expires_at"]) <= now():
            return None
        db.execute("UPDATE devices SET last_seen=? WHERE id=?", (iso(now()), row["id"]))
        return row


def set_code_feature(code_id, feature, enabled):
    """给某个邀请码开关一个功能（feature 如 'trade'）。"""
    init()
    backup()
    with connect() as db:
        row = db.execute("SELECT features FROM codes WHERE id=?", (int(code_id),)).fetchone()
        if not row:
            return False
        try:
            feats = json.loads(row["features"] or "{}")
        except Exception:
            feats = {}
        if not isinstance(feats, dict):
            feats = {}
        if enabled:
            feats[feature] = True
        else:
            feats.pop(feature, None)
        db.execute("UPDATE codes SET features=? WHERE id=?", (json.dumps(feats), int(code_id)))
        return True


def feature_of(row):
    """从 validate_license 返回的行里取出功能字典。"""
    try:
        feats = json.loads(row["code_features"] or "{}") if "code_features" in row.keys() else {}
    except Exception:
        feats = {}
    return feats if isinstance(feats, dict) else {}


def release(license_key):
    if not license_key:
        return False
    init()
    with connect() as db:
        row = db.execute(
            "SELECT id FROM devices WHERE license_hash=?", (digest(license_key),)
        ).fetchone()
        if not row:
            return False
        db.execute("UPDATE devices SET revoked=1 WHERE id=?", (row["id"],))
        return True


def reset_code(code):
    init()
    backup()
    with connect() as db:
        row = _code(db, code)
        if not row:
            return False
        db.execute("UPDATE devices SET revoked=1 WHERE code_id=?", (row["id"],))
        return True


def set_code_status(code_id, enabled):
    init()
    backup()
    with connect() as db:
        row = db.execute("SELECT id FROM codes WHERE id=?", (int(code_id),)).fetchone()
        if not row:
            return False
        db.execute("UPDATE codes SET revoked=? WHERE id=?", (0 if enabled else 1, int(code_id)))
        return True


def delete_code(code_id):
    init()
    backup()
    with connect() as db:
        row = db.execute("SELECT id FROM codes WHERE id=?", (int(code_id),)).fetchone()
        if not row:
            return False
        db.execute("DELETE FROM devices WHERE code_id=?", (int(code_id),))
        db.execute("DELETE FROM codes WHERE id=?", (int(code_id),))
        return True


def stats():
    init()
    current = now()
    online_cutoff = iso(current - timedelta(minutes=15))
    today_start = iso(current.replace(hour=0, minute=0, second=0, microsecond=0))
    with connect() as db:
        base = (
            "FROM devices d JOIN codes c ON c.id=d.code_id "
            "WHERE d.revoked=0 AND c.revoked=0 "
            "AND (c.expires_at IS NULL OR c.expires_at>?)"
        )
        active_devices = db.execute(
            "SELECT COUNT(*) n " + base, (iso(current),)
        ).fetchone()["n"]
        online = db.execute(
            "SELECT COUNT(*) n " + base + " AND d.last_seen>=?",
            (iso(current), online_cutoff),
        ).fetchone()["n"]
        new_today = db.execute(
            "SELECT COUNT(*) n " + base + " AND d.activated_at>=?",
            (iso(current), today_start),
        ).fetchone()["n"]
        total_codes = db.execute("SELECT COUNT(*) n FROM codes").fetchone()["n"]
        active_codes = db.execute(
            "SELECT COUNT(*) n FROM codes WHERE revoked=0 AND (expires_at IS NULL OR expires_at>?)",
            (iso(current),),
        ).fetchone()["n"]
        devices = [dict(r) for r in db.execute(
            "SELECT d.device_name,d.device_id,d.last_seen,d.activated_at,"
            "c.code_hint,c.code_plain FROM devices d JOIN codes c ON c.id=d.code_id "
            "WHERE d.revoked=0 AND c.revoked=0 AND (c.expires_at IS NULL OR c.expires_at>?) "
            "ORDER BY d.last_seen DESC LIMIT 200",
            (iso(current),),
        ).fetchall()]
    for d in devices:
        d["device_id"] = (d["device_id"] or "")[:12] + "…"
        d["code"] = d.pop("code_plain") or ("旧码 · " + d.pop("code_hint"))
        d.pop("code_hint", None)
        d["online"] = d["last_seen"] >= online_cutoff
    online_devices = [d for d in devices if d["online"]]
    return {
        "online": online,
        "active_devices": active_devices,
        "new_today": new_today,
        "active_codes": active_codes,
        "total_codes": total_codes,
        "online_devices": online_devices,
        "devices": devices,
        "window_minutes": 15,
    }


def list_codes():
    init()
    with connect() as db:
        return [dict(r) for r in db.execute(
            "SELECT c.id,c.code_hint,c.code_plain,c.max_devices,c.expires_at,c.revoked,c.created_at,c.features,"
            "(SELECT COUNT(*) FROM devices d WHERE d.code_id=c.id AND d.revoked=0) active_devices "
            "FROM codes c ORDER BY c.id DESC"
        ).fetchall()]
