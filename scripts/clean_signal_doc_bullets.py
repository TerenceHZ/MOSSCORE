from docx import Document
from pathlib import Path

path = Path(r"D:\数据库\docs\通俗说明-MOSS信号是怎么来的-v1.0.docx")
doc = Document(path)

for p in doc.paragraphs:
    if p.text.startswith("· "):
        for r in p.runs:
            if r.text.startswith("· "):
                r.text = r.text[2:]
                break

doc.save(path)
print("CLEANED BULLETS")
