from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

OUT = r"D:\数据库\docs\requirements\05-第二参考站对比与底部六格字段分析-v1.0.docx"

doc = Document()
section = doc.sections[0]
section.top_margin = Cm(1.8)
section.bottom_margin = Cm(1.8)
section.left_margin = Cm(2.0)
section.right_margin = Cm(2.0)

# Base fonts: Arial for Latin, Microsoft YaHei for CJK.
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
    tblHeader = OxmlElement('w:tblHeader')
    tblHeader.set(qn('w:val'), 'true')
    trPr.append(tblHeader)
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
        cantSplit = OxmlElement('w:cantSplit')
        trPr.append(cantSplit)
    doc.add_paragraph()
    return t

def bullet(text):
    p = doc.add_paragraph(style='List Bullet')
    p.add_run(text)
    p.paragraph_format.space_after = Pt(2)

# Title
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.LEFT
r = p.add_run('MOSS CORE')
r.bold = True
r.font.size = Pt(11)
r.font.color.rgb = RGBColor(0x8A, 0x6A, 0x2A)
p = doc.add_paragraph()
r = p.add_run('第二参考站对比与底部六格字段建议')
r.bold = True
r.font.size = Pt(22)
p.paragraph_format.space_after = Pt(2)
p = doc.add_paragraph()
r = p.add_run('文档版本 v1.0  ·  2026-11-02  ·  分析稿')
r.font.size = Pt(9)
r.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

doc.add_paragraph()
p = doc.add_paragraph()
p.add_run('参考站一：').bold = True
p.add_run('NOVA LAB  https://novalive.cn/lab/')
p = doc.add_paragraph()
p.add_run('参考站二：').bold = True
p.add_run('币安合约监控  http://43.106.19.243:8765/market-signals')
p = doc.add_paragraph()
p.add_run('说明：').bold = True
p.add_run('本文只做信息结构对比和字段建议，不代表已获得第二站的数据接口或生产依赖授权。')

doc.add_heading('一、结论', level=1)
p = doc.add_paragraph('底部六格建议固定为：')
p = doc.add_paragraph()
r = p.add_run('24H 涨跌  /  5M 动量  /  1M QV + 持续资金  /  全网 OI  /  回撤  /  策略分 + 阶段')
r.bold = True
r.font.size = Pt(12)
p.alignment = WD_ALIGN_PARAGRAPH.CENTER

doc.add_paragraph('推荐显示标签：')
p = doc.add_paragraph()
r = p.add_run('24H        5M        1M QV        全网 OI        回撤        策略分')
r.font.name = 'Consolas'
r.font.size = Pt(11)
r.bold = True
p.alignment = WD_ALIGN_PARAGRAPH.CENTER

doc.add_paragraph('这六格不是简单照搬任何一个站，而是把两站的信息压缩成六个能直接回答“现在能不能看、为什么看、风险在哪”的锚点。')
doc.add_paragraph('NOVA 负责分数、阶段、阈值、24H、QV、动量和回撤；第二站负责多周期动量、持续资金、成交/盘口、OI 多周期和风险说明；MOSS 只保留主窗口真正需要的一眼信息。')

doc.add_heading('二、两个站的核心差异', level=1)
table(
    ['维度', 'NOVA LAB', '第二站·币安合约监控', 'MOSS 取舍'],
    [
        ['目标', '从全市场筛出阶段信号', '对固定名单做实时异动确认', '先导入/自选，再做阶段确认'],
        ['时间粒度', '1m / 3m / 5m / 15m / 24h', '1 / 5 / 15 / 30 / 60 分钟', '六格只放 5M，完整周期放详情'],
        ['资金', 'QV 作为阈值之一', '持续资金趋势、30/60 秒资金、现货参照', '1M QV 主值，持续资金做副值'],
        ['持仓', 'OI 辅助确认', 'OI 多周期、增仓阶段、质量、增量', 'OI 主值，5M/15M 变化做副值'],
        ['盘口', '深度/风险辅助', '成交、盘口、滑点、买卖墙', '六格不展开，放详情'],
        ['风险', '回撤、风控参考', '风险/下一步、退出警戒、阻断原因', '回撤进六格，完整判断放详情'],
        ['多签', '不做主界面', '无同口径多签', 'MOSS 保留独立多签窗口'],
        ['结论', '分数 + 阶段', '状态 + 决策盒', '分数 + 阶段，六格最后一格'],
    ],
    widths=[2.2, 4.4, 5.6, 4.6],
)

