#!/usr/bin/env python3
"""MOSS CORE 服务自检脚本。

检查采集器状态、磁盘、内存、抓取新鲜度，异常时返回非零退出码。
用法：
  python3 healthcheck.py          # 人类可读输出
  python3 healthcheck.py --json   # JSON 输出
"""

import json
import os
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

HEALTH_URL = "http://127.0.0.1:8787/health"
SERVICE = "moss-core-collector.service"
STALE_SECONDS = 300          # 快照超过 5 分钟未更新视为异常
DISK_WARN_PCT = 85           # 磁盘使用率告警线
MEM_WARN_MB = 450            # 进程内存告警线


def check_service():
    try:
        out = subprocess.run(
            ["systemctl", "is-active", SERVICE],
            capture_output=True, text=True, timeout=10
        ).stdout.strip()
        return out == "active", out
    except Exception as e:
        return False, str(e)[:80]


def check_health():
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        return True, data
    except Exception as e:
        return False, {"error": str(e)[:80]}


def parse_updated_at(value):
    """updatedAt 形如 '18:51:48'（本地时间）。"""
    if not value:
        return None
    try:
        now = datetime.now()
        h, m, s = (int(x) for x in value.split(":"))
        dt = now.replace(hour=h, minute=m, second=s, microsecond=0)
        if dt > now:
            dt = dt.replace(day=dt.day - 1)
        return (now - dt).total_seconds()
    except Exception:
        return None


def check_disk():
    try:
        total, used, free = shutil.disk_usage("/")
        pct = used * 100.0 / total if total else 0
        return pct < DISK_WARN_PCT, round(pct, 1)
    except Exception:
        return True, None


def check_memory():
    try:
        out = subprocess.run(
            ["systemctl", "show", SERVICE, "-p", "MemoryCurrent", "--value"],
            capture_output=True, text=True, timeout=10
        ).stdout.strip()
        if not out or out == "[not set]":
            return True, None
        mb = int(out) / (1024 * 1024)
        return mb < MEM_WARN_MB, round(mb, 1)
    except Exception:
        return True, None


def main():
    result = {"ok": True, "checks": {}, "at": datetime.now().isoformat(timespec="seconds")}

    svc_ok, svc_state = check_service()
    result["checks"]["service"] = {"ok": svc_ok, "state": svc_state}
    if not svc_ok:
        result["ok"] = False

    h_ok, h_data = check_health()
    result["checks"]["health"] = {"ok": h_ok, "data": h_data}
    if not h_ok or not h_data.get("ok", False):
        result["ok"] = False

    age = parse_updated_at(h_data.get("updatedAt") if isinstance(h_data, dict) else None)
    fresh = age is not None and age < STALE_SECONDS
    result["checks"]["freshness"] = {"ok": fresh, "age_seconds": int(age) if age else None}
    if age is not None and not fresh:
        result["ok"] = False

    if isinstance(h_data, dict) and h_data.get("lastError"):
        result["checks"]["last_error"] = {"ok": False, "error": h_data["lastError"]}
        result["ok"] = False

    d_ok, d_pct = check_disk()
    result["checks"]["disk"] = {"ok": d_ok, "used_pct": d_pct}
    if not d_ok:
        result["ok"] = False

    m_ok, m_mb = check_memory()
    result["checks"]["memory"] = {"ok": m_ok, "mb": m_mb}
    if not m_ok:
        result["ok"] = False

    if "--json" in sys.argv:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("=== MOSS CORE self check ===")
        for name, c in result["checks"].items():
            mark = "OK  " if c.get("ok") else "FAIL"
            print(f"  [{mark}] {name}: {c}")
        print("")
        print("RESULT:", "PASS" if result["ok"] else "FAIL")

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
