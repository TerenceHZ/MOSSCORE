from docx import Document
from pathlib import Path

path = Path(r"D:\数据库\docs\通俗说明-MOSS信号是怎么来的-v1.0.docx")
doc = Document(path)

paras = list(doc.paragraphs)
remove = []
for i, p in enumerate(paras):
    if i + 1 >= len(paras):
        continue
    nxt = paras[i + 1].text.strip()
    if not p.text.strip() and p._p.xpath('.//w:br[@w:type="page"]'):
        if nxt.startswith("05 ") or nxt.startswith("07 "):
            remove.append(p)
for p in remove:
    p._element.getparent().remove(p._element)

doc.save(path)
print("REMOVED", len(remove))
