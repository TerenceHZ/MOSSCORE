import json
from datetime import datetime

src = r"D:\数据库\reference\market-signals-api.json"
dst = r"D:\数据库\desktop-webview\live-seed.json"
with open(src, encoding="utf-8") as f:
    d = json.load(f)
rows = []
for r in d.get("rows", [])[:24]:
    symbol = r.get("symbol") or ""
    base = r.get("base_asset") or symbol.replace("USDT", "")
    oi = 0
    of = r.get("oi_focus_signal") or {}
    oi = of.get("open_interest_notional_usdt") or 0
    if not oi:
        cx = r.get("cross_exchange_positioning") or {}
        b = (cx.get("exchanges") or {}).get("binance") or {}
        oi = b.get("current_oi_notional_usdt") or 0
    horizon = r.get("oi_horizon_changes_pct") or {}
    oi5 = r.get("oi_5m_change_pct") or horizon.get("5m") or 0
    oi15 = horizon.get("15m") or 0
    raw_stage = (r.get("signal_level") or "").lower()
    stage = raw_stage if raw_stage in ("entry", "watch") else "low"
    focus = bool(r.get("user_selected_watch")) or bool((r.get("focus_attention_signal") or {}).get("active"))
    rows.append({
        "symbol": symbol,
        "baseAsset": base,
        "price": r.get("price") or 0,
        "change24h": r.get("change_24h_pct") or 0,
        "change1m": r.get("change_1m_pct") or 0,
        "change5m": r.get("change_5m_pct") or 0,
        "quoteVolume24h": r.get("quote_volume_24h_usdt") or 0,
        "oiNotional": oi,
        "oi5m": oi5,
        "oi15m": oi15,
        "pullback": r.get("pullback_pct") or 0,
        "score": r.get("score") or 0,
        "stage": stage,
        "stageLabel": r.get("state_label") or "",
        "focus": focus,
        "stateLabel": r.get("state_label") or "",
    })
out = {
    "updatedAt": datetime.now().strftime("%H:%M:%S"),
    "rows": rows,
}
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(dst, len(rows))
