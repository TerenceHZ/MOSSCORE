from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = r"D:\数据库\docs\requirements\06-单代币三窗口内容定义-v1.0.docx"

doc = Document()
sec = doc.sections[0]
sec.top_margin = Cm(1.8)
sec.bottom_margin = Cm(1.8)
sec.left_margin = Cm(2.0)
sec.right_margin = Cm(2.0)

normal = doc.styles['Normal']
normal.font.name = 'Arial'
normal.font.size = Pt(10.5)
normal.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
normal.paragraph_format.space_after = Pt(5)
normal.paragraph_format.line_spacing = 1.25

for name in ['Title', 'Heading 1', 'Heading 2']:
    st = doc.styles[name]
    st.font.name = 'Arial'
    st.element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
    st.font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)

def shade(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)

def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True
    hdr = t.rows[0].cells
    trPr = t.rows[0]._tr.get_or_add_trPr()
    th = OxmlElement('w:tblHeader'); th.set(qn('w:val'), 'true'); trPr.append(th)
    for i, h in enumerate(headers):
        hdr[i].text = ''
        p = hdr[i].paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.size = Pt(9)
        r.font.name = 'Arial'
        r._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        shade(hdr[i], 'E8E2D4')
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ''
            p = cells[i].paragraphs[0]
            r = p.add_run(str(val))
            r.font.size = Pt(8.8)
            r.font.name = 'Arial'
            r._element.rPr.rFonts.set(qn('w:eastAsia'), 'Microsoft YaHei')
            p.paragraph_format.space_after = Pt(1)
    if widths:
        for i, w in enumerate(widths):
            for row in t.rows:
                row.cells[i].width = Cm(w)
    for row in t.rows:
        trPr = row._tr.get_or_add_trPr()
        trPr.append(OxmlElement('w:cantSplit'))
    doc.add_paragraph()
    return t

def bullet(text):
    p = doc.add_paragraph(style='List Bullet')
    p.add_run(text)
    p.paragraph_format.space_after = Pt(2)

p = doc.add_paragraph()
r = p.add_run('MOSS CORE')
r.bold = True
r.font.size = Pt(11)
r.font.color.rgb = RGBColor(0x8A, 0x6A, 0x2A)
p = doc.add_paragraph()
r = p.add_run('单代币三窗口内容定义')
r.bold = True
r.font.size = Pt(23)
p.paragraph_format.space_after = Pt(2)
p = doc.add_paragraph()
r = p.add_run('文档版本 v1.0  ·  2026-11-02  ·  学习稿，暂不开发')
r.font.size = Pt(9)
r.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

doc.add_paragraph()
p = doc.add_paragraph()
p.add_run('核心约束：').bold = True
p.add_run('一个代币只能有三个内容窗口，不再增加第四个。')

doc.add_heading('一、结论', level=1)
doc.add_paragraph('一个代币固定三个窗口：')
p = doc.add_paragraph()
r = p.add_run('NOW 当前信号    /    PROOF 证据与多签    /    TRACE 历史监控')
r.bold = True
r.font.size = Pt(13)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
table(
    ['窗口', '一句话定位', '默认打开方式'],
    [
        ['NOW', '现在发生了什么，为什么值得看', '点击代币行 / 当前卡'],
        ['PROOF', '凭什么相信，链上多签和行情证据是什么', '点击多签标记 / 多签金额'],
        ['TRACE', '这是新信号还是旧信号，之前发生过什么', '点击左侧模块 / 历史标签'],
    ],
    widths=[2.2, 8.8, 5.0],
)
doc.add_paragraph('三个窗口都只在主窗口内的同一个弹窗里切换，不新开软件窗口。')

doc.add_heading('二、为什么是三个，不是四个', level=1)
doc.add_paragraph('一个代币的决策链只有三段：现在值不值得看 → 凭什么相信 → 之前是不是已经看过。')
doc.add_paragraph('再多一个窗口就会开始重复：行情窗口重复六格、证据窗口重复 OI、历史窗口重复分数、设置窗口又把告警拆走。')
doc.add_paragraph('所以固定三个，其他内容只能作为这三个窗口里的折叠区、链接或空状态，不再单独开窗。')

