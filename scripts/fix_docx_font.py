from docx import Document
from docx.oxml.ns import qn
from pathlib import Path

path = Path(r"D:\数据库\docs\通俗说明-MOSS信号是怎么来的-v1.0.docx")
doc = Document(path)


def fix_run(run):
    run.font.name = "Arial"
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.rFonts
    if rFonts is None:
        from docx.oxml import OxmlElement
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:ascii"), "Arial")
    rFonts.set(qn("w:hAnsi"), "Arial")
    rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")


def fix_paragraphs(paragraphs):
    for p in paragraphs:
        for r in p.runs:
            fix_run(r)


fix_paragraphs(doc.paragraphs)
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            fix_paragraphs(cell.paragraphs)
            for nested in cell.tables:
                for nrow in nested.rows:
                    for ncell in nrow.cells:
                        fix_paragraphs(ncell.paragraphs)
for section in doc.sections:
    fix_paragraphs(section.header.paragraphs)
    fix_paragraphs(section.footer.paragraphs)

# Normal style fallback.
normal = doc.styles["Normal"]
normal.font.name = "Arial"
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")

doc.save(path)
print("FIXED", path)
