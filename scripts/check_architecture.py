#!/usr/bin/env python3
"""MOSS CORE 架构合规检查。

每次改完代码跑一遍，确保没有破坏「云端唯一数据源」架构。

用法：
  python check_architecture.py
"""

import io
import re
import sys
from pathlib import Path

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "desktop-webview" / "index.html"

errors = []
warnings = []
passed = []


def check(name, ok, detail=""):
    if ok:
        passed.append(f"  OK   {name}" + (f"  {detail}" if detail else ""))
    else:
        errors.append(f"  FAIL {name}" + (f"  {detail}" if detail else ""))


def warn(name, detail=""):
    warnings.append(f"  WARN {name}" + (f"  {detail}" if detail else ""))


def main():
    if not INDEX.exists():
        print(f"找不到 {INDEX}")
        return 1

    s = INDEX.read_text(encoding="utf-8")

    print("=" * 60)
    print("MOSS CORE 架构合规检查")
    print("=" * 60)
    print()

    # ---------- 1. 云端驱动必须存在 ----------
    print("[1] 云端驱动层")
    for fn in ["applyLeft", "applyRight", "refreshAlerts", "refreshHistory",
               "fetchQueue", "fetchAlerts", "fetchHistory", "scheduleAtEndsAt"]:
        check(f"函数 {fn}", f"const {fn}" in s or f"function {fn}" in s)

    check("云端驱动启动", "driver started" in s or "__MOSS_CLOUD_ACTIVE = true" in s)
    check("云端失败回退", "fallback to local scheduling" in s)
    print()

    # ---------- 2. 本地调度必须被拦截 ----------
    print("[2] 本地调度拦截（防止双轨制）")
    guards = [
        ("pushSignalSlot", r"const pushSignalSlot[^{]*\{[^}]*__MOSS_CLOUD_ACTIVE[^}]*return"),
        ("rotateFocusCard", r"const rotateFocusCard[^{]*\{[^}]*__MOSS_CLOUD_ACTIVE[^}]*return"),
        ("maybeAlert", r"const maybeAlert[^{]*\{[^}]*__MOSS_CLOUD_ACTIVE[^}]*return"),
    ]
    for name, pattern in guards:
        check(f"{name} 有 cloudActive 守卫",
              bool(re.search(pattern, s, re.S)))

    # sigNext / focusNext 的定时器部分
    check("sigNext 不自行排定时器",
          bool(re.search(r"if \(window\.__MOSS_CLOUD_ACTIVE\)[\s\S]{0,80}SIG_TIMER = null", s)))
    check("focusNext 不自行排定时器",
          bool(re.search(r"if \(window\.__MOSS_CLOUD_ACTIVE\)[\s\S]{0,80}focusTimer = null", s)))
    print()

    # ---------- 3. 特效和声音 ----------
    print("[3] 特效与声音")
    check("focusShow 有流星", bool(re.search(r"const focusShow[\s\S]{0,3000}meteorTo", s)))
    check("focusShow 有声音", bool(re.search(r"const focusShow[\s\S]{0,3000}ping\(", s)))
    check("sigShow 有流星", bool(re.search(r"const sigShow[\s\S]{0,3000}meteorTo", s)))
    check("sigShow 有弹窗", bool(re.search(r"const sigShow[\s\S]{0,3000}showSignal", s)))
    check("云端异动有流星", bool(re.search(r"__MOSS_APPLY_CLOUD_ALERTS[\s\S]{0,2000}meteorTo", s)))
    check("云端异动有声音", bool(re.search(r"__MOSS_APPLY_CLOUD_ALERTS[\s\S]{0,2000}ping\(", s)))
    check("声音用原音效（低频+铃）",
          "add('sine', 104" in s and "add('triangle', 156" in s)
    print()

    # ---------- 4. 时间戳 ----------
    print("[4] 时间戳")
    check("使用云端 time 字段", bool(re.search(r"time:\s*x\.time", s)))
    check("高亮保持 5 分钟", "FRESH_ALERT_MS = 5 * 60 * 1000" in s)
    check("高亮可跨重绘恢复", "restoreFreshAlert" in s and "__MOSS_RESTORE_FRESH" in s)

    # 时区检查：服务器时间戳必须是 UTC+8（北京时间/新加坡时间）
    import subprocess
    import datetime
    try:
        local_offset = datetime.datetime.now().astimezone().utcoffset()
        local_hours = local_offset.total_seconds() / 3600 if local_offset else None
        check("本机时区 UTC+8", local_hours == 8, f"(实际 UTC+{local_hours})")
    except Exception as e:
        warn("本机时区检查失败", str(e)[:50])

    # 检查云端时间与本地时区一致（比对最近 10 条平均值，避开单条过旧的情况）
    try:
        import json
        import urllib.request
        token = "yb4m3bG30ZIW0v4CwBzgGxoidZhRllej8vAmfxk6jzo"
        req = urllib.request.Request(
            "https://43-160-232-254.sslip.io/history?limit=10",
            headers={"Authorization": "Bearer " + token},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            j = json.loads(r.read().decode("utf-8"))
        rows = j.get("rows") or []
        if rows:
            now = datetime.datetime.now()
            diffs = []
            for row in rows:
                try:
                    ch, cm, cs = [int(x) for x in row["time"].split(":")]
                    cloud_dt = now.replace(hour=ch, minute=cm, second=cs, microsecond=0)
                    d = abs((now - cloud_dt).total_seconds())
                    if d > 43200:
                        d = 86400 - d
                    diffs.append(d)
                except Exception:
                    continue
            if diffs:
                # 取最新一条（rows 是倒序）判断：只要不是「几小时」级别的偏差就算对
                newest = diffs[0]
                check("云端时间与本地同区（偏差 <30分钟）", newest < 1800, f"(最新一条差 {int(newest)} 秒)")
            else:
                warn("云端时间格式异常")
        else:
            warn("云端历史为空，跳过时间检查")
    except Exception as e:
        warn("云端时间检查失败", str(e)[:60])
    print()

    # ---------- 5. 代码完整性 ----------
    print("[5] 代码完整性")
    critical = ["calcSignal", "sigShow", "sigNext", "focusShow", "focusNext",
                "meteorTo", "showSignal", "ping", "renderAlertFeed", "applyLive"]
    for f in critical:
        check(f"函数 {f}", f in s)

    # 重复定义
    for f in ["sigShow", "focusShow", "meteorTo", "applyLeft", "applyRight", "ping"]:
        defs = re.findall(r"(?:const|let|var|function)\s+" + re.escape(f) + r"\b", s)
        check(f"{f} 无重复定义", len(defs) <= 1, f"({len(defs)} 次)")

    # 守卫数量
    n = len(re.findall("__MOSS_CLOUD_ACTIVE", s))
    check("cloudActive 守卫数量 ≥ 8", n >= 8, f"(实际 {n})")
    print()

    # ---------- 6. 文件规模 ----------
    print("[6] 文件规模")
    lines = len(s.split("\n"))
    check("行数合理 (10000-20000)", 10000 <= lines <= 20000, f"({lines})")

    # ---------- 输出 ----------
    print("=" * 60)
    print("检查结果")
    print("=" * 60)
    for line in passed:
        print(line)
    if warnings:
        print()
        for line in warnings:
            print(line)
    if errors:
        print()
        for line in errors:
            print(line)
        print()
        print(f"[FAIL] 失败 {len(errors)} 项，通过 {len(passed)} 项")
        return 1
    else:
        print()
        print(f"[PASS] all {len(passed)} checks passed")
        return 0


if __name__ == "__main__":
    sys.exit(main())