doc.add_heading('三、窗口一：NOW · 当前信号', level=1)
doc.add_heading('3.1 回答的问题', level=2)
p = doc.add_paragraph()
r = p.add_run('现在是什么阶段？为什么现在提醒？位置高不高？风险在哪里？')
r.font.size = Pt(11)
p.paragraph_format.left_indent = Cm(0.6)

doc.add_heading('3.2 必须放的内容', level=2)
table(
    ['区块', '内容'],
    [
        ['标题', '币种、自选/导入、当前阶段、分数、最后更新时间'],
        ['六格', '24H / 5M / 1M QV / 全网 OI / 回撤 / 策略分'],
        ['结论', '一句话说明为什么现在看'],
        ['触发原因', '动量、成交额、OI、回撤、多签等命中的条件'],
        ['位置', '24H 高低位、距高点、北京日涨跌'],
        ['风险', '10x / 20x 止损参考、失效条件、数据缺失项'],
        ['数据', '数据源、更新时间、新鲜度、是否过期'],
    ],
    widths=[2.8, 13.2],
)

doc.add_heading('3.3 不应该放的内容', level=2)
for text in ['完整多签历史列表', '完整历史触发时间线', '所有 1/5/15/30/60 周期明细', '盘口逐档、逐笔成交', '资金费率的完整历史']:
    bullet(text)
doc.add_paragraph('这些放在 PROOF 或 TRACE 里，避免 NOW 变成大杂烩。')

doc.add_heading('3.4 视觉', level=2)
for text in ['自选：暗金主值、暖金强调。', '导入：灰白主值、低亮强调。', '数据缺失：灰色“待核验”。', '数据过期：灰色或暗红“已过期”。', '新鲜态：15 分钟边框/背景流光，之后恢复普通态。']:
    bullet(text)

doc.add_heading('四、窗口二：PROOF · 证据与多签', level=1)
doc.add_heading('4.1 回答的问题', level=2)
p = doc.add_paragraph()
r = p.add_run('这个信号有没有链上或行情证据？多签累计是多少？数据是不是可信、是不是过期？')
r.font.size = Pt(11)
p.paragraph_format.left_indent = Cm(0.6)

doc.add_heading('4.2 必须放的内容', level=2)
doc.add_paragraph('A. 多签证明', style='Heading 3')
table(
    ['字段', '说明'],
    [
        ['累计额度', '从第一条记录开始只加不减'],
        ['记录笔数', '累计记录数量'],
        ['本次新增', '最近一条新增金额'],
        ['币种 / 链', '代币与链'],
        ['多签地址', '地址及标签（如可得）'],
        ['签名门槛', '例如 2/3、3/5'],
        ['代币数量', '本次新增对应数量'],
        ['当时 USD', '记录时点的美元价值'],
        ['占流通比例', '如可得，缺失写“待核验”'],
        ['数据来源', '链上 / 数据商 / 公开页'],
        ['验证时间', '最后一次核验时间'],
        ['证据链接', '区块浏览器或数据源链接'],
    ],
    widths=[3.4, 12.6],
)
doc.add_paragraph('口径必须写清楚：只记录多签额度新增；累计全部历史；只加不减；不追踪流入流出；不扣减；不算当前余额；不判断资金方向。')

doc.add_paragraph('B. 行情证据', style='Heading 3')
for text in ['OI 5M / 15M / 30M / 1H 变化', '成交额 / 均量比', '盘口深度 / 滑点', '资金费率', '持续资金 30s / 60s', '聪明钱 / 参与者（数据可用时）']:
    bullet(text)
doc.add_paragraph('这些数据不重复六格主值，只展示“支撑/不支撑”的证据。')

doc.add_paragraph('C. 数据质量', style='Heading 3')
p = doc.add_paragraph()
r = p.add_run('哪些字段是实时的；哪些是延迟的；哪些缺失；哪些已过期。')
r.font.size = Pt(10.5)
p.paragraph_format.left_indent = Cm(0.6)

doc.add_heading('4.3 不应该放的内容', level=2)
for text in ['当前六格的重复大数字', '完整历史触发时间线', '交易建议或自动下单按钮']:
    bullet(text)

doc.add_heading('4.4 多签触发口径', level=2)
p = doc.add_paragraph()
r = p.add_run('本次新增 ≥ 200,000 USD\n或\n累计额度首次达到/超过 200,000 USD')
r.font.name = 'Consolas'
r.font.size = Pt(10.5)
p.paragraph_format.left_indent = Cm(0.8)
doc.add_paragraph('播报格式：本次新增 +1,000,000；累计额度 1,200,000；记录 2 笔。')

