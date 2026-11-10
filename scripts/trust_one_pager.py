"""Render a one-page product-design poster for the merchant-trust design.

Pillow-only: no browser / LibreOffice needed.
Output: docs/screenshots/trust-one-pager.png
"""

from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "screenshots", "trust-one-pager.png")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

S = 2  # supersampling
W, H = 1440, 2600
M = 72

INK = "#101828"
INK2 = "#344054"
MUTED = "#667085"
LINE = "#E4E7EC"
PAPER = "#F7F5F2"
CARD = "#FFFFFF"
BLUE = "#1D4ED8"
BLUE_SOFT = "#EEF2FF"
ORANGE = "#E8590C"
ORANGE_SOFT = "#FFF4ED"
GREEN = "#067647"
GREEN_SOFT = "#ECFDF3"
GRAY_BG = "#F2F4F7"

FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_LIGHT = r"C:\Windows\Fonts\msyhl.ttc"


def F(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, int(size * S))


def px(v: float) -> int:
    return int(round(v * S))


img = Image.new("RGB", (px(W), px(H)), PAPER)
d = ImageDraw.Draw(img)


def tw(text: str, font: ImageFont.FreeTypeFont) -> float:
    return d.textlength(text, font=font)


def wrap(text: str, font: ImageFont.FreeTypeFont, max_w: float) -> list[str]:
    """Greedy wrap; CJK per character, Latin by word when possible.

    ``max_w`` is in logical px; text measurements are in supersampled px.
    """
    limit = max_w * S
    lines: list[str] = []
    line = ""
    token = ""
    def flush_token():
        nonlocal line, token
        if not token:
            return
        if tw(line + token, font) <= limit or not line:
            line += token
        else:
            lines.append(line)
            line = token
        token = ""
    for ch in text:
        if ch == "\n":
            flush_token()
            lines.append(line)
            line = ""
        elif ch.isascii() and (ch.isalnum() or ch in "-_/%."):
            token += ch
        else:
            flush_token()
            if tw(line + ch, font) <= limit or not line:
                line += ch
            else:
                lines.append(line)
                line = ch
    flush_token()
    if line:
        lines.append(line)
    return lines


def text(
    x: float,
    y: float,
    s: str,
    size: float,
    color: str = INK,
    bold: bool = False,
    max_w: float | None = None,
    lh: float = 1.55,
    align: str = "left",
) -> float:
    font = F(size, bold)
    lines = wrap(s, font, max_w) if max_w else s.split("\n")
    step = size * lh
    for i, line in enumerate(lines):
        if align == "right":
            d.text((px(x), px(y + i * step)), line, font=font, fill=color, anchor="ra")
        elif align == "center":
            d.text((px(x + (max_w or 0) / 2), px(y + i * step)), line, font=font, fill=color, anchor="ma")
        else:
            d.text((px(x), px(y + i * step)), line, font=font, fill=color, anchor="la")
    return y + len(lines) * step


def rich_line(x: float, y: float, parts: list[tuple[str, str, bool]], size: float, lh: float = 1.2) -> float:
    """Draw a single line made of (text, color, bold) segments."""
    cx = x
    for s, color, bold in parts:
        font = F(size, bold)
        d.text((px(cx), px(y)), s, font=font, fill=color, anchor="la")
        cx += tw(s, font) / S
    return y + size * lh


def card(x: float, y: float, w: float, h: float, fill: str = CARD, outline: str = LINE, r: float = 18, shadow: bool = True):
    if shadow:
        d.rounded_rectangle([px(x + 2), px(y + 4), px(x + w + 2), px(y + h + 4)], radius=px(r), fill="#ECE9E4")
    d.rounded_rectangle([px(x), px(y), px(x + w), px(y + h)], radius=px(r), fill=fill, outline=outline, width=max(1, px(0.8)))


def dot(x: float, y: float, color: str = BLUE, r: float = 3.2):
    d.ellipse([px(x), px(y), px(x + 2 * r), px(y + 2 * r)], fill=color)


