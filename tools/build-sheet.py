#!/usr/bin/env python3
"""全关卡指标汇总 → Excel（三个工作表：全部关卡 / 分章汇总 / 指标说明）。"""
import json
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

rows = json.load(open('.tmp/levels.json'))

wb = Workbook()

# ---------------------------------------------------------------- 样式
HEAD_FILL = PatternFill('solid', fgColor='1F3864')
HEAD_FONT = Font(name='PingFang SC', bold=True, color='FFFFFF', size=11)
BODY_FONT = Font(name='PingFang SC', size=10)
TIER_FILLS = {
    'S': PatternFill('solid', fgColor='C6EFCE'),
    'A': PatternFill('solid', fgColor='DDEBF7'),
    'B': PatternFill('solid', fgColor='FFF2CC'),
}
PASS_FILL = PatternFill('solid', fgColor='C6EFCE')
FAIL_FILL = PatternFill('solid', fgColor='FFC7CE')
THIN = Side(style='thin', color='B7C3D0')
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# ---------------------------------------------------------------- Sheet 1: 全部关卡
ws = wb.active
ws.title = '全部关卡'

headers = [
    ('关号', 8), ('类型', 11), ('世界', 7), ('章', 6), ('章内步', 7),
    ('模式', 8), ('形态', 9), ('盘面', 10), ('箭数', 7), ('密度', 8),
    ('链接深度', 9), ('评分', 7), ('等级', 6), ('达标线', 8), ('达标', 6),
    ('跨度分', 8), ('反斑马分', 9), ('包络分', 8), ('单解分', 8), ('最长龙', 8), ('单解步', 8), ('跃迁距', 8), ('连环扣', 8),
    ('初始可释放', 10), ('冻结数', 8), ('Boss', 6), ('空格', 7), ('填充率', 8),
    ('巨蟒数', 8), ('斑马率%', 9), ('穿针处', 8), ('限时(s)', 8),
]
for c, (name, w) in enumerate(headers, 1):
    cell = ws.cell(row=1, column=c, value=name)
    cell.fill = HEAD_FILL
    cell.font = HEAD_FONT
    cell.alignment = Alignment(horizontal='center', vertical='center')
    cell.border = BORDER
    ws.column_dimensions[get_column_letter(c)].width = w
ws.freeze_panes = 'A2'
ws.auto_filter.ref = f'A1:{get_column_letter(len(headers))}{len(rows) + 1}'

for i, r in enumerate(rows, 2):
    vals = [
        r['label'], r['kind'], f"W{r['world']}", r['chapter'], r['step'],
        r['mode'], r['shape'], f"{r['cols']}×{r['rows']}", r['arrows'],
        round(r['density'], 3), r['depth'], r['score'], r['tier'], r['gate'],
        '✓' if r['pass'] else '✗',
        r['subHierarchy'], r['subAntiZebra'], r['subCavity'], r['subTopo'], r['maxArrowLen'], r['strictlyOne'], r['avgJump'], r['knots'],
        r['initialMovable'], r['frozen'], r['boss'], r['empty'],
        f"{r['fillRate'] * 100:.1f}%", r['giant'], r['zebra'], r['deceptive'],
        r['time'],
    ]
    for c, v in enumerate(vals, 1):
        cell = ws.cell(row=i, column=c, value=v)
        cell.font = BODY_FONT
        cell.border = BORDER
        cell.alignment = Alignment(horizontal='center')
    tier_col = ws.cell(row=i, column=13)
    if r['tier'] in TIER_FILLS:
        tier_col.fill = TIER_FILLS[r['tier']]
    pass_col = ws.cell(row=i, column=15)
    pass_col.fill = PASS_FILL if r['pass'] else FAIL_FILL

# ---------------------------------------------------------------- Sheet 2: 分章汇总
ws2 = wb.create_sheet('分章汇总')
sum_headers = [
    ('世界', 7), ('章', 6), ('盘面数', 8), ('总箭数', 8), ('平均箭数', 9),
    ('平均链深', 9), ('平均评分', 9), ('最低分', 8), ('S/A/B', 10),
    ('未达标', 8), ('平均初始可释放', 13), ('平均冻结', 9),
]
for c, (name, w) in enumerate(sum_headers, 1):
    cell = ws2.cell(row=1, column=c, value=name)
    cell.fill = HEAD_FILL
    cell.font = HEAD_FONT
    cell.alignment = Alignment(horizontal='center', vertical='center')
    cell.border = BORDER
    ws2.column_dimensions[get_column_letter(c)].width = w
