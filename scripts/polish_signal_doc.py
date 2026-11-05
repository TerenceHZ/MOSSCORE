from docx import Document
from docx.enum.text import WD_BREAK
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from pathlib import Path

path = Path(r"D:\数据库\docs\通俗说明-MOSS信号是怎么来的-v1.0.docx")
doc = Document(path)

# 1) Start key sections on a fresh page so a table does not begin
#    detached from its heading.
for p in doc.paragraphs:
    text = p.text.strip()
    if text.startswith("05 ") or text.startswith("07 "):
        br = p.insert_paragraph_before()
        br.add_run().add_break(WD_BREAK.PAGE)

# 2) Remove the trailing caveat page; the same caveats are already
#    covered on the cover and under the stage table.
paras = doc.paragraphs
cut = None
for i, p in enumerate(paras):
    if "没有数据就用 0 代替" in p.text:
        cut = i
        break
if cut is not None:
    for p in paras[cut + 1:]:
        p._element.getparent().remove(p._element)

# 3) Keep table rows intact.
for table in doc.tables:
    for row in table.rows:
        trPr = row._tr.get_or_add_trPr()
        cant = OxmlElement("w:cantSplit")
        trPr.append(cant)

doc.save(path)
print("POLISHED", path)
