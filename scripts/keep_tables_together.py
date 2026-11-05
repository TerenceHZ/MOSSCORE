from docx import Document
from pathlib import Path

path = Path(r"D:\数据库\docs\通俗说明-MOSS信号是怎么来的-v1.0.docx")
doc = Document(path)

for table in doc.tables:
    rows = table.rows
    for row in rows[:-1]:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.paragraph_format.keep_with_next = True

doc.save(path)
print("KEEP TABLES")