ws2.freeze_panes = 'A2'

# 全局行
def agg(sub):
    n = len(sub)
    if not n:
        return []
    scores = [x['score'] for x in sub]
    tiers = {'S': 0, 'A': 0, 'B': 0}
    for x in sub:
        if x['tier'] in tiers:
            tiers[x['tier']] += 1
    return [
        '', '', n, sum(x['arrows'] for x in sub), round(sum(x['arrows'] for x in sub) / n, 1),
        round(sum(x['depth'] for x in sub) / n, 1), round(sum(scores) / n, 1), min(scores),
        f"{tiers['S']}/{tiers['A']}/{tiers['B']}",
        sum(0 if x['pass'] else 1 for x in sub),
        round(sum(x['initialMovable'] for x in sub) / n, 1),
        round(sum(x['frozen'] for x in sub) / n, 1),
    ]

row_i = 2
total = agg(rows)
ws2.cell(row=row_i, column=1, value='全部').font = Font(name='PingFang SC', bold=True, size=10)
for c, v in enumerate(total, 1):
    cell = ws2.cell(row=row_i, column=c if c > 1 else 2, value=v)
    cell.font = Font(name='PingFang SC', bold=True, size=10)
    cell.alignment = Alignment(horizontal='center')
row_i += 1

for world in range(1, 6):
    wrows = [x for x in rows if x['world'] == world]
    line = agg(wrows)
    ws2.cell(row=row_i, column=1, value=f'W{world}').font = Font(name='PingFang SC', bold=True, size=10)
    for c, v in enumerate(line, 1):
        if c == 1:
            continue
        cell = ws2.cell(row=row_i, column=c if c >= 2 else 2, value=v)
        cell.font = BODY_FONT
        cell.alignment = Alignment(horizontal='center')
    row_i += 1
    for ch in range((world - 1) * 5 + 1, world * 5 + 1):
        crows = [x for x in rows if x['chapter'] == ch]
        if not crows:
            continue
        line = agg(crows)
        ws2.cell(row=row_i, column=1, value=f'W{world}').font = BODY_FONT
        cell = ws2.cell(row=row_i, column=2, value=ch)
        cell.font = BODY_FONT
        cell.alignment = Alignment(horizontal='center')
        rest = [v for j, v in enumerate(line) if j not in (0, 1)]
        for c, v in enumerate(rest, 3):
            cell = ws2.cell(row=row_i, column=c, value=v)
            cell.font = BODY_FONT
            cell.alignment = Alignment(horizontal='center')
        row_i += 1

# ---------------------------------------------------------------- Sheet 3: 关卡截图（如果有截图目录）
import os
from openpyxl.drawing.image import Image as XLImage

SHOT_DIR = '.tmp/shots'
if os.path.isdir(SHOT_DIR):
    wsS = wb.create_sheet('关卡截图')
    wsS.cell(row=1, column=1, value='关号').fill = HEAD_FILL
    wsS.cell(row=1, column=1).font = HEAD_FONT
    wsS.cell(row=1, column=2, value='评分').fill = HEAD_FILL
    wsS.cell(row=1, column=2).font = HEAD_FONT
    wsS.cell(row=1, column=3, value='盘面截图').fill = HEAD_FILL
    wsS.cell(row=1, column=3).font = HEAD_FONT
    wsS.column_dimensions['A'].width = 10
    wsS.column_dimensions['B'].width = 8
    wsS.column_dimensions['C'].width = 30
    wsS.freeze_panes = 'A2'

    r_i = 2
    missing = 0
    for r in rows:
        label = r['label']
        fname = None
        if r['kind'] in ('主线', '彩蛋'):
            fname = f"L{label}.png" if r['kind'] == '主线' else 'L501.png'
        else:
            part = r['kind'].replace('Boss部件', '').replace('/3', '')
            # 部件 1 复用主截图文件（L{id}.png），部件 2/3 是 L{id}-2/-3.png
            fname = f"L{label}.png" if part == '1' else f"L{label}-{part}.png"
        path = os.path.join(SHOT_DIR, fname)
        cellA = wsS.cell(row=r_i, column=1, value=label + ('★' if r['kind'] == '彩蛋' else ''))
        cellA.font = BODY_FONT
        cellA.alignment = Alignment(horizontal='center')
        cellB = wsS.cell(row=r_i, column=2, value=r['score'])
        cellB.font = BODY_FONT
        cellB.alignment = Alignment(horizontal='center')
        if r['tier'] in TIER_FILLS:
            cellB.fill = TIER_FILLS[r['tier']]
        if os.path.exists(path):
            img = XLImage(path)
            scale = 150 / img.width
            img.width = 150
            img.height = int(img.height * scale)
            wsS.row_dimensions[r_i].height = img.height * 0.78
            img.anchor = f'C{r_i}'
            wsS.add_image(img)
        else:
            missing += 1
            wsS.cell(row=r_i, column=3, value='(无截图)').font = BODY_FONT
        r_i += 1
    print(f'截图工作表: {r_i - 2} 行, 缺图 {missing}')

