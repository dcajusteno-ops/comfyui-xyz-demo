# -*- coding: utf-8 -*-
"""生成 ComfyUI XYZ Web 应用图标（scripts/appicon.ico）。

设计：靛蓝→青色对角渐变圆角方块，白色粗体 "XYZ"，呼应 XYZ Plot 的主题。
输出：16/24/32/48/64/128/256 全尺寸 .ico（Windows 资源用）+ 预览 png。
重跑即可再生成；改样式后需重新编译 .syso（见 build-exe.ps1 第 3 步）。
"""
from PIL import Image, ImageDraw, ImageFont
import os

SIZE = 256
RADIUS = 58
C1 = (79, 70, 229)    # indigo-600
C2 = (34, 211, 238)   # cyan-400

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

# 对角线渐变（沿 x+y 方向插值）
grad = Image.new("RGBA", (SIZE, SIZE))
px = grad.load()
for y in range(SIZE):
    for x in range(SIZE):
        t = (x + y) / (2 * (SIZE - 1))
        r = int(C1[0] + (C2[0] - C1[0]) * t)
        g = int(C1[1] + (C2[1] - C1[1]) * t)
        b = int(C1[2] + (C2[2] - C1[2]) * t)
        px[x, y] = (r, g, b, 255)

# 圆角遮罩
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=RADIUS, fill=255)
img.paste(grad, (0, 0), mask)

draw = ImageDraw.Draw(img)

# 顶部 3x3 网格点（XYZ Plot 的意象）
dot_r, gap, top = 9, 34, 52
grid_cx = SIZE // 2
start = grid_cx - gap
for gy in range(2):
    for gx in range(3):
        cx = start + gx * gap
        cy = top + gy * gap
        alpha = 150 if (gx + gy) % 2 == 0 else 90
        draw.ellipse(
            [cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r],
            fill=(255, 255, 255, alpha),
        )

# 主文字 XYZ
font = None
for cand in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/arial.ttf"):
    if os.path.exists(cand):
        font = ImageFont.truetype(cand, 96)
        break
text = "XYZ"
bbox = draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
draw.text(((SIZE - tw) / 2 - bbox[0], SIZE - 52 - th - bbox[1]), text,
          font=font, fill=(255, 255, 255, 255))

# 输出
here = os.path.dirname(os.path.abspath(__file__))
sizes = [16, 24, 32, 48, 64, 128, 256]
img.save(os.path.join(here, "appicon.ico"), sizes=[(s, s) for s in sizes])
img.save(os.path.join(here, "appicon-preview.png"))
print("written:", os.path.join(here, "appicon.ico"), "sizes:", sizes)