doc.add_heading('三、第二站真正新增的信息', level=1)

doc.add_heading('3.1 多周期动量', level=2)
doc.add_paragraph('第二站同时观察 1m / 5m / 15m / 30m / 60m，比 NOVA 的 1m / 3m / 5m 更适合判断“刚启动”还是“已经走了很久”。')
doc.add_paragraph('但六格不能放五个周期，否则会变成小表格。建议六格只显示 5M 主值，副值显示 1m / 3m，弹窗里再显示完整五段。')

doc.add_heading('3.2 持续资金', level=2)
doc.add_paragraph('第二站把“持续资金”作为独立列，并拆分资金 30 秒 / 60 秒、偏多 / 偏空、现货参照。这是第二站最有价值的新增信息之一。')
doc.add_paragraph('六格没有第七格，建议把它压进 1M QV 的副值：')
p = doc.add_paragraph()
r = p.add_run('主值：1M QV 70.5K\n副值：资金 +3.2M · 30s 偏多')
r.font.name = 'Consolas'
r.font.size = Pt(10.5)
p.paragraph_format.left_indent = Cm(0.8)
doc.add_paragraph('这样既保留 NOVA 的 QV 阈值，也保留第二站的“资金是不是持续”的判断。')

doc.add_heading('3.3 OI 多周期与质量', level=2)
doc.add_paragraph('第二站不是只给一个 OI 数字，而是给 5m / 15m / 30m / 1h 变化、增仓阶段、OI 增量质量、价格-OI 同步/背离、数据是否新鲜。')
doc.add_paragraph('六格建议：')
p = doc.add_paragraph()
r = p.add_run('主值：全网 OI\n副值：5M +6.2% · 15M +11.8%')
r.font.name = 'Consolas'
r.font.size = Pt(10.5)
p.paragraph_format.left_indent = Cm(0.8)
doc.add_paragraph('如果 OI 数据缺失或过期，必须明确写“待核验/已过期”，不能显示一个看似正常的旧值。')

doc.add_heading('3.4 风险 / 下一步', level=2)
doc.add_paragraph('第二站把结论拆成状态、决策盒、复核阶段、路径风险和阻断原因，比单纯给一个分数更可解释。')
doc.add_paragraph('MOSS 的六格用回撤 + 策略分/阶段承接，完整“下一步”放在弹窗，不塞进六格。')

doc.add_heading('3.5 资金确认、重点观察、自选', level=2)
doc.add_paragraph('第二站有全部 / 我的自选 / 重点观察 / 持仓快增 / 资金确认 / HYPE / Alpha / 韩所买盘等入口，验证了 MOSS 的导入、自选、多签三个模块划分是成立的。')
doc.add_paragraph('MOSS 不照搬多标签页，仍保持一个主窗口 + 左侧两个模块。')

doc.add_heading('四、底部六格最终建议', level=1)
table(
    ['位置', '推荐标签', '主值', '副值', '回答的问题'],
    [
        ['1', '24H', '24 小时涨跌幅', '北京日涨跌 / 距 24H 高点', '这个位置是不是已经太高？'],
        ['2', '5M', '5 分钟动量', '1m / 3m 动量', '是不是刚刚启动？'],
        ['3', '1M QV', '1 分钟成交额', '持续资金 30s/60s · 成交/均量', '有没有真实成交和持续资金？'],
        ['4', '全网 OI', '当前全网持仓', '5M / 15M 变化 · 数据新鲜度', '持仓是在配合还是背离？'],
        ['5', '回撤', '距 24H 高点回撤', '触发后最大回撤', '追进去的风险有多大？'],
        ['6', '策略分', '0–100 分', 'ENTRY / WATCH / LOW / 观察', '现在处于哪个阶段？'],
    ],
    widths=[1.0, 2.2, 3.6, 5.8, 4.8],
)

