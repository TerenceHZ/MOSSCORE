import json
p = r"D:\数据库\reference\market-signals-api.json"
with open(p, encoding="utf-8") as f:
    d = json.load(f)
print(type(d), list(d.keys())[:30])
print("rows", len(d.get("rows", [])), "updated", d.get("updated_at"), "source", d.get("source_updated_at"))
for k in ["total", "rows_complete", "initial_preview", "preview_total_rows"]:
    print(k, d.get(k))
r = d["rows"][0]
print("row keys", sorted(r.keys()))
for k in sorted(r.keys()):
    v = r[k]
    if isinstance(v, (dict, list)):
        print(k, type(v).__name__, len(v), str(v)[:500])
    else:
        print(k, repr(v)[:500])
