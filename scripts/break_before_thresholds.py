from docx import Document
from docx.enum.text import WD_BREAK
from pathlib import Path

path = Path(r"D:\数据库\docs\通俗说明-MOSS信号是怎么来的-v1.0.docx")
doc = Document(path)

for p in doc.paragraphs:
    if p.text.strip().startswith("04 "):
        # Avoid adding a second break if one already precedes the heading.
        prev = p._p.getprevious()
        if prev is not None and prev.xpath('.//w:br[@w:type="page"]'):
            break
        br = p.insert_paragraph_before()
        br.add_run().add_break(WD_BREAK.PAGE)
        break

doc.save(path)
print("ADDED 04 BREAK")