def divider(y: float):
    d.line([px(M), px(y), px(W - M), px(y)], fill=LINE, width=max(1, px(0.8)))


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
y = 58
d.line([px(M), px(y + 7), px(M + 26), px(y + 7)], fill=ORANGE, width=px(2))
text(M + 38, y - 5, "AGENT 产品设计 · 巨量投放方向 · 2026", 12.5, ORANGE, True)

y = 88
rich_line(M, y, [("让商家愿意把预算交给 ", INK, True), ("Agent", BLUE, True)], 55, 1.12)
y = 176
text(M, y, "可信投放控制台：不是“更聪明的 AI 投手”，而是一套让商家敢授权、敢扩权、也敢退出的机制。", 19, INK2, False, max_w=1080, lh=1.55)
y = 232
chips = ["商家 / 投手 / 服务商", "千川 · 乘方", "分析 → 建议 → 执行 → 对账", "信任 = 能力 × 善意 × 一致性 × 可预测性"]
cx = M
for c in chips:
    f = F(12)
    w = tw(c, f) / S + 24
    d.rounded_rectangle([px(cx), px(y), px(cx + w), px(y + 28)], radius=px(14), fill="#FBFAF8", outline=LINE, width=max(1, px(0.7)))
    d.text((px(cx + 12), px(y + 6)), c, font=f, fill=MUTED, anchor="la")
    cx += w + 8

divider(296)

# ---------------------------------------------------------------------------
# Problem
# ---------------------------------------------------------------------------
y = 326
rich_line(M, y, [("商家不是不接受自动化，", INK, True)], 31, 1.5)
y += 46
# highlight "不可逆的自动化"
prefix = "而是不接受"
f31 = F(31, True)
pw = tw(prefix, f31) / S
x2 = M + pw
phrase = "不可逆的自动化"
phw = tw(phrase, f31) / S
d.rectangle([px(x2 - 2), px(y + 36), px(x2 + phw + 2), px(y + 40)], fill="#FFD9C2")
d.text((px(M), px(y)), prefix, font=f31, fill=INK, anchor="la")
d.text((px(x2), px(y)), phrase, font=f31, fill=INK, anchor="la")
text(x2 + phw + 2, y, "。", 31, INK, True)
y += 64
text(
    M,
    y,
    "公开信息里，投手说“全域推广就是个黑盒，我根本不知道能控制什么”；广告主说“不会把程序化投放交给 LLM Agent”，因为一个小数点错误就可能是财务灾难。",
    14.5,
    MUTED,
    False,
    max_w=690,
    lh=1.75,
)

# fear grid
gx, gy = 812, 326
cw, chh, gap = 278, 78, 10
fears = [
    ("结果不可预期", "它会不会拿我的钱做实验？"),
    ("过程不可见", "它为什么这么干？"),
    ("权限不可控", "我能叫停、能限制吗？"),
    ("责任不可追", "出了事谁负责？"),
    ("能力不可评", "它凭什么让我信？"),
    ("关系不可逆", "我能不能走？"),
]
for i, (title, sub) in enumerate(fears):
    col, row = i % 2, i // 2
    x = gx + col * (cw + gap)
    yy = gy + row * (chh + gap)
    card(x, yy, cw, chh, r=13)
    text(x + 16, yy + 13, title, 14, INK, True)
    text(x + 16, yy + 42, sub, 12.2, MUTED, False, max_w=cw - 30)

# ---------------------------------------------------------------------------
# Thesis banner
# ---------------------------------------------------------------------------
y = 670
card(M, y, W - 2 * M, 200, fill=INK, outline=INK, r=22, shadow=True)
d.rounded_rectangle([px(M + 28), px(y + 28), px(M + 80), px(y + 80)], radius=px(14), fill=ORANGE)
d.text((px(M + 41), px(y + 34)), "“", font=F(34, True), fill="#FFFFFF", anchor="la")
text(M + 104, y + 22, "信任不是“相信模型更聪明”，\n而是“相信一套可授权、可预演、可熔断、可对账、可退出的机制”。", 24, "#FFFFFF", True, max_w=1100, lh=1.5)
text(M + 104, y + 126, "所以产品不叫 AI 投手，叫可信投放控制台：Agent 负责分析和提案，商家负责定边界。", 13.5, "#D0D5DD", False, max_w=1100, lh=1.5)

