#!/usr/bin/env python3
"""MOSS CORE 架构合规检查。

每次改完代码跑一遍，确保没有破坏「云端唯一数据源」架构。

用法：
  python check_architecture.py
"""

import re
import sys
from pathlib import Path

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
        print(f"❌ 失败 {len(errors)} 项，通过 {len(passed)} 项")
        return 1
    else:
        print()
        print(f"✅ 全部通过（{len(passed)} 项）")
        return 0


if __name__ == "__main__":
    sys.exit(main())