# ---------------------------------------------------------------- Sheet 4: 指标说明
ws3 = wb.create_sheet('指标说明')
notes = [
    ['指标', '口径'],
    ['链接深度', '拓扑剥洋葱层数：解开整盘所需的「波」数，越深越烧脑'],
    ['评分（0~100）', '五维之和 − 空格惩罚；S≥85 / A≥75 / B≥65 / C 不允许出现'],
    ['箭量分（25）', '绝对箭数（每 8 箭 1 分，封顶 16）+ 密度（0.15 箭/格满档，9 分）'],
    ['跨度分（20）', '巨蟒（≥12 格）数量 + 长度标准差 + 平均长度，惩罚碎短箭'],
    ['反斑马分（20）', '相邻异箭同向平行占比；30% 满分线、55% 零点（满铺基准校准）'],
    ['包络分（10）', '大箭包围内部箭形成的嵌套腔体数量与包围格数'],
    ['拓扑分（25）', '剥洋葱深度 + 外圈向心率 + 开局可动箭数收敛'],
    ['空格惩罚（0~20）', '按填充率计：≥99% 不罚，越稀疏扣越多'],
    ['达标线', '大盘（≥1200 格）70 / 中盘（≥600 格）68 / 小盘 60；低于即自动换种子重摇'],
    ['初始可释放', '生成时即可点击飞出的箭数（含 Boss 可飞；冻结箭不计）'],
    ['密度', '箭数 ÷ 可放格数（mask 关按剪影面积）'],
    ['填充率', '1 − 空格数 ÷ 可放格数'],
    ['Boss 箭', '双倍宽蓝色巨箭：两条射线（头部列 + 右侧一列）必须同时畅通才能飞'],
    ['冻结箭', 'L41 起：冰封不可飞、照常挡道；旁边累计飞走 2 支箭解冻'],
    ['模式', 'normal 常规 / sprint 冲刺（限时减半、爱心 5）/ boss 三连打 / zen 禅意（无时限）'],
    ['类型', '主线 500 关 / Boss部件 = 每章 L19 的 3 小盘（世界二起）/ 彩蛋 = 千层箭阵 501'],
]
ws3.column_dimensions['A'].width = 16
ws3.column_dimensions['B'].width = 90
for i, (a, b) in enumerate(notes, 1):
    ca = ws3.cell(row=i, column=1, value=a)
    cb = ws3.cell(row=i, column=2, value=b)
    if i == 1:
        ca.fill = HEAD_FILL
        cb.fill = HEAD_FILL
        ca.font = HEAD_FONT
        cb.font = HEAD_FONT
    else:
        ca.font = Font(name='PingFang SC', bold=True, size=10)
        cb.font = BODY_FONT
    ca.alignment = Alignment(vertical='center')
    cb.alignment = Alignment(vertical='center', wrap_text=True)

wb.save('docs/全关卡指标汇总.xlsx')
n = len(rows)
s = sum(1 for x in rows if x['tier'] == 'S')
a = sum(1 for x in rows if x['tier'] == 'A')
b = sum(1 for x in rows if x['tier'] == 'B')
f = sum(1 for x in rows if not x['pass'])
avg = sum(x['score'] for x in rows) / n
arrows = sum(x['arrows'] for x in rows) / n
print(f'已生成 docs/全关卡指标汇总.xlsx：{n} 行 | S{s}/A{a}/B{b} | 未达标{f} | 均分{avg:.1f} | 平均箭数{arrows:.0f}')