# ---------------------------------------------------------------------------
# Section head 1
# ---------------------------------------------------------------------------
y = 914
text(M, y, "四份合同：把信任变成可验证的承诺", 27, INK, True)
text(W - M, y + 6, "确认弹窗只解决“执行前看一眼”；真正决定商家敢不敢用的，是授权、证据、对账、退出四件事。", 12.8, MUTED, False, max_w=560, lh=1.6, align="right")

# ---------------------------------------------------------------------------
# Contracts
# ---------------------------------------------------------------------------
contracts = [
    ("01", "授权合同", "MANDATE", "钱与权限", ORANGE, ORANGE_SOFT, [
        "总预算 / 单日上限 / 单次动作上限 / 最大损失上限",
        "允许动作、排除场景（品牌、大促、跨账户）",
        "审批矩阵：低风险自动、中风险确认、高风险核对",
        "按账户/商品拆额度，到期自动失效",
    ], "商家给的不是一个“开关”，而是一张有额度、有范围、有期限、可撤销的授权书。"),
    ("02", "证据合同", "EVIDENCE", "为什么", BLUE, BLUE_SOFT, [
        "数据层：来源、口径、时间、样本、缺失",
        "逻辑层：依据、反事实、替代方案、置信区间",
        "责任层：谁批准、错了怎么办、怎么回滚",
        "给区间，不给假精确；给“不行动”选项",
    ], "每个结论和动作，都能被商家质疑、下钻、复现；不知道就说不知道。"),
    ("03", "对账合同", "LEDGER", "有没有用", GREEN, GREEN_SOFT, [
        "预测值 + 区间 + 置信度 + 方法 + 数据缺口",
        "校准曲线；分场景 / 分行业看准确率",
        "事故分级、披露时限、补偿规则、修复五步",
        "战绩可导出，不靠平台自说自话",
    ], "每个预测都登记，T+1/T+3/T+7 对实际；准确率公开，错误主动复盘。"),
    ("04", "退出合同", "EXIT", "能不能走", INK, GRAY_BG, [
        "一键暂停自动执行，保留只读分析",
        "一键撤销授权，待确认提案作废",
        "按时间窗 / 账户 / 动作批量回滚",
        "授权书、决策、对账、事故报告可导出",
    ], "退出权是信任的前提，不是信任的例外。"),
]
cy = 968
cw2, ch2, gap2 = 636, 286, 24
for i, (num, title, en, tag, accent, soft, bullets, body) in enumerate(contracts):
    col, row = i % 2, i // 2
    x = M + col * (cw2 + gap2)
    yy = cy + row * (ch2 + gap2)
    card(x, yy, cw2, ch2, r=18)
    # tag
    tf = F(11.2, True)
    twd = tw(tag, tf) / S + 20
    d.rounded_rectangle([px(x + cw2 - 20 - twd), px(yy + 18), px(x + cw2 - 20), px(yy + 42)], radius=px(12), fill=soft)
    d.text((px(x + cw2 - 20 - twd + 10), px(yy + 24)), tag, font=tf, fill=accent, anchor="la")
    text(x + 24, yy + 18, num, 46, "#EAECF0", True)
    text(x + 24, yy + 74, title, 20, INK, True)
    text(x + 24, yy + 106, en, 10.5, MUTED, True)
    text(x + 24, yy + 130, body, 13.2, INK2, False, max_w=cw2 - 48, lh=1.65)
    by = yy + 184
    for b in bullets:
        dot(x + 25, by + 6, accent, 2.8)
        by = text(x + 38, by, b, 12.8, INK2, False, max_w=cw2 - 70, lh=1.55) + 1

# ---------------------------------------------------------------------------
# Ladder
# ---------------------------------------------------------------------------
y = 1604
text(M, y, "一个信任阶梯：按额度给，不按功能给", 27, INK, True)
text(W - M, y + 6, "升级要慢、降级要快；降级不是惩罚，是保护。", 12.8, MUTED, False, max_w=420, lh=1.6, align="right")

