from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_LINE_SPACING

OUT = r"D:\鏁版嵁搴揬docs\閫氫織璇存槑-MOSS淇″彿鏄€庝箞鏉ョ殑-v1.0.docx"

GOLD = RGBColor(0xB8, 0x86, 0x0B)
DARK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x59, 0x59, 0x59)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
RED = RGBColor(0xA8, 0x3A, 0x2A)
GREEN = RGBColor(0x2E, 0x6B, 0x4F)
LIGHT_GOLD = "F7F1E3"
LIGHT_GRAY = "F2F2F2"
DARK_FILL = "1A1A1A"

CN_FONT = "Microsoft YaHei"
EN_FONT = "Arial"


def set_cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def set_cell_margins(cell, top=80, start=100, bottom=80, end=100):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcMar = tcPr.first_child_found_in("w:tcMar")
    if tcMar is None:
        tcMar = OxmlElement("w:tcMar")
        tcPr.append(tcMar)
    for m, v in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tcMar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tcMar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")


def set_table_borders(table, color="D9D2C2", size="6"):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), size)
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tblPr.append(borders)


def style_run(run, size=10.5, bold=False, color=DARK, font=CN_FONT):
    run.font.name = EN_FONT
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), font)


def para(text="", size=10.5, bold=False, color=DARK, align=WD_ALIGN_PARAGRAPH.JUSTIFY,
         space_before=0, space_after=6, line=1.35, font=CN_FONT):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = line
    r = p.add_run(text)
    style_run(r, size, bold, color, font)
    return p


def h1(text, number=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_with_next = True
    if number:
        r = p.add_run(f"{number}  ")
        style_run(r, 18, True, GOLD, CN_FONT)
    r = p.add_run(text)
    style_run(r, 16, True, DARK, CN_FONT)
    # bottom border
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), "B8860B")
    pbdr.append(bottom)
    pPr.append(pbdr)
    return p


def h2(text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    style_run(r, 11.5, True, GOLD, CN_FONT)
    return p


def bullet(text, bold_prefix=None):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.line_spacing = 1.25
    if bold_prefix:
        r = p.add_run(bold_prefix)
        style_run(r, 10.5, True, DARK, CN_FONT)
    r = p.add_run(text)
    style_run(r, 10.5, False, DARK, CN_FONT)
    return p


def callout(title, body, fill=LIGHT_GOLD, border="B8860B"):
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    set_cell_margins(cell, 140, 160, 140, 160)
    set_table_borders(table, border, "10")
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run(title)
    style_run(r, 10.5, True, GOLD, CN_FONT)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    p2.paragraph_format.line_spacing = 1.3
    r2 = p2.add_run(body)
    style_run(r2, 9.5, False, DARK, CN_FONT)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def table(headers, rows, widths=None, header_fill=DARK_FILL, font_size=9.2):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    set_table_borders(t)
    hdr = t.rows[0].cells
    for i, h in enumerate(headers):
        set_cell_shading(hdr[i], header_fill)
        set_cell_margins(hdr[i], 70, 90, 70, 90)
        p = hdr[i].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        style_run(r, font_size, True, WHITE, CN_FONT)
    for ridx, row in enumerate(rows):
        cells = t.add_row().cells
        for i, val in enumerate(row):
            set_cell_margins(cells[i], 65, 90, 65, 90)
            if ridx % 2 == 1:
                set_cell_shading(cells[i], "FAF8F3")
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.2
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT if i == 0 else WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(str(val))
            style_run(r, font_size, False, DARK, CN_FONT)
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Cm(w)
    return t


def page_break():
    doc.add_page_break()


def add_footer(section):
    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("MOSS CORE 路 550C  路  淇″彿閫昏緫閫氫織璇存槑  路  2026-11-02")
    style_run(r, 8, False, MUTED, CN_FONT)


# ------------------ DOCUMENT ------------------
doc = Document()
section = doc.sections[0]
section.page_width = Cm(21.0)
section.page_height = Cm(29.7)
section.top_margin = Cm(1.8)
section.bottom_margin = Cm(1.7)
section.left_margin = Cm(2.0)
section.right_margin = Cm(2.0)
add_footer(section)

# Normal style
normal = doc.styles["Normal"]
normal.font.name = EN_FONT
normal.font.size = Pt(10.5)
normal._element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)

