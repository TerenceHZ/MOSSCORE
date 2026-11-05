from docx import Document
from docx.enum.text import WD_BREAK
from pathlib import Path

path = Path(r"D:\数据库\docs\通俗说明-MOSS信号是怎么来的-v1.0.docx")
doc = Document(path)

paras = list(doc.paragraphs)

# Remove the page-break paragraph immediately before section 05.
for i, p in enumerate(paras):
    if p.text.strip().startswith("05 "):
        prev = paras[i - 1] if i > 0 else None
        if prev is not None and not prev.text.strip():
            if prev._p.xpath('.//w:br[@w:type="page"]'):
                prev._element.getparent().remove(prev._element)
        break

# Start section 04 on a fresh page so its three-row threshold table is intact.
for p in doc.paragraphs:
    if p.text.strip().startswith("04 "):
        br = p.insert_paragraph_before()
        br.add_run().add_break(WD_BREAK.PAGE)
        break

doc.save(path)
print("ADJUSTED", path)
