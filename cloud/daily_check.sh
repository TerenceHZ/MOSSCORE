#!/bin/bash
# MOSS CORE 每日自检（由 cron 调用）
LOG=/opt/moss-core/healthcheck-cron.log

{
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') ====="
  python3 /opt/moss-core/healthcheck.py
  RC=$?
  if [ $RC -ne 0 ]; then
    echo "!! SELF CHECK FAILED (rc=$RC)"
  fi
} >> "$LOG" 2>&1

# 日志超过 1MB 就清空
if [ -f "$LOG" ] && [ $(stat -c%s "$LOG") -gt 1048576 ]; then
  tail -200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
