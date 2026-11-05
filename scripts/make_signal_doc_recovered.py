from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_LINE_SPACING

OUT = r"D:\数据库\docs\通俗说明-MOSS信号是怎么来的-v1.0.docx"

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
    r = p.add_run("MOSS CORE · 550C  ·  信号逻辑通俗说明  ·  2026-11-02")
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
r = p.add_run("MOSS CORE · 550C")
style_run(r, 11, True, GOLD, CN_FONT)

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(18)
p.paragraph_format.space_after = Pt(4)
r = p.add_run("信号明么来的")
style_run(r, 32, True, DARK, CN_FONT)

p = doc.add_paragraph()
p.paragraph_format.space_after = Pt(18)
r = p.add_run("�份不用懂代码也能看懂的监控�辑说明")
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
para("参��象：NOVA LAB 兼�页面与公�接口", 10, False, MUTED)
para("整理时间�?026-11-02", 10, False, MUTED)
para("用�：解释“抓取�评分�信号�播报�之间的关系，便于产品�论，不构成投资建�?, 10, False, MUTED)

doc.add_paragraph()
callout("先�住一句话",
        "信号不是“抓到一丸�就提示�，而是：在监控范围内，数据过关、成交过关�涨幅过关�回撤过关�短时动量过关��分过关，并且阶段发生变化，才会撊��?)

page_break()

# 1
h1("先分清三丯�", "01")
para("很�诧�来自把�抓取�评分�信号�混在一起�它仅�实是三��?)

table(
    ["�?, "通俗解释", "在系统里代表��?],
    [
        ["抓取", "系统看到这个币的行情", "行情必�、成交�、涨跌幅、盘口等原�数据"],
        ["评分", "给这丸�打分", "基��?+ 动量 + 成交 + 回撤 + 盘口"],
        ["信号", "这个币进入了�丼得关注的阶�?, "初筛观察 / 重点候�?/ �仓信�?],
    ],
    widths=[3.0, 7.0, 6.5],
)

para("�以：", 10.5, True, DARK, space_before=6, space_after=2)
bullet("抓取 �?信号。抓到数捏���步�?, "�?")
bullet("评分�?�?信号。还要过涨幅、成交�回撤�动量等硝�件�?, "�?")
bullet("进入阶� �?每轮都播。�和上�软�较，阶�变了才播�?, "�?")

# 2
h1("�丸�从抓取到撊�，�走五�?, "02")

steps = [
    ("笸�步：在监控范围内", "先看这个币是不是用户导入的�或者自选的。NOVA 昅�市场扏�；我仚� MOSS 叉�描�入池�?),
    ("笺�步：数据能用", "行情要新鲜，盘口要可甼�矑�期价格历史�连续。数捿�期�缺失，就不能拿 0 冒充�?),
    ("笸�步：硗��?, "24h 成交额�?4h 涨幅、距矺�高点回撤，必须落在允许区间�?),
    ("笛�步：矗�动量和�分", "1m / 3m / 5m 至少有一丘�显加速；同时综合评分达到阶�门��?),
    ("笺�步：阶�变化", "和上�软�，从“未进入”变成�初筛�，或从“初筛�升到���?�仓�，才形成播报�?),
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

callout("�句话流程",
        "监控范围 �?数据新鲜 �?成交�?�?24h 涨幅 �?回撤 �?矗�动量 �?综合评分 �?阶�变化 �?撊�")

# 3
h1("真�决定信号的六丌��?, "03")
para("信号卡上会显示很多数字，但真正决定�能不能成为信号”的，主要是下面共��?)

table(
    ["指标", "它在判断��?, "为什么重�?],
    [
        ["24h 成交�?, "这个币有没有足�的交易活跃度", "成交夰�，信号�易失真，也进不去"],
        ["24h 涨幅", "这个币现在在�么位�?, "夽�没启劼�夫�容易追在山顶"],
        ["1m / 3m / 5m 涨幅", "有没有短时加�?, "这是“异动�的直接来源"],
        ["距短线高点回�?, "现在追进去是不是夙�", "回撤夤�，�明短线已经走�?],
        ["综合评分", "整体强度够不�?, "把动量�成交�位罁盘口合在一�?],
        ["数据新鲜�?, "现在看到的是不是实时数据", "过期数据不能生成信号"],
    ],
    widths=[4.2, 6.5, 6.0],
)

para("注意�?, 10.5, True, DARK, space_before=6, space_after=2)
bullet("OI、�空比、资金费率�公�交易员成朁�签�度，显�助证捼�不是�仓信号的触发器�?, "· ")
bullet("NOVA 页面臷�写了：跨� OI、CoinGlass、公�仓位昺�次核验，不直接触发纸面或实盘�?, "· ")

# 4
h1("三档门�：初筛����开�?, "04")
para("同样昜有异动”，强度不同，分成三档�三档不昸�中�略，而是同一条链上的三个观察级别�?)

table(
    ["阶�", "通俗理解", "评分", "24h 涨幅", "24h 成交�?, "回撤", "矗�动量（三选一�?],
    [
        ["初筛观察", "先放进�察名�?, "�?2", "1%�?0%", "�?M", "�?4%", "1m�?.25% �?3m�?.5% �?5m�?.8%"],
        ["重点候�?, "值得重点�?, "�?6", "2%�?5%", "�?M", "�通过回撤条件", "1m�?.35% �?3m�?.7% �?5m�?.0%"],
        ["�仓信�?, "条件��?, "�?6", "3%�?5%", "�?M", "�?%", "1m�?.55% �?3m�?.0% �?5m�?.35%"],
    ],
    widths=[3.0, 4.3, 1.6, 2.5, 2.4, 2.2, 5.0],
    font_size=8.2,
)

para("泼�重点候�的固定回撤上限，公�页面没有给出明确数字；实际以部署配置为准�?, 9, False, MUTED, space_before=2)

# 5
h1("评分明么加出来的", "05")
para("叻�把评分理解成��?100 分的卷子。基�分先�?55 分，再看各项表现加分�?)

table(
    ["评分�?, "怎么�?, "�高分"],
    [
        ["基��?, "�有�过流动性�筛的�?, "55"],
        ["1 分钟动量", "涨得越快，加分越�?, "18"],
        ["3 分钟动量", "矗�延续�?, "16"],
        ["5 分钟动量", "矗�延续�?, "14"],
        ["15 分钟动量", "稍微长一点的趋势", "8"],
        ["24 小时位置", "当前涨幅�处的位置", "8"],
        ["24 小时成交�?, "流动�?, "8"],
        ["距短线高点回�?, "回撤越小，加分越�?, "5"],
        ["�盘口", "点差、深度�主动买�?, "2.5"],
    ],
    widths=[5.0, 8.5, 3.0],
)

para("�后把总分限制�?0�?00�?, 10.2, False, DARK, space_before=4)
callout("重�提醒",
        "评分不是唸�条件。一丸�參� 90 分，�?24h 涨幅超过允�区间，或者回撤太大，仍然不能成为�仓信号�?)

# 6
h1("为什么高分的币也会�拒绝", "06")
para("看一东�实例子：BTC 在接口里评分 63.0，没有进入���?)

table(
    ["�查项", "BTC 当时的情�?, "结果"],
    [
        ["24h 涨幅", "0.22%", "初筛要求 �?%，不通过"],
        ["矑�期价格历�?, "不连�?, "动量不参与评�?],
        ["评分", "63.0", "初筛要求 �?2，不通过"],
        ["矺�高点回撤", "历史不连�?, "回撤指标不参与评�?],
    ],
    widths=[4.0, 6.5, 6.5],
)

para("�以它不是“没袜�到�，而是“�看到了，但没有过门�”�?, 10.5, True, DARK, space_before=5)
para("这就昸��么信号卡上�同时放分数�涨幅�成交�、回撤和理由，�不昏�放一两�分数�?, 10.2, False, MUTED)

# 7
h1("�么时候才会播�?, "07")
para("系统每轮都扫描，但不是�轃�撊�。播报看的是“阶段变化��?)

table(
    ["上一�?, "这一�?, "昐�撊�"],
    [
        ["没有进入", "进入初筛观察", "撊���?],
        ["初筛观察", "升级重点候�?, "撊���?],
        ["重点候�?, "升级�仓信�?, "撊���?],
        ["�仓信�?, "降级重点候�?, "撊���?],
        ["同一丸�、同�丘��?, "还是同一阶�", "不重复播�?],
        ["数据过期/无效", "无法�", "不播报，�录数捼��?],
    ],
    widths=[6.0, 6.0, 5.0],
)

para("去重的核心是�?, 10.2, True, DARK, space_before=5)
para("同一丸� + 同一丘��?+ 同一次阶段变化，叒��次�?, 10.5, True, GOLD)

# 8
h1("哺�提示不是�仓信�?, "08")
para("系统里还有很多�提醒�，但它仒�“开仓信号�不昸�回事�?)

table(
    ["提示", "它代表什�?, "会不会直接触发开仓信�?],
    [
        ["OI � / �", "持仓在短时间明显增加或减�?, "不会，只扩大观察"],
        ["MM 观察�?, "已知项目或反复横跳项�?, "不会，只观察"],
        ["低市值进入初�?, "小市值币进入观察", "不会，只提醒核验"],
        ["多�额度", "链上多��额度", "不会，独立数捯��?],
        ["大盘状�?, "市场整体强弱", "不会改变�仓条件，叽�响已有仓位��?],
    ],
    widths=[4.0, 7.5, 5.5],
)

callout("边界",
        "OI 增加參�来自多仓、空仓或对冲仓；多�持仓也不能直接证明�市值团队介入��这些只能作为代理证捼�不能写成确�结��?)

# 9
h1("放到 MOSS 上，规则怎么�?, "09")
para("NOVA 昅�市场扏�；我仚� MOSS 昜用户��?+ 臉重点��底层判斸�变，变的变�监控范围�?)

table(
    ["玊�", "NOVA LAB", "MOSS CORE"],
    [
        ["监控范围", "全市�?USDT 永续", "用户导入的币"],
        ["重点层级", "候�� / MM �?, "臉重�?+ 导入辅助"],
        ["抓取频率", "页面 5s / 主策�?30s / 接口�?60s", "按我仚�服务配置"],
        ["信号条件", "评分 + 成交 + 涨幅 + 回撤 + 动量", "同一套条件，�导入池生�?],
        ["撊�", "阶�变化", "阶�变化 + 臉优�?+ 红眼动效"],
    ],
    widths=[3.5, 6.8, 6.5],
)

para("�以我仚�逻辑不是“重新发明一套指标�，而是�?, 10.2, False, DARK, space_before=4)
para("导入�?�?数据��?�?流动性��?�?评分 �?三档阶� �?阶�变化 �?撊�", 10.5, True, GOLD)

# 10
h1("�页�查", "10")

t = doc.add_table(rows=1, cols=1)
t.alignment = WD_TABLE_ALIGNMENT.CENTER
cell = t.cell(0, 0)
set_cell_shading(cell, "1A1A1A")
set_cell_margins(cell, 180, 200, 180, 200)
set_table_borders(t, "1A1A1A", "8")
p = cell.paragraphs[0]
p.paragraph_format.space_after = Pt(6)
r = p.add_run("MOSS 信号速查")
style_run(r, 14, True, RGBColor(0xFF, 0xC0, 0x43), CN_FONT)

lines = [
    ("先看范围", "这个币在不在导入�?/ 臉池�?),
    ("再看数据", "行情新不新鲜？盘口可不可甼�"),
    ("再看成交", "24h 成交额�不��?),
    ("再看位置", "24h 涨幅在不在区间？距高点回撤大不大�?),
    ("再看动量", "1m / 3m / 5m 有没有加速？"),
    ("再看总分", "有没有到 72 / 76 / 86�?),
    ("�后看变化", "阶�有没有变？变了才�?),
]
for i, (a, b) in enumerate(lines):
    p = cell.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(f"{i+1}. {a}�?)
    style_run(r, 10, True, RGBColor(0xFF, 0xC0, 0x43), CN_FONT)
    r = p.add_run(b)
    style_run(r, 10, False, RGBColor(0xF2, 0xF0, 0xE8), CN_FONT)

p = cell.add_paragraph()
p.paragraph_format.space_before = Pt(8)
r = p.add_run("信号昜�得关注”，不是“保证上涨��?)
style_run(r, 10, True, RGBColor(0xFF, 0xC0, 0x43), CN_FONT)

# 11
h1("常�诧�", "11")
mis = [
    ("抓到币就会播", "错�抓到只昜�了数捼�还�评分、过滤�阶段变化�?),
    ("分数高就昿��?, "错�还要过涨幅、成交�回撤�动量等硝�件�?),
    ("OI 增加就是�仓信�?, "错�OI 变�二�核验，不直接触发�?),
    ("多�多就昼��?, "错��签只证明额度，不证明方向�?),
    ("信号会一直重复播", "错�同币同阶�叒��次，阶�变化才播�?),
    ("没有数据就用 0 代替", "错�缺失就昼�失，不能�?0 冒充�?),
]
for a, b in mis:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run("�? " + a + "�?)
    style_run(r, 10.2, True, RED, CN_FONT)
    r = p.add_run(b)
    style_run(r, 10.2, False, DARK, CN_FONT)

# footer note
doc.add_paragraph()
para("说明：本文依�?NOVA LAB 兼�页面和公�接口的可见字段整理�重点��的固定回撤上限�?4h 位置/成交额的具体分�、微观盘口精硝�重�后竉�描间隔等，需要后竅�罉�能完全确认�?, 8.5, False, MUTED, space_after=2)
para("朖�叧�释监控�辑，不构成任何投资建��?, 8.5, False, MUTED)

doc.save(OUT)
print("SAVED", OUT)