ly = 1658
card(M, ly, W - 2 * M, 224, r=18)
steps = [
    ("L0", "观察", "只读分析、回答、复盘；不花钱。"),
    ("L1", "建议", "给建议和证据，商家自己执行。"),
    ("L2", "提案审批", "Agent 提案，人确认后执行；大多数商家的起点。"),
    ("L3", "额度内自动", "授权内自动执行，异常才找人。"),
    ("L4", "托管", "更大额度内自动，周度复盘。"),
]
sx0, sy0, sw, sh, sg = M + 24, ly + 24, 238, 112, 10
for i, (lv, name, desc) in enumerate(steps):
    x = sx0 + i * (sw + sg)
    on = i == 2
    d.rounded_rectangle([px(x), px(sy0), px(x + sw), px(sy0 + sh)], radius=px(14), fill=BLUE_SOFT if on else "#FCFCFD", outline=BLUE if on else LINE, width=px(1.2) if on else max(1, px(0.7)))
    text(x + 14, sy0 + 12, lv, 10.5, BLUE if on else MUTED, True)
    text(x + 14, sy0 + 30, name, 15.5, INK, True)
    text(x + 14, sy0 + 56, desc, 10.8, MUTED, False, max_w=sw - 26, lh=1.5)
# notes
text(M + 24, ly + 150, "升 L3：20+ 审批动作、预测误差 ≤15%、0 P0/P1 事故、商家主动开启", 11.8, MUTED, False, max_w=600)
text(M + 24, ly + 176, "降 L2：单次损失 > 上限 50%、误停 ≥2 次、预测误差 >25% 连续 2 周", 11.8, MUTED, False, max_w=600)
text(W - M - 24, ly + 150, "信任是挣来的，不是开通的。", 13.5, INK, True, max_w=320, align="right")

# ---------------------------------------------------------------------------
# Mechanisms
# ---------------------------------------------------------------------------
y = 1922
text(M, y, "四个关键机制：让机制跑起来", 27, INK, True)
text(W - M, y + 6, "影子模式先证明，探索保护防“人手痒”，熔断把最大损失写进产品，激励对齐解决平台 Agent 的原罪。", 12.8, MUTED, False, max_w=620, lh=1.6, align="right")

my = 1976
mechs = [
    ("shadow", "影子模式", "2–4 周只提案不执行，和人工决策对比；用“如果当时听它的”证明能力，再谈授权。"),
    ("pause", "探索保护", "学习期/爆发前标记“探索窗口”；“建议不动”是一等公民；人工干预先预演影响。"),
    ("bolt", "熔断止损", "ROI 连续低于底线、损失达上限 80%、动作失败率过高时，停止自动、保留人工、先止损再解释。"),
    ("scale", "激励对齐", "目标由商家定义；“不投放”是合法建议；账本可导出/第三方审计；收费透明。"),
]
mw, mh, mg = 306, 150, 16
for i, (icon, title, desc) in enumerate(mechs):
    x = M + i * (mw + mg)
    card(x, my, mw, mh, r=15)
    ix, iy = x + 18, my + 14
    c = ORANGE if icon == "bolt" else BLUE
    if icon == "shadow":
        d.ellipse([px(ix), px(iy), px(ix + 22), px(iy + 22)], outline=c, width=px(1.8))
        d.pieslice([px(ix), px(iy), px(ix + 22), px(iy + 22)], start=90, end=270, fill=c)
    elif icon == "pause":
        d.rounded_rectangle([px(ix + 3), px(iy + 2), px(ix + 9), px(iy + 20)], radius=px(2), fill=c)
        d.rounded_rectangle([px(ix + 13), px(iy + 2), px(ix + 19), px(iy + 20)], radius=px(2), fill=c)
    elif icon == "bolt":
        d.polygon([(px(ix + 12), px(iy)), (px(ix + 2), px(iy + 13)), (px(ix + 10), px(iy + 13)), (px(ix + 8), px(iy + 24)), (px(ix + 21), px(iy + 10)), (px(ix + 13), px(iy + 10))], fill=c)
    else:
        d.line([px(ix + 11), px(iy + 2), px(ix + 11), px(iy + 21)], fill=c, width=px(1.6))
        d.line([px(ix + 2), px(iy + 8), px(ix + 20), px(iy + 8)], fill=c, width=px(1.6))
        d.polygon([(px(ix), px(iy + 8)), (px(ix + 9), px(iy + 8)), (px(ix + 4.5), px(iy + 16))], outline=c)
        d.polygon([(px(ix + 13), px(iy + 8)), (px(ix + 22), px(iy + 8)), (px(ix + 17.5), px(iy + 16))], outline=c)
        d.line([px(ix + 5), px(iy + 22), px(ix + 17), px(iy + 22)], fill=c, width=px(1.6))
    text(x + 18, my + 44, title, 15, INK, True)
    text(x + 18, my + 72, desc, 11.4, MUTED, False, max_w=mw - 34, lh=1.55)