doc.add_heading('4.1 为什么是这六个', level=2)
for text in [
    '24H：判断位置，防止把已经走完的币当成刚启动。',
    '5M：判断触发速度，是主信号，不是辅助。',
    '1M QV + 持续资金：判断流动性和资金是否持续；只有成交没有持续资金，容易是脉冲。',
    '全网 OI：判断持仓是否配合；价格涨、OI 不涨，信号质量下降。',
    '回撤：判断追高风险；没有回撤数据的信号不能直接给高置信度。',
    '策略分 / 阶段：把前面五个量收束成一个可执行的结论。',
]:
    bullet(text)

doc.add_heading('4.2 为什么不再加第七格', level=2)
for text in [
    '资金费率：重要，但属于持有成本，不是入场第一判断；放详情。',
    '盘口深度：重要，但变化快，六格固定显示容易过期；放详情。',
    '聪明钱 / 参与者：第二站有，但数据源和口径还不稳定；先放详情，验证后再考虑。',
    '多签：MOSS 的独立模块，不能挤进行情六格。',
    '完整 1/5/15/30/60：信息密度过高，六格会变成表格；5M 主值 + 弹窗完整周期更合理。',
]:
    bullet(text)

doc.add_heading('五、六格的显示规则', level=1)
doc.add_heading('5.1 主次颜色', level=2)
for text in [
    '自选：暗金主值，暖金副值。',
    '导入：灰白主值，低亮副值。',
    '数据缺失：灰色“待核验”。',
    '数据过期：暗红或灰色“已过期”，不能沿用旧值装作实时。',
]:
    bullet(text)

doc.add_heading('5.2 新鲜度', level=2)
doc.add_paragraph('每个值都应该能追溯到更新时间、数据源和缺失项。建议在六格底部或弹窗里显示：')
p = doc.add_paragraph()
r = p.add_run('数据时间：15:42:31\n数据源：公开行情 / 公开多签\n缺失项：OI 待核验')
r.font.name = 'Consolas'
r.font.size = Pt(10)
p.paragraph_format.left_indent = Cm(0.8)

doc.add_heading('5.3 联动', level=2)
for text in [
    '默认跟随自选卡。',
    '点导入卡，六格切到导入币。',
    '点自选卡，六格切回自选币。',
    '新流星到达只更新对应卡片/窗口。',
    '15 分钟内保持新鲜态，超过 15 分钟恢复普通态。',
]:
    bullet(text)

doc.add_heading('六、与第二站的字段对齐', level=1)
table(
    ['第二站列', 'MOSS 放置'],
    [
        ['币种 / 状态', '左侧队列 + 卡片标题'],
        ['价格 / 涨跌幅', '六格 24H'],
        ['1 / 5 / 15 / 30 / 60 分钟', '六格 5M + 副值 1m/3m + 弹窗完整周期'],
        ['持续资金', '六格 1M QV 副值 + 弹窗'],
        ['成交 / 盘口', '六格 1M QV 主值 + 弹窗盘口'],
        ['持仓 / 聪明钱 / 参与者', '六格 OI + 弹窗'],
        ['风险 / 下一步', '六格 回撤 + 策略分/阶段 + 弹窗决策'],
    ],
    widths=[5.0, 11.0],
)

doc.add_heading('七、待确认', level=1)
for text in [
    '全网 OI 的数据源是否稳定到可以放主六格？',
    '持续资金 30s/60s 是否能在 MOSS 的数据链里拿到？',
    '回撤按“距 24H 高点”还是“触发后最大回撤”？',
    '北京日涨跌是否作为 24H 副值，还是只在详情显示？',
    '六格默认跟随自选，是否保留“锁定当前币”开关？',
]:
    bullet(text)

doc.add_paragraph()
p = doc.add_paragraph()
r = p.add_run('最终建议一句话：六格不要做成第二站的缩略表，而要成为“一眼判断信号质量”的六个锚点：位置、速度、流动性、持仓、风险、结论。')
r.bold = True
r.font.size = Pt(11)

doc.save(OUT)
print(OUT)
