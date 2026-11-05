from pathlib import Path
import re

src = Path(r"D:\数据库\scripts\make_signal_doc.py")
dst = Path(r"D:\数据库\scripts\make_signal_doc_recovered.py")
s = src.read_text(encoding="utf-8")
r = s.encode("gbk", errors="ignore").decode("utf-8", errors="replace")
r = re.sub(
    r'OUT = r".*?"',
    'OUT = r"D:\\\\数据库\\\\docs\\\\通俗说明-MOSS信号是怎么来的-v1.0.docx"',
    r,
    count=1,
)
dst.write_text(r, encoding="utf-8")
print(r[:500])