# ---------------------------------------------------------------------------
# Bottom metrics
# ---------------------------------------------------------------------------
y = 2166
card(M, y, 760, 194, r=18)
text(M + 24, y + 22, "北极星：可信自动化消耗占比", 17, INK, True)
text(M + 24, y + 56, "授权内自动执行消耗 / 总消耗", 25, INK, True)
text(M + 24, y + 96, "必须同时看预测校准（MAPE）与事故损失率，否则可以通过“什么都自动”刷高。", 11.8, MUTED, False, max_w=700, lh=1.55)
funnel = ["试用分析", "影子模式", "首次授权", "首次自动", "30 天留存", "扩权", "推荐"]
fx = M + 24
for i, item in enumerate(funnel):
    f = F(11)
    w = tw(item, f) / S + 18
    d.rounded_rectangle([px(fx), px(y + 140), px(fx + w), px(y + 168)], radius=px(8), fill=GRAY_BG)
    d.text((px(fx + 9), px(y + 148)), item, font=f, fill=INK2, anchor="la")
    fx += w
    if i < len(funnel) - 1:
        d.text((px(fx + 3), px(y + 146)), "›", font=F(13), fill="#98A2B3", anchor="la")
        fx += 10

card(M + 784, y, W - M - (M + 784), 194, r=18)
text(M + 808, y + 22, "护栏：别把“信任”做成“盲信”", 17, INK, True)
guards = [
    ("橡皮图章率", "审批 <3 秒且未看证据"),
    ("预测校准", "MAPE / 90% 区间覆盖"),
    ("误停率", "被暂停但本可恢复"),
    ("事故损失率", "P0/P1 损失 / 消耗"),
]
for i, (t, s) in enumerate(guards):
    col, row = i % 2, i // 2
    x = M + 808 + col * 246
    yy = y + 62 + row * 58
    d.rounded_rectangle([px(x), px(yy), px(x + 232), px(yy + 46)], radius=px(9), fill="#FCFCFD", outline=LINE, width=max(1, px(0.7)))
    text(x + 10, yy + 7, t, 11.2, INK, True)
    text(x + 10, yy + 24, s, 10.4, MUTED, False, max_w=210)

# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------
divider(2400)
text(M, 2424, "信任不是 UI，是制度；不是一次确认，是一套可验证的承诺。", 15.5, INK, True, max_w=900)
text(M, 2454, "先让商家敢看，再让他敢信，最后才让他敢交。", 15.5, ORANGE, True, max_w=900)
text(W - M, 2424, "配套文档：docs/merchant-trust-design.md\n公开信号：Digiday · 鸟哥笔记 · 商业观察 · 巨量引擎信任报告", 10.8, MUTED, False, max_w=430, lh=1.65, align="right")

# Crop bottom (Pillow fills the whole canvas, so use the known content bottom).
img = img.crop((0, 0, px(W), px(2500)))
img.save(OUT, "PNG")
print("saved", OUT, img.size)