doc.add_heading('五、窗口三：TRACE · 历史监控', level=1)
doc.add_heading('5.1 回答的问题', level=2)
p = doc.add_paragraph()
r = p.add_run('这是新信号还是旧信号？之前升级/降级过吗？上次触发是什么时候？OI 和多签之前有没有异动？')
r.font.size = Pt(11)
p.paragraph_format.left_indent = Cm(0.6)

doc.add_heading('5.2 必须放的内容', level=2)
table(
    ['区块', '内容'],
    [
        ['统计', '今日/近 3 天/近 7 天/全部触发次数'],
        ['时间线', '时间、触发类型、阶段、分数、原因'],
        ['阶段变化', '初筛 → 候选 → 开仓，或降级'],
        ['OI 事件', '快增 / 快退'],
        ['多签事件', '累计首次过阈值 / 单笔大额'],
        ['重新进入', '离开后再次进入监控'],
        ['数据', '触发时快照、数据源、缺失项'],
    ],
    widths=[2.8, 13.2],
)
doc.add_paragraph('只记录：进入初筛观察、升级重点候选、升级开仓信号、降级、OI 快增/快退、多签累计达到阈值、低市值进入初筛、重新进入监控。不记录每一次普通扫描。')

doc.add_heading('5.3 不应该放的内容', level=2)
for text in ['当前六格完整重复', '全部原始行情 K 线', '逐笔成交', '没有触发的日常扫描日志']:
    bullet(text)

doc.add_heading('5.4 交互', level=2)
for text in ['今天 / 近 3 天 / 近 7 天 / 全部。', '点击某条事件 → 回到该时点的 NOW 快照。', '默认滚到最新。', '可导出。']:
    bullet(text)

doc.add_heading('六、三个窗口的数据归属', level=1)
table(
    ['数据', 'NOW', 'PROOF', 'TRACE'],
    [
        ['当前价格/24H', '主', '引用', '事件时点'],
        ['5M 动量', '主', '引用', '事件时点'],
        ['1M QV', '主', '引用', '事件时点'],
        ['全网 OI', '主', '5M/15M 证据', '事件时点'],
        ['回撤', '主', '—', '事件时点'],
        ['策略分/阶段', '主', '—', '事件时点'],
        ['多签累计', '摘要', '主', '事件'],
        ['多签记录', '—', '主', '事件'],
        ['历史触发', '—', '—', '主'],
        ['盘口/资金费率', '摘要', '主', '—'],
        ['数据质量', '摘要', '主', '事件'],
    ],
    widths=[4.2, 3.2, 4.2, 4.4],
)
doc.add_paragraph('原则：NOW 放结论和当前值；PROOF 放证据和可信度；TRACE 放时间和变化。')

doc.add_heading('七、打开路径', level=1)
for text in ['点击左侧代币行 → NOW。', '点击底部当前卡 → NOW。', '点击多签标记 / 多签金额 → PROOF。', '点击左侧模块标题 → TRACE。', '点击右上多签窗口 → PROOF 或按币种进入 PROOF。', '弹窗内部只在这三个窗口之间切换。']:
    bullet(text)

doc.add_heading('八、空状态', level=1)
table(
    ['窗口', '空状态'],
    [
        ['NOW', '数据未齐，显示“待核验”，不生成假分数'],
        ['PROOF', '暂无多签记录，显示“—”，不写 0'],
        ['TRACE', '尚未触发，显示“暂无监控事件”'],
    ],
    widths=[3.0, 13.0],
)

doc.add_heading('九、不做的事情', level=1)
for text in ['不新开第四个窗口。', '不把设置、告警、原始数据拆成新窗。', '不自动下单。', '不把多签解释成资金流入。', '不把“多签出现”直接写成“市值团队介入”。', '不在三个窗口之间重复展示同一组大数字。']:
    bullet(text)

doc.add_paragraph()
p = doc.add_paragraph()
r = p.add_run('一句话总结：NOW 回答“为什么现在看”，PROOF 回答“凭什么相信”，TRACE 回答“是不是已经看过”。一个代币只保留这三个窗口，其他信息全部降级为区块、折叠或链接。')
r.bold = True
r.font.size = Pt(11)

doc.save(OUT)
print(OUT)
