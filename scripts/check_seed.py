import json
p = r"D:\数据库\desktop-webview\live-seed.json"
with open(p, encoding="utf-8") as f:
    d = json.load(f)
print(d.get("updatedAt"), len(d.get("rows", [])))