# Cover
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
p.paragraph_format.space_before = Pt(34)
r = p.add_run("MOSS CORE 路 550C")
style_run(r, 11, True, GOLD, CN_FONT)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(18)
p.paragraph_format.space_after = Pt(4)
r = p.add_run("淇″彿鏄€庝箞鏉ョ殑")
style_run(r, 32, True, DARK, CN_FONT)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(18)
r = p.add_run("涓€浠戒笉鐢ㄦ噦浠ｇ爜涔熻兘鐪嬫噦鐨勭洃鎺ч€昏緫璇存槑")
style_run(r, 13, False, MUTED, CN_FONT)

# gold line
t = doc.add_table(rows=1, cols=1)
t.alignment = WD_TABLE_ALIGNMENT.LEFT
cell = t.cell(0, 0)
set_cell_shading(cell, "B8860B")
set_cell_margins(cell, 0, 0, 0, 0)
cell.width = Cm(5.5)
cell.paragraphs[0].paragraph_format.space_after = Pt(0)
r = cell.paragraphs[0].add_run(" ")
style_run(r, 2, False, GOLD, CN_FONT)

doc.add_paragraph()
para("鍙傝€冨璞★細NOVA LAB 鍏紑椤甸潰涓庡叕寮€鎺ュ彛", 10, False, MUTED)
para("鏁寸悊鏃堕棿锛?026-11-02", 10, False, MUTED)
para("鐢ㄩ€旓細瑙ｉ噴鈥滄姄鍙栥€佽瘎鍒嗐€佷俊鍙枫€佹挱鎶モ€濅箣闂寸殑鍏崇郴锛屼究浜庝骇鍝佽璁猴紝涓嶆瀯鎴愭姇璧勫缓璁€?, 10, False, MUTED)

doc.add_paragraph()
callout("鍏堣浣忎竴鍙ヨ瘽",
        "淇″彿涓嶆槸鈥滄姄鍒颁竴涓竵灏辨彁绀衡€濓紝鑰屾槸锛氬湪鐩戞帶鑼冨洿鍐咃紝鏁版嵁杩囧叧銆佹垚浜よ繃鍏炽€佹定骞呰繃鍏炽€佸洖鎾よ繃鍏炽€佺煭鏃跺姩閲忚繃鍏炽€佹€诲垎杩囧叧锛屽苟涓旈樁娈靛彂鐢熷彉鍖栵紝鎵嶄細鎾姤銆?)

page_break()

# 1
h1("鍏堝垎娓呬笁涓瘝", "01")
para("寰堝璇В鏉ヨ嚜鎶娾€滄姄鍙栥€佽瘎鍒嗐€佷俊鍙封€濇贩鍦ㄤ竴璧枫€傚畠浠叾瀹炴槸涓夋銆?)

table(
    ["璇?, "閫氫織瑙ｉ噴", "鍦ㄧ郴缁熼噷浠ｈ〃浠€涔?],
    [
        ["鎶撳彇", "绯荤粺鐪嬪埌杩欎釜甯佺殑琛屾儏", "琛屾儏蹇収銆佹垚浜ら銆佹定璺屽箙銆佺洏鍙ｇ瓑鍘熷鏁版嵁"],
        ["璇勫垎", "缁欒繖涓竵鎵撳垎", "鍩虹鍒?+ 鍔ㄩ噺 + 鎴愪氦 + 鍥炴挙 + 鐩樺彛"],
        ["淇″彿", "杩欎釜甯佽繘鍏ヤ簡涓€涓€煎緱鍏虫敞鐨勯樁娈?, "鍒濈瓫瑙傚療 / 閲嶇偣鍊欓€?/ 寮€浠撲俊鍙?],
    ],
    widths=[3.0, 7.0, 6.5],
)

para("鎵€浠ワ細", 10.5, True, DARK, space_before=6, space_after=2)
bullet("鎶撳彇 鈮?淇″彿銆傛姄鍒版暟鎹彧鏄涓€姝ャ€?, "鈶?")
bullet("璇勫垎楂?鈮?淇″彿銆傝繕瑕佽繃娑ㄥ箙銆佹垚浜ゃ€佸洖鎾ゃ€佸姩閲忕瓑纭潯浠躲€?, "鈶?")
bullet("杩涘叆闃舵 鈮?姣忚疆閮芥挱銆傝鍜屼笂涓€杞瘮杈冿紝闃舵鍙樹簡鎵嶆挱銆?, "鈶?")

# 2
h1("涓€涓竵浠庢姄鍙栧埌鎾姤锛岃璧颁簲姝?, "02")

steps = [
    ("绗竴姝ワ細鍦ㄧ洃鎺ц寖鍥村唴", "鍏堢湅杩欎釜甯佹槸涓嶆槸鐢ㄦ埛瀵煎叆鐨勩€佹垨鑰呰嚜閫夌殑銆侼OVA 鏄叏甯傚満鎵弿锛涙垜浠殑 MOSS 鍙壂鎻忓鍏ユ睜銆?),
    ("绗簩姝ワ細鏁版嵁鑳界敤", "琛屾儏瑕佹柊椴滐紝鐩樺彛瑕佸彲鐢紝鐭懆鏈熶环鏍煎巻鍙茶杩炵画銆傛暟鎹繃鏈熴€佺己澶憋紝灏变笉鑳芥嬁 0 鍐掑厖銆?),
    ("绗笁姝ワ細纭棬妲?, "24h 鎴愪氦棰濄€?4h 娑ㄥ箙銆佽窛鐭嚎楂樼偣鍥炴挙锛屽繀椤昏惤鍦ㄥ厑璁稿尯闂淬€?),
    ("绗洓姝ワ細鐭椂鍔ㄩ噺鍜屾€诲垎", "1m / 3m / 5m 鑷冲皯鏈変竴涓槑鏄惧姞閫燂紱鍚屾椂缁煎悎璇勫垎杈惧埌闃舵闂ㄦ銆?),
    ("绗簲姝ワ細闃舵鍙樺寲", "鍜屼笂涓€杞瘮锛屼粠鈥滄湭杩涘叆鈥濆彉鎴愨€滃垵绛涒€濓紝鎴栦粠鈥滃垵绛涒€濆崌鍒扳€滃€欓€?寮€浠撯€濓紝鎵嶅舰鎴愭挱鎶ャ€?),
]
for i, (title, body) in enumerate(steps, 1):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(5)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(f"{i:02d}  ")
    style_run(r, 12, True, GOLD, CN_FONT)
    r = p.add_run(title)
    style_run(r, 11, True, DARK, CN_FONT)
    para(body, 10.2, False, DARK, space_after=4)

callout("涓€鍙ヨ瘽娴佺▼",
        "鐩戞帶鑼冨洿 鈫?鏁版嵁鏂伴矞 鈫?鎴愪氦棰?鈫?24h 娑ㄥ箙 鈫?鍥炴挙 鈫?鐭椂鍔ㄩ噺 鈫?缁煎悎璇勫垎 鈫?闃舵鍙樺寲 鈫?鎾姤")

# 3
h1("鐪熸鍐冲畾淇″彿鐨勫叚涓寚鏍?, "03")
para("淇″彿鍗′笂浼氭樉绀哄緢澶氭暟瀛楋紝浣嗙湡姝ｅ喅瀹氣€滆兘涓嶈兘鎴愪负淇″彿鈥濈殑锛屼富瑕佹槸涓嬮潰鍏被銆?)

table(
    ["鎸囨爣", "瀹冨湪鍒ゆ柇浠€涔?, "涓轰粈涔堥噸瑕?],
    [
        ["24h 鎴愪氦棰?, "杩欎釜甯佹湁娌℃湁瓒冲鐨勪氦鏄撴椿璺冨害", "鎴愪氦澶皬锛屼俊鍙峰鏄撳け鐪燂紝涔熻繘涓嶅幓"],
        ["24h 娑ㄥ箙", "杩欎釜甯佺幇鍦ㄥ湪浠€涔堜綅缃?, "澶綆娌″惎鍔紝澶珮瀹规槗杩藉湪灞遍《"],
        ["1m / 3m / 5m 娑ㄥ箙", "鏈夋病鏈夌煭鏃跺姞閫?, "杩欐槸鈥滃紓鍔ㄢ€濈殑鐩存帴鏉ユ簮"],
        ["璺濈煭绾块珮鐐瑰洖鎾?, "鐜板湪杩借繘鍘绘槸涓嶆槸澶櫄", "鍥炴挙澶ぇ锛岃鏄庣煭绾垮凡缁忚蛋鍧?],
        ["缁煎悎璇勫垎", "鏁翠綋寮哄害澶熶笉澶?, "鎶婂姩閲忋€佹垚浜ゃ€佷綅缃€佺洏鍙ｅ悎鍦ㄤ竴璧?],
        ["鏁版嵁鏂伴矞搴?, "鐜板湪鐪嬪埌鐨勬槸涓嶆槸瀹炴椂鏁版嵁", "杩囨湡鏁版嵁涓嶈兘鐢熸垚淇″彿"],
    ],
    widths=[4.2, 6.5, 6.0],
)

para("娉ㄦ剰锛?, 10.5, True, DARK, space_before=6, space_after=2)
bullet("OI銆佸绌烘瘮銆佽祫閲戣垂鐜囥€佸叕寮€浜ゆ槗鍛樻垚鏈€佸绛鹃搴︼紝鏄緟鍔╄瘉鎹紝涓嶆槸寮€浠撲俊鍙风殑瑙﹀彂鍣ㄣ€?, "路 ")
bullet("NOVA 椤甸潰鑷繁鍐欎簡锛氳法鎵€ OI銆丆oinGlass銆佸叕寮€浠撲綅鏄簩娆℃牳楠岋紝涓嶇洿鎺ヨЕ鍙戠焊闈㈡垨瀹炵洏銆?, "路 ")

# 4
h1("涓夋。闂ㄦ锛氬垵绛涖€佸€欓€夈€佸紑浠?, "04")
para("鍚屾牱鏄€滄湁寮傚姩鈥濓紝寮哄害涓嶅悓锛屽垎鎴愪笁妗ｃ€備笁妗ｄ笉鏄笁涓瓥鐣ワ紝鑰屾槸鍚屼竴鏉￠摼涓婄殑涓変釜瑙傚療绾у埆銆?)

table(
    ["闃舵", "閫氫織鐞嗚В", "璇勫垎", "24h 娑ㄥ箙", "24h 鎴愪氦棰?, "鍥炴挙", "鐭椂鍔ㄩ噺锛堜笁閫変竴锛?],
    [
        ["鍒濈瓫瑙傚療", "鍏堟斁杩涜瀵熷悕鍗?, "鈮?2", "1%鈥?0%", "鈮?M", "鈮?4%", "1m鈮?.25% 鎴?3m鈮?.5% 鎴?5m鈮?.8%"],
        ["閲嶇偣鍊欓€?, "鍊煎緱閲嶇偣鐪?, "鈮?6", "2%鈥?5%", "鈮?M", "闇€閫氳繃鍥炴挙鏉′欢", "1m鈮?.35% 鎴?3m鈮?.7% 鎴?5m鈮?.0%"],
        ["寮€浠撲俊鍙?, "鏉′欢鏈€涓?, "鈮?6", "3%鈥?5%", "鈮?M", "鈮?%", "1m鈮?.55% 鎴?3m鈮?.0% 鎴?5m鈮?.35%"],
    ],
    widths=[3.0, 4.3, 1.6, 2.5, 2.4, 2.2, 5.0],
    font_size=8.2,
)

para("娉細閲嶇偣鍊欓€夌殑鍥哄畾鍥炴挙涓婇檺锛屽叕寮€椤甸潰娌℃湁缁欏嚭鏄庣‘鏁板瓧锛涘疄闄呬互閮ㄧ讲閰嶇疆涓哄噯銆?, 9, False, MUTED, space_before=2)

# 5
h1("璇勫垎鏄€庝箞鍔犲嚭鏉ョ殑", "05")
para("鍙互鎶婅瘎鍒嗙悊瑙ｆ垚涓€寮?100 鍒嗙殑鍗峰瓙銆傚熀纭€鍒嗗厛缁?55 鍒嗭紝鍐嶇湅鍚勯」琛ㄧ幇鍔犲垎銆?)

table(
    ["璇勫垎椤?, "鎬庝箞鐪?, "鏈€楂樺垎"],
    [
        ["鍩虹鍒?, "鎵€鏈夐€氳繃娴佸姩鎬ч绛涚殑甯?, "55"],
        ["1 鍒嗛挓鍔ㄩ噺", "娑ㄥ緱瓒婂揩锛屽姞鍒嗚秺澶?, "18"],
        ["3 鍒嗛挓鍔ㄩ噺", "鐭椂寤剁画鎬?, "16"],
        ["5 鍒嗛挓鍔ㄩ噺", "鐭椂寤剁画鎬?, "14"],
        ["15 鍒嗛挓鍔ㄩ噺", "绋嶅井闀夸竴鐐圭殑瓒嬪娍", "8"],
        ["24 灏忔椂浣嶇疆", "褰撳墠娑ㄥ箙鎵€澶勭殑浣嶇疆", "8"],
        ["24 灏忔椂鎴愪氦棰?, "娴佸姩鎬?, "8"],
        ["璺濈煭绾块珮鐐瑰洖鎾?, "鍥炴挙瓒婂皬锛屽姞鍒嗚秺澶?, "5"],
        ["寰鐩樺彛", "鐐瑰樊銆佹繁搴︺€佷富鍔ㄤ拱鍗?, "2.5"],
    ],
    widths=[5.0, 8.5, 3.0],
)

para("鏈€鍚庢妸鎬诲垎闄愬埗鍦?0鈥?00銆?, 10.2, False, DARK, space_before=4)
callout("閲嶈鎻愰啋",
        "璇勫垎涓嶆槸鍞竴鏉′欢銆備竴涓竵鍙兘 90 鍒嗭紝浣?24h 娑ㄥ箙瓒呰繃鍏佽鍖洪棿锛屾垨鑰呭洖鎾ゅお澶э紝浠嶇劧涓嶈兘鎴愪负寮€浠撲俊鍙枫€?)

# 6
h1("涓轰粈涔堥珮鍒嗙殑甯佷篃浼氳鎷掔粷", "06")
para("鐪嬩竴涓湡瀹炰緥瀛愶細BTC 鍦ㄦ帴鍙ｉ噷璇勫垎 63.0锛屾病鏈夎繘鍏ュ€欓€夈€?)

table(
    ["妫€鏌ラ」", "BTC 褰撴椂鐨勬儏鍐?, "缁撴灉"],
    [
        ["24h 娑ㄥ箙", "0.22%", "鍒濈瓫瑕佹眰 鈮?%锛屼笉閫氳繃"],
        ["鐭懆鏈熶环鏍煎巻鍙?, "涓嶈繛缁?, "鍔ㄩ噺涓嶅弬涓庤瘎鍒?],
        ["璇勫垎", "63.0", "鍒濈瓫瑕佹眰 鈮?2锛屼笉閫氳繃"],
        ["鐭嚎楂樼偣鍥炴挙", "鍘嗗彶涓嶈繛缁?, "鍥炴挙鎸囨爣涓嶅弬涓庤瘎鍒?],
    ],
    widths=[4.0, 6.5, 6.5],
)

para("鎵€浠ュ畠涓嶆槸鈥滄病琚湅鍒扳€濓紝鑰屾槸鈥滆鐪嬪埌浜嗭紝浣嗘病鏈夎繃闂ㄦ鈥濄€?, 10.5, True, DARK, space_before=5)
para("杩欏氨鏄负浠€涔堜俊鍙峰崱涓婅鍚屾椂鏀惧垎鏁般€佹定骞呫€佹垚浜ら銆佸洖鎾ゅ拰鐞嗙敱锛岃€屼笉鏄彧鏀句竴涓ぇ鍒嗘暟銆?, 10.2, False, MUTED)

# 7
h1("浠€涔堟椂鍊欐墠浼氭挱鎶?, "07")
para("绯荤粺姣忚疆閮芥壂鎻忥紝浣嗕笉鏄瘡杞兘鎾姤銆傛挱鎶ョ湅鐨勬槸鈥滈樁娈靛彉鍖栤€濄€?)

table(
    ["涓婁竴杞?, "杩欎竴杞?, "鏄惁鎾姤"],
    [
        ["娌℃湁杩涘叆", "杩涘叆鍒濈瓫瑙傚療", "鎾姤涓€娆?],
        ["鍒濈瓫瑙傚療", "鍗囩骇閲嶇偣鍊欓€?, "鎾姤涓€娆?],
        ["閲嶇偣鍊欓€?, "鍗囩骇寮€浠撲俊鍙?, "鎾姤涓€娆?],
        ["寮€浠撲俊鍙?, "闄嶇骇閲嶇偣鍊欓€?, "鎾姤涓€娆?],
        ["鍚屼竴涓竵銆佸悓涓€涓樁娈?, "杩樻槸鍚屼竴闃舵", "涓嶉噸澶嶆挱鎶?],
        ["鏁版嵁杩囨湡/鏃犳晥", "鏃犳硶纭", "涓嶆挱鎶ワ紝鍙褰曟暟鎹紓甯?],
    ],
    widths=[6.0, 6.0, 5.0],
)

para("鍘婚噸鐨勬牳蹇冩槸锛?, 10.2, True, DARK, space_before=5)
para("鍚屼竴涓竵 + 鍚屼竴涓樁娈?+ 鍚屼竴娆￠樁娈靛彉鍖栵紝鍙挱涓€娆°€?, 10.5, True, GOLD)

# 8
h1("鍝簺鎻愮ず涓嶆槸寮€浠撲俊鍙?, "08")
para("绯荤粺閲岃繕鏈夊緢澶氣€滄彁閱掆€濓紝浣嗗畠浠拰鈥滃紑浠撲俊鍙封€濅笉鏄竴鍥炰簨銆?)

table(
    ["鎻愮ず", "瀹冧唬琛ㄤ粈涔?, "浼氫笉浼氱洿鎺ヨЕ鍙戝紑浠撲俊鍙?],
    [
        ["OI 蹇 / 蹇€€", "鎸佷粨鍦ㄧ煭鏃堕棿鏄庢樉澧炲姞鎴栧噺灏?, "涓嶄細锛屽彧鎵╁ぇ瑙傚療"],
        ["MM 瑙傚療姹?, "宸茬煡椤圭洰鎴栧弽澶嶆í璺抽」鐩?, "涓嶄細锛屽彧瑙傚療"],
        ["浣庡競鍊艰繘鍏ュ垵绛?, "灏忓競鍊煎竵杩涘叆瑙傚療", "涓嶄細锛屽彧鎻愰啋鏍搁獙"],
        ["澶氱棰濆害", "閾句笂澶氱绱棰濆害", "涓嶄細锛岀嫭绔嬫暟鎹瘉鏄?],
        ["澶х洏鐘舵€?, "甯傚満鏁翠綋寮哄急", "涓嶄細鏀瑰彉寮€浠撴潯浠讹紝鍙奖鍝嶅凡鏈変粨浣嶉鎺?],
    ],
    widths=[4.0, 7.5, 5.5],
)

callout("杈圭晫",
        "OI 澧炲姞鍙兘鏉ヨ嚜澶氫粨銆佺┖浠撴垨瀵瑰啿浠擄紱澶氱鎸佷粨涔熶笉鑳界洿鎺ヨ瘉鏄庘€滃競鍊煎洟闃熶粙鍏モ€濄€傝繖浜涘彧鑳戒綔涓轰唬鐞嗚瘉鎹紝涓嶈兘鍐欐垚纭畾缁撹銆?)

# 9
h1("鏀惧埌 MOSS 涓婏紝瑙勫垯鎬庝箞鍙?, "09")
para("NOVA 鏄叏甯傚満鎵弿锛涙垜浠殑 MOSS 鏄€滅敤鎴峰鍏?+ 鑷€夐噸鐐光€濄€傚簳灞傚垽鏂笉鍙橈紝鍙樼殑鍙槸鐩戞帶鑼冨洿銆?)

table(
    ["鐜妭", "NOVA LAB", "MOSS CORE"],
    [
        ["鐩戞帶鑼冨洿", "鍏ㄥ競鍦?USDT 姘哥画", "鐢ㄦ埛瀵煎叆鐨勫竵"],
        ["閲嶇偣灞傜骇", "鍊欓€夋 / MM 姹?, "鑷€夐噸鐐?+ 瀵煎叆杈呭姪"],
        ["鎶撳彇棰戠巼", "椤甸潰 5s / 涓荤瓥鐣?30s / 鎺ュ彛鏍?60s", "鎸夋垜浠殑鏈嶅姟閰嶇疆"],
        ["淇″彿鏉′欢", "璇勫垎 + 鎴愪氦 + 娑ㄥ箙 + 鍥炴挙 + 鍔ㄩ噺", "鍚屼竴濂楁潯浠讹紝鍙瀵煎叆姹犵敓鏁?],
        ["鎾姤", "闃舵鍙樺寲", "闃舵鍙樺寲 + 鑷€変紭鍏?+ 绾㈢溂鍔ㄦ晥"],
    ],
    widths=[3.5, 6.8, 6.5],
)

para("鎵€浠ユ垜浠殑閫昏緫涓嶆槸鈥滈噸鏂板彂鏄庝竴濂楁寚鏍団€濓紝鑰屾槸锛?, 10.2, False, DARK, space_before=4)
para("瀵煎叆姹?鈫?鏁版嵁妫€鏌?鈫?娴佸姩鎬ч绛?鈫?璇勫垎 鈫?涓夋。闃舵 鈫?闃舵鍙樺寲 鈫?鎾姤", 10.5, True, GOLD)

# 10
h1("涓€椤甸€熸煡", "10")

t = doc.add_table(rows=1, cols=1)
t.alignment = WD_TABLE_ALIGNMENT.CENTER
cell = t.cell(0, 0)
set_cell_shading(cell, "1A1A1A")
set_cell_margins(cell, 180, 200, 180, 200)
set_table_borders(t, "1A1A1A", "8")
p = cell.paragraphs[0]
p.paragraph_format.space_after = Pt(6)
r = p.add_run("MOSS 淇″彿閫熸煡")
style_run(r, 14, True, RGBColor(0xFF, 0xC0, 0x43), CN_FONT)

lines = [
    ("鍏堢湅鑼冨洿", "杩欎釜甯佸湪涓嶅湪瀵煎叆姹?/ 鑷€夋睜锛?),
    ("鍐嶇湅鏁版嵁", "琛屾儏鏂颁笉鏂伴矞锛熺洏鍙ｅ彲涓嶅彲鐢紵"),
    ("鍐嶇湅鎴愪氦", "24h 鎴愪氦棰濆涓嶅锛?),
    ("鍐嶇湅浣嶇疆", "24h 娑ㄥ箙鍦ㄤ笉鍦ㄥ尯闂达紵璺濋珮鐐瑰洖鎾ゅぇ涓嶅ぇ锛?),
    ("鍐嶇湅鍔ㄩ噺", "1m / 3m / 5m 鏈夋病鏈夊姞閫燂紵"),
    ("鍐嶇湅鎬诲垎", "鏈夋病鏈夊埌 72 / 76 / 86锛?),
    ("鏈€鍚庣湅鍙樺寲", "闃舵鏈夋病鏈夊彉锛熷彉浜嗘墠鎾€?),
]
for i, (a, b) in enumerate(lines):
    p = cell.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(f"{i+1}. {a}锛?)
    style_run(r, 10, True, RGBColor(0xFF, 0xC0, 0x43), CN_FONT)
    r = p.add_run(b)
    style_run(r, 10, False, RGBColor(0xF2, 0xF0, 0xE8), CN_FONT)

p = cell.add_paragraph()
p.paragraph_format.space_before = Pt(8)
r = p.add_run("淇″彿鏄€滃€煎緱鍏虫敞鈥濓紝涓嶆槸鈥滀繚璇佷笂娑ㄢ€濄€?)
style_run(r, 10, True, RGBColor(0xFF, 0xC0, 0x43), CN_FONT)

# 11
h1("甯歌璇В", "11")
mis = [
    ("鎶撳埌甯佸氨浼氭挱", "閿欍€傛姄鍒板彧鏄湁浜嗘暟鎹紝杩樿璇勫垎銆佽繃婊ゃ€侀樁娈靛彉鍖栥€?),
    ("鍒嗘暟楂樺氨鏄俊鍙?, "閿欍€傝繕瑕佽繃娑ㄥ箙銆佹垚浜ゃ€佸洖鎾ゃ€佸姩閲忕瓑纭潯浠躲€?),
    ("OI 澧炲姞灏辨槸寮€浠撲俊鍙?, "閿欍€侽I 鍙槸浜屾鏍搁獙锛屼笉鐩存帴瑙﹀彂銆?),
    ("澶氱澶氬氨鏄細娑?, "閿欍€傚绛惧彧璇佹槑棰濆害锛屼笉璇佹槑鏂瑰悜銆?),
    ("淇″彿浼氫竴鐩撮噸澶嶆挱", "閿欍€傚悓甯佸悓闃舵鍙挱涓€娆★紝闃舵鍙樺寲鎵嶆挱銆?),
    ("娌℃湁鏁版嵁灏辩敤 0 浠ｆ浛", "閿欍€傜己澶卞氨鏄己澶憋紝涓嶈兘鐢?0 鍐掑厖銆?),
]
for a, b in mis:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run("鉁? " + a + "锛?)
    style_run(r, 10.2, True, RED, CN_FONT)
    r = p.add_run(b)
    style_run(r, 10.2, False, DARK, CN_FONT)

# footer note
doc.add_paragraph()
para("璇存槑锛氭湰鏂囦緷鎹?NOVA LAB 鍏紑椤甸潰鍜屽叕寮€鎺ュ彛鐨勫彲瑙佸瓧娈垫暣鐞嗐€傞噸鐐瑰€欓€夌殑鍥哄畾鍥炴挙涓婇檺銆?4h 浣嶇疆/鎴愪氦棰濈殑鍏蜂綋鍒嗘銆佸井瑙傜洏鍙ｇ簿纭潈閲嶃€佸悗绔壂鎻忛棿闅旂瓑锛岄渶瑕佸悗绔厤缃墠鑳藉畬鍏ㄧ‘璁ゃ€?, 8.5, False, MUTED, space_after=2)
para("鏈枃鍙В閲婄洃鎺ч€昏緫锛屼笉鏋勬垚浠讳綍鎶曡祫寤鸿銆?, 8.5, False, MUTED)

doc.save(OUT)
print("SAVED", OUT)

