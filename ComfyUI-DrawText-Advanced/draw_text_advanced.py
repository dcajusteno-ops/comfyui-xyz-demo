import os
import torch
import folder_paths
import torchvision.transforms.v2 as T

MAX_RESOLUTION = 8192

# Try to find the FONTS_DIR from ComfyUI_essentials if available, else use a fallback or comfyui's base
try:
    from custom_nodes.ComfyUI_essentials.utils import FONTS_DIR
except ImportError:
    # Fallback to searching in standard locations if essentials is missing
    FONTS_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), "fonts")

class DrawTextAdvanced:
    @classmethod
    def INPUT_TYPES(s):
        # Gather fonts
        fonts = []
        if os.path.exists(FONTS_DIR):
            fonts = sorted([f for f in os.listdir(FONTS_DIR) if f.endswith('.ttf') or f.endswith('.otf')])
        if not fonts:
            fonts = ["default"]

        return {
            "required": {
                "text": ("STRING", { "multiline": True, "dynamicPrompts": True, "default": "Hello, World!" }),
                "font": (fonts, ),
                "size": ("INT", { "default": 56, "min": 1, "max": 9999, "step": 1 }),
                "color": ("STRING", { "multiline": False, "default": "#FFFFFF" }),
                "background_color": ("STRING", { "multiline": False, "default": "#00000000" }),
                "width": ("INT", { "default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1 }),
                "height": ("INT", { "default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1 }),
                "max_width": ("INT", { "default": 0, "min": 0, "max": MAX_RESOLUTION, "step": 1 }),
                "line_spacing": ("INT", { "default": 0, "min": -1000, "max": 1000, "step": 1 }),
                "letter_spacing": ("INT", { "default": 0, "min": -100, "max": 100, "step": 1 }),
                "glow_blur": ("INT", { "default": 0, "min": 0, "max": 100, "step": 1 }),
                "glow_color": ("STRING", { "multiline": False, "default": "#FFFFFF" }),
                "shadow_distance": ("INT", { "default": 0, "min": 0, "max": 100, "step": 1 }),
                "shadow_blur": ("INT", { "default": 0, "min": 0, "max": 100, "step": 1 }),
                "shadow_color": ("STRING", { "multiline": False, "default": "#000000" }),
                "horizontal_align": (["left", "center", "right"],),
                "vertical_align": (["top", "center", "bottom"],),
                "offset_x": ("INT", { "default": 0, "min": -MAX_RESOLUTION, "max": MAX_RESOLUTION, "step": 1 }),
                "offset_y": ("INT", { "default": 0, "min": -MAX_RESOLUTION, "max": MAX_RESOLUTION, "step": 1 }),
                "direction": (["ltr", "rtl"],),
                "rotation": ("FLOAT", { "default": 0.0, "min": -360.0, "max": 360.0, "step": 0.1 }),
                "stroke_width": ("INT", { "default": 0, "min": 0, "max": 100, "step": 1 }),
                "stroke_color": ("STRING", { "multiline": False, "default": "#00000000" }),
                "color_2": ("STRING", { "multiline": False, "default": "#FFFFFF" }),
                "gradient_colors": ("STRING", { "multiline": False, "default": "" }),
                "gradient_direction": (["none", "horizontal", "vertical", "diagonal", "angle"],),
                "gradient_angle": ("INT", { "default": 0, "min": 0, "max": 360, "step": 1 }),
                "layout_direction": (["horizontal", "vertical"],),
                "decoration": ("STRING", { "default": "none" }),
            },
            "optional": {
                "img_composite": ("IMAGE",),
                "text_texture": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK",)
    FUNCTION = "execute"
    CATEGORY = "xyz_nodes"

    def execute(self, text, font, size, color, background_color, width, height, max_width, line_spacing, letter_spacing, glow_blur, glow_color, shadow_distance, shadow_blur, shadow_color, horizontal_align, vertical_align, offset_x, offset_y, direction, rotation, stroke_width, stroke_color, color_2, gradient_colors, gradient_direction, gradient_angle, layout_direction, decoration, img_composite=None, text_texture=None):
        from PIL import Image, ImageDraw, ImageFont, ImageColor, ImageFilter
        import math

        if not text or not text.strip():
            # Handle empty text gracefully
            if img_composite is not None:
                img_composite_pil = T.ToPILImage()(img_composite.permute([0,3,1,2])[0]).convert('RGBA')
                mask = torch.ones_like(img_composite[:, :, :, 0])
                return (img_composite, mask,)
            else:
                image_w = width if width > 0 else 1
                image_h = height if height > 0 else 1
                image = Image.new('RGBA', (image_w, image_h), color=(0,0,0,0))
                mask = torch.ones((1, image_h, image_w))
                return (T.ToTensor()(image).unsqueeze(0).permute([0,2,3,1])[:, :, :, :3], mask,)

        deco_list = [d.strip() for d in decoration.split(",")] if decoration else ["none"]
        
        if "bracket" in deco_list: text = f"[{text}]"
        if "bracket_square_bold" in deco_list: text = f"【{text}】"
        if "bracket_curly" in deco_list: text = f"{{{text}}}"
        if "bracket_angle" in deco_list: text = f"<{text}>"
        if "bracket_parenthesis" in deco_list: text = f"({text})"
        if "bracket_double" in deco_list: text = f"[[{text}]]"
        if "arrow_pointer" in deco_list: text = f"{text} ->"
        if "diamond_ends" in deco_list: text = f"◆ {text} ◆"
        if "circle_ends" in deco_list: text = f"● {text} ●"

        if font != "default":
            font_path = os.path.join(FONTS_DIR, font)
            if not os.path.exists(font_path):
                print(f"Warning: Font file not found at {font_path}. Using default font.")
                font_obj = ImageFont.load_default()
            else:
                try:
                    font_obj = ImageFont.truetype(font_path, size)
                except Exception as e:
                    print(f"Error loading font {font_path}: {e}. Using default font.")
                    font_obj = ImageFont.load_default()
        else:
            font_obj = ImageFont.load_default()

        # Helper to get text width/height with spacing
        def get_text_dims(text_str, font, spacing, vertical=False):
            if not text_str:
                return 0, 0
            
            if not vertical:
                if spacing == 0:
                    bbox = font.getbbox(text_str)
                    # Use bbox[2] as width and bbox[3] as height for default compatibility
                    # but (bbox[2]-bbox[0]) is technically more correct for some fonts
                    return bbox[2], bbox[3]
                
                total_w = 0
                max_h = 0
                for char in text_str:
                    try:
                        # getlength is preferred for advance width
                        w = font.getlength(char)
                    except AttributeError:
                        cb = font.getbbox(char)
                        w = cb[2]
                    
                    total_w += w + spacing
                    cb = font.getbbox(char)
                    max_h = max(max_h, cb[3])
                return total_w - spacing, max_h
            else:
                total_h = 0
                max_w = 0
                for char in text_str:
                    cb = font.getbbox(char)
                    char_h = cb[3] if cb[3] > 0 else size
                    total_h += char_h + spacing
                    max_w = max(max_w, cb[2])
                return max_w, total_h - spacing

        # Text Wrapping (only for horizontal for now)
        if max_width > 0 and layout_direction == "horizontal":
            wrapped_lines = []
            for line in text.split("\n"):
                words = line.split(" ")
                current_line = ""
                for word in words:
                    test_line = (current_line + " " + word).strip()
                    tw, _ = get_text_dims(test_line, font_obj, letter_spacing)
                    if tw <= max_width:
                        current_line = test_line
                    else:
                        if current_line:
                            wrapped_lines.append(current_line)
                            current_line = word
                        else:
                            wrapped_lines.append(word)
                            current_line = ""
                if current_line:
                    wrapped_lines.append(current_line)
            lines = wrapped_lines
        else:
            lines = text.split("\n")

        if direction == "rtl" and layout_direction == "horizontal":
            lines = [line[::-1] for line in lines]

        # Calculate base metrics
        sample_bbox = font_obj.getmask("Ay").getbbox()
        if sample_bbox is None:
            base_font_height = size
        else:
            try:
                base_font_height = sample_bbox[3] + font_obj.getmetrics()[1]
            except AttributeError:
                base_font_height = sample_bbox[3]

        # Calculate text block dimensions
        if layout_direction == "horizontal":
            line_h = base_font_height + line_spacing
            dims = [get_text_dims(l, font_obj, letter_spacing) for l in lines]
            text_width = max(d[0] for d in dims) if dims else 0
            text_height = line_h * len(lines) - line_spacing
        else:
            # Vertical layout: lines are columns
            col_w = size + line_spacing # distance between columns
            dims = [get_text_dims(l, font_obj, letter_spacing, vertical=True) for l in lines]
            text_height = max(d[1] for d in dims) if dims else 0
            text_width = col_w * len(lines) - line_spacing

        # Create layers
        extra_margin = int(stroke_width * 2 + max(shadow_distance, glow_blur * 2) + 20)
        layer_width = int(text_width + extra_margin * 2)
        layer_height = int(text_height + extra_margin * 2)
        
        def draw_text_internal(draw_obj, fill_val, s_width, s_fill_val):
            bg_deco = ["background_box", "rounded_box", "capsule", "highlight", "parallelogram", 
                       "speech_bubble", "cloud_bubble", "comic_bubble", "leaf_box", "trapezoid", 
                       "heart_box", "tag", "ribbon", "double_ribbon", "shadow_box", "banner", "explosion"]
            
            for i, line in enumerate(lines):
                lw, lh = get_text_dims(line, font_obj, letter_spacing, vertical=(layout_direction=="vertical"))
                
                if layout_direction == "horizontal":
                    if horizontal_align == "left": x = extra_margin
                    elif horizontal_align == "center": x = extra_margin + (text_width - lw) // 2
                    else: x = extra_margin + (text_width - lw)
                    y = extra_margin + i * (base_font_height + line_spacing)
                    
                    # Draw background decorations first
                    if "none" not in deco_list:
                        line_width = max(1, size // 20)
                        bg_fill = fill_val // 4 if isinstance(fill_val, int) else fill_val
                        
                        for deco in deco_list:
                            if deco == "background_box":
                                box_margin = max(2, size // 15)
                                draw_obj.rectangle([x - box_margin, y, x + lw + box_margin, y + base_font_height], fill=bg_fill)
                            elif deco == "shadow_box":
                                box_margin = max(2, size // 15)
                                shadow_off = max(2, size // 20)
                                draw_obj.rectangle([x - box_margin + shadow_off, y + shadow_off, x + lw + box_margin + shadow_off, y + base_font_height + shadow_off], fill=bg_fill)
                                draw_obj.rectangle([x - box_margin, y, x + lw + box_margin, y + base_font_height], outline=fill_val, width=line_width)
                            elif deco == "leaf_box":
                                box_margin = max(4, size // 10)
                                draw_obj.polygon([(x - box_margin + size//2, y), (x + lw + box_margin, y), (x + lw + box_margin - size//2, y + base_font_height), (x - box_margin, y + base_font_height)], fill=bg_fill)
                            elif deco == "trapezoid":
                                box_margin = max(4, size // 10)
                                draw_obj.polygon([(x - box_margin + size//3, y), (x + lw + box_margin - size//3, y), (x + lw + box_margin, y + base_font_height), (x - box_margin, y + base_font_height)], fill=bg_fill)
                            elif deco == "heart_box":
                                box_margin = max(4, size // 10)
                                cx, cy = x + lw/2, y + base_font_height/2
                                r = max(lw, base_font_height) / 2 + box_margin
                                draw_obj.ellipse([cx - r, cy - r, cx, cy], fill=bg_fill)
                                draw_obj.ellipse([cx, cy - r, cx + r, cy], fill=bg_fill)
                                draw_obj.polygon([(cx - r, cy - r/2), (cx + r, cy - r/2), (cx, cy + r)], fill=bg_fill)
                            elif deco == "highlight":
                                draw_obj.rectangle([x, y + base_font_height // 2, x + lw, y + base_font_height], fill=bg_fill)
                            elif deco == "rounded_box":
                                box_margin = max(2, size // 15)
                                radius = max(4, size // 6)
                                draw_obj.rounded_rectangle([x - box_margin, y, x + lw + box_margin, y + base_font_height], radius=radius, fill=bg_fill)
                            elif deco == "capsule":
                                box_margin = max(4, size // 10)
                                radius = base_font_height // 2 + box_margin
                                draw_obj.rounded_rectangle([x - box_margin, y - box_margin, x + lw + box_margin, y + base_font_height + box_margin], radius=radius, fill=bg_fill)
                            elif deco == "parallelogram":
                                box_margin = max(2, size // 15)
                                skew = base_font_height // 4
                                draw_obj.polygon([(x - box_margin + skew, y), (x + lw + box_margin + skew, y), (x + lw + box_margin - skew, y + base_font_height), (x - box_margin - skew, y + base_font_height)], fill=bg_fill)
                            elif deco == "speech_bubble":
                                box_margin = max(2, size // 15)
                                radius = max(4, size // 10)
                                draw_obj.rounded_rectangle([x - box_margin, y, x + lw + box_margin, y + base_font_height], radius=radius, fill=bg_fill)
                                tail_w = base_font_height // 3
                                draw_obj.polygon([(x + box_margin, y + base_font_height), (x + box_margin + tail_w, y + base_font_height), (x + box_margin, y + base_font_height + tail_w)], fill=bg_fill)
                            elif deco == "cloud_bubble":
                                box_margin = max(4, size // 10)
                                radius = base_font_height // 2
                                draw_obj.ellipse([x - box_margin, y - radius/2, x - box_margin + radius, y + radius/2], fill=bg_fill)
                                draw_obj.ellipse([x + lw + box_margin - radius, y - radius/2, x + lw + box_margin, y + radius/2], fill=bg_fill)
                                draw_obj.ellipse([x + lw/2 - radius, y - box_margin, x + lw/2 + radius, y - box_margin + radius], fill=bg_fill)
                                draw_obj.rectangle([x - box_margin + radius/2, y, x + lw + box_margin - radius/2, y + base_font_height], fill=bg_fill)
                            elif deco == "comic_bubble":
                                box_margin = max(6, size // 8)
                                draw_obj.ellipse([x - box_margin, y - box_margin, x + lw + box_margin, y + base_font_height + box_margin], fill=bg_fill, outline=fill_val, width=line_width)
                                tail_w = base_font_height // 2
                                draw_obj.polygon([(x, y + base_font_height), (x + tail_w, y + base_font_height + tail_w), (x + tail_w, y + base_font_height)], fill=bg_fill, outline=fill_val)
                            elif deco == "explosion":
                                box_margin = max(8, size // 6)
                                cx, cy = x + lw/2, y + base_font_height/2
                                r = max(lw, base_font_height) / 2 + box_margin
                                pts = []
                                for i in range(16):
                                    ang = math.radians(i * (360/16))
                                    dist = r if i % 2 == 0 else r * 0.7
                                    pts.append((cx + dist * math.cos(ang), cy + dist * math.sin(ang)))
                                draw_obj.polygon(pts, fill=bg_fill, outline=fill_val, width=line_width)
                            elif deco == "tag":
                                box_margin = max(2, size // 15)
                                draw_obj.polygon([(x - box_margin, y), (x + lw, y), (x + lw + box_margin * 2, y + base_font_height/2), (x + lw, y + base_font_height), (x - box_margin, y + base_font_height)], fill=bg_fill)
                            elif deco == "ribbon":
                                box_margin = max(6, size // 8)
                                skew = base_font_height // 3
                                draw_obj.polygon([(x - box_margin + skew, y), (x + lw + box_margin - skew, y), (x + lw + box_margin, y + base_font_height/2), (x + lw + box_margin - skew, y + base_font_height), (x - box_margin + skew, y + base_font_height), (x - box_margin, y + base_font_height/2)], fill=bg_fill)
                            elif deco == "double_ribbon":
                                box_margin = max(8, size // 6)
                                skew = base_font_height // 3
                                draw_obj.polygon([(x - box_margin + skew, y - 4), (x + lw + box_margin - skew, y - 4), (x + lw + box_margin, y + base_font_height/2 - 4), (x + lw + box_margin - skew, y + base_font_height - 4), (x - box_margin + skew, y + base_font_height - 4), (x - box_margin, y + base_font_height/2 - 4)], fill=bg_fill)
                                draw_obj.polygon([(x - box_margin + skew, y + 4), (x + lw + box_margin - skew, y + 4), (x + lw + box_margin, y + base_font_height/2 + 4), (x + lw + box_margin - skew, y + base_font_height + 4), (x - box_margin + skew, y + base_font_height + 4), (x - box_margin, y + base_font_height/2 + 4)], fill=bg_fill)
                            elif deco == "banner":
                                box_margin = max(4, size // 10)
                                draw_obj.polygon([(x - box_margin, y), (x + lw + box_margin, y), (x + lw + box_margin, y + base_font_height), (x + lw/2, y + base_font_height * 0.85), (x - box_margin, y + base_font_height)], fill=bg_fill, outline=fill_val, width=line_width)

                    # Draw text
                    curr_x = x
                    for char in line:
                        draw_obj.text((curr_x, y), char, font=font_obj, fill=fill_val, stroke_width=s_width, stroke_fill=s_fill_val)
                        try:
                            w = font_obj.getlength(char)
                        except AttributeError:
                            cb = font_obj.getbbox(char)
                            w = cb[2]
                        curr_x += w + letter_spacing
                    
                    # Draw foreground decorations
                    if "none" not in deco_list:
                        line_width = max(1, size // 20)
                        for deco in deco_list:
                            if deco in ["underline", "both", "underline_overline"]:
                                line_y = y + base_font_height * 0.8
                                draw_obj.line([(x, line_y), (x + lw, line_y)], fill=fill_val, width=line_width)
                            elif deco == "bold_underline":
                                line_y = y + base_font_height * 0.8
                                draw_obj.line([(x, line_y), (x + lw, line_y)], fill=fill_val, width=line_width * 3)
                            elif deco == "double_underline":
                                line_y1 = y + base_font_height * 0.8
                                line_y2 = line_y1 + max(2, line_width * 2)
                                draw_obj.line([(x, line_y1), (x + lw, line_y1)], fill=fill_val, width=line_width)
                                draw_obj.line([(x, line_y2), (x + lw, line_y2)], fill=fill_val, width=line_width)
                            elif deco == "dotted_underline":
                                line_y = y + base_font_height * 0.8
                                dot_width = max(2, line_width * 2)
                                for dx in range(0, int(lw), dot_width * 2):
                                    draw_obj.line([(x + dx, line_y), (x + min(dx + dot_width, lw), line_y)], fill=fill_val, width=line_width)
                            elif deco == "dashed_underline":
                                line_y = y + base_font_height * 0.8
                                dash_len = max(4, line_width * 4)
                                for dx in range(0, int(lw), dash_len * 2):
                                    draw_obj.line([(x + dx, line_y), (x + min(dx + dash_len, lw), line_y)], fill=fill_val, width=line_width)
                            elif deco == "dot_dash_underline":
                                line_y = y + base_font_height * 0.8
                                dash_l = max(4, line_width * 4)
                                dot_w = max(2, line_width * 2)
                                step = dash_l + dot_w + 8
                                for dx in range(0, int(lw), step):
                                    draw_obj.line([(x + dx, line_y), (x + min(dx + dash_l, lw), line_y)], fill=fill_val, width=line_width)
                                    if dx + dash_l + 4 < lw:
                                        draw_obj.line([(x + dx + dash_l + 4, line_y), (x + min(dx + dash_l + 4 + dot_w, lw), line_y)], fill=fill_val, width=line_width)
                            elif deco == "double_wave_underline":
                                line_y1 = y + base_font_height * 0.8
                                line_y2 = line_y1 + max(4, line_width * 2)
                                wave_step = max(4, size // 8)
                                for ly in [line_y1, line_y2]:
                                    pts = []
                                    for dx in range(0, int(lw) + 1, 2):
                                        dy = math.sin(dx / wave_step * math.pi * 2) * (line_width * 1.5)
                                        pts.append((x + dx, ly + dy))
                                    if len(pts) > 1:
                                        draw_obj.line(pts, fill=fill_val, width=line_width, joint="round")
                            elif deco == "wave_underline":
                                line_y = y + base_font_height * 0.85
                                wave_step = max(4, size // 8)
                                points = []
                                for dx in range(0, int(lw) + 1, 2):
                                    dy = math.sin(dx / wave_step * math.pi * 2) * (line_width * 1.5)
                                    points.append((x + dx, line_y + dy))
                                if len(points) > 1:
                                    draw_obj.line(points, fill=fill_val, width=line_width, joint="round")
                            elif deco == "underline_bold_wavy":
                                line_y = y + base_font_height * 0.85
                                wave_step = max(4, size // 8)
                                points = []
                                for dx in range(0, int(lw) + 1, 2):
                                    dy = math.sin(dx / wave_step * math.pi * 2) * (line_width * 2)
                                    points.append((x + dx, line_y + dy))
                                if len(points) > 1:
                                    draw_obj.line(points, fill=fill_val, width=line_width * 2, joint="round")
                            elif deco == "zigzag_underline":
                                line_y = y + base_font_height * 0.85
                                zig_step = max(4, size // 6)
                                points = []
                                for dx in range(0, int(lw) + 1, zig_step):
                                    dy = (line_width * 2) if (dx // zig_step) % 2 == 0 else (-line_width * 2)
                                    points.append((x + dx, line_y + dy))
                                if len(points) > 1:
                                    draw_obj.line(points, fill=fill_val, width=line_width)
                            
                            if deco in ["strikethrough", "both"]:
                                strike_y = y + base_font_height * 0.45
                                draw_obj.line([(x, strike_y), (x + lw, strike_y)], fill=fill_val, width=line_width)
                            elif deco == "double_strikethrough":
                                strike_y1 = y + base_font_height * 0.4
                                strike_y2 = y + base_font_height * 0.5
                                draw_obj.line([(x, strike_y1), (x + lw, strike_y1)], fill=fill_val, width=line_width)
                                draw_obj.line([(x, strike_y2), (x + lw, strike_y2)], fill=fill_val, width=line_width)
                            elif deco == "double_strikethrough_bold":
                                strike_y1 = y + base_font_height * 0.4
                                strike_y2 = y + base_font_height * 0.5
                                draw_obj.line([(x, strike_y1), (x + lw, strike_y1)], fill=fill_val, width=line_width * 2)
                                draw_obj.line([(x, strike_y2), (x + lw, strike_y2)], fill=fill_val, width=line_width * 2)
                            elif deco == "cross_out":
                                draw_obj.line([(x, y), (x + lw, y + base_font_height)], fill=fill_val, width=line_width * 2)
                                draw_obj.line([(x + lw, y), (x, y + base_font_height)], fill=fill_val, width=line_width * 2)
                            
                            if deco in ["overline", "underline_overline"]:
                                over_y = y + base_font_height * 0.1
                                draw_obj.line([(x, over_y), (x + lw, over_y)], fill=fill_val, width=line_width)
                            elif deco == "dashed_overline":
                                over_y = y + base_font_height * 0.1
                                dash_l = max(4, line_width * 4)
                                for dx in range(0, int(lw), dash_l * 2):
                                    draw_obj.line([(x + dx, over_y), (x + min(dx + dash_l, lw), over_y)], fill=fill_val, width=line_width)
                            elif deco == "double_underline_overline":
                                line_y1 = y + base_font_height * 0.8
                                line_y2 = line_y1 + max(2, line_width * 2)
                                draw_obj.line([(x, line_y1), (x + lw, line_y1)], fill=fill_val, width=line_width)
                                draw_obj.line([(x, line_y2), (x + lw, line_y2)], fill=fill_val, width=line_width)
                                over_y = y + base_font_height * 0.1
                                draw_obj.line([(x, over_y), (x + lw, over_y)], fill=fill_val, width=line_width)
                            elif deco == "wave_overline":
                                line_y = y + base_font_height * 0.05
                                wave_step = max(4, size // 8)
                                points = []
                                for dx in range(0, int(lw) + 1, 2):
                                    dy = math.sin(dx / wave_step * math.pi * 2) * (line_width * 1.5)
                                    points.append((x + dx, line_y + dy))
                                if len(points) > 1:
                                    draw_obj.line(points, fill=fill_val, width=line_width, joint="round")
                            elif deco == "overline_bold_wavy":
                                line_y = y + base_font_height * 0.05
                                wave_step = max(4, size // 8)
                                points = []
                                for dx in range(0, int(lw) + 1, 2):
                                    dy = math.sin(dx / wave_step * math.pi * 2) * (line_width * 2)
                                    points.append((x + dx, line_y + dy))
                                if len(points) > 1:
                                    draw_obj.line(points, fill=fill_val, width=line_width * 2, joint="round")
                            
                            if deco == "box":
                                box_margin = max(2, size // 15)
                                draw_obj.rectangle([x - box_margin, y, x + lw + box_margin, y + base_font_height], outline=fill_val, width=line_width)
                            elif deco == "wavy_box":
                                box_margin = max(4, size // 12)
                                wave_step = max(4, size // 10)
                                for by in [y, y + base_font_height]:
                                    pts = []
                                    for dx in range(int(x - box_margin), int(x + lw + box_margin) + 1, 2):
                                        dy = math.sin(dx / wave_step * math.pi * 2) * 2
                                        pts.append((dx, by + dy))
                                    draw_obj.line(pts, fill=fill_val, width=line_width)
                                for bx in [x - box_margin, x + lw + box_margin]:
                                    pts = []
                                    for dy in range(int(y), int(y + base_font_height) + 1, 2):
                                        dx = math.sin(dy / wave_step * math.pi * 2) * 2
                                        pts.append((bx + dx, dy))
                                    draw_obj.line(pts, fill=fill_val, width=line_width)
                            elif deco == "double_box":
                                box_margin = max(2, size // 15)
                                draw_obj.rectangle([x - box_margin, y, x + lw + box_margin, y + base_font_height], outline=fill_val, width=line_width)
                                draw_obj.rectangle([x - box_margin - 4, y - 4, x + lw + box_margin + 4, y + base_font_height + 4], outline=fill_val, width=line_width)
                            elif deco == "pill_border":
                                box_margin = max(4, size // 10)
                                radius = base_font_height // 2 + box_margin
                                draw_obj.rounded_rectangle([x - box_margin, y - box_margin, x + lw + box_margin, y + base_font_height + box_margin], radius=radius, outline=fill_val, width=line_width * 2)
                            elif deco == "dotted_box":
                                box_margin = max(2, size // 15)
                                dot_w = max(2, line_width * 2)
                                for dx in range(0, int(lw + box_margin * 2), dot_w * 2):
                                    draw_obj.line([(x - box_margin + dx, y), (x - box_margin + min(dx + dot_w, lw + box_margin * 2), y)], fill=fill_val, width=line_width)
                                    draw_obj.line([(x - box_margin + dx, y + base_font_height), (x - box_margin + min(dx + dot_w, lw + box_margin * 2), y + base_font_height)], fill=fill_val, width=line_width)
                                for dy in range(0, int(base_font_height), dot_w * 2):
                                    draw_obj.line([(x - box_margin, y + dy), (x - box_margin, y + min(dy + dot_w, base_font_height))], fill=fill_val, width=line_width)
                                    draw_obj.line([(x + lw + box_margin, y + dy), (x + lw + box_margin, y + min(dy + dot_w, base_font_height))], fill=fill_val, width=line_width)
                            elif deco == "dashed_box":
                                box_margin = max(2, size // 15)
                                dash_l = max(4, line_width * 4)
                                for dx in range(0, int(lw + box_margin * 2), dash_l * 2):
                                    draw_obj.line([(x - box_margin + dx, y), (x - box_margin + min(dx + dash_l, lw + box_margin * 2), y)], fill=fill_val, width=line_width)
                                    draw_obj.line([(x - box_margin + dx, y + base_font_height), (x - box_margin + min(dx + dash_l, lw + box_margin * 2), y + base_font_height)], fill=fill_val, width=line_width)
                                for dy in range(0, int(base_font_height), dash_l * 2):
                                    draw_obj.line([(x - box_margin, y + dy), (x - box_margin, y + min(dy + dash_l, base_font_height))], fill=fill_val, width=line_width)
                                    draw_obj.line([(x + lw + box_margin, y + dy), (x + lw + box_margin, y + min(dy + dash_l, base_font_height))], fill=fill_val, width=line_width)
                            elif deco == "stitch":
                                box_margin = max(2, size // 15)
                                dash_l = max(2, line_width * 2)
                                inner_m = 4
                                for dx in range(inner_m, int(lw + box_margin * 2 - inner_m), dash_l * 2):
                                    draw_obj.line([(x - box_margin + dx, y + inner_m), (x - box_margin + min(dx + dash_l, lw + box_margin * 2 - inner_m), y + inner_m)], fill=fill_val, width=1)
                                    draw_obj.line([(x - box_margin + dx, y + base_font_height - inner_m), (x - box_margin + min(dx + dash_l, lw + box_margin * 2 - inner_m), y + base_font_height - inner_m)], fill=fill_val, width=1)
                                for dy in range(inner_m, int(base_font_height - inner_m), dash_l * 2):
                                    draw_obj.line([(x - box_margin + inner_m, y + dy), (x - box_margin + inner_m, y + min(dy + dash_l, base_font_height - inner_m))], fill=fill_val, width=1)
                                    draw_obj.line([(x + lw + box_margin - inner_m, y + dy), (x + lw + box_margin - inner_m, y + min(dy + dash_l, base_font_height - inner_m))], fill=fill_val, width=1)
                            elif deco == "neon_border":
                                box_margin = max(2, size // 15)
                                draw_obj.rectangle([x - box_margin, y, x + lw + box_margin, y + base_font_height], outline=fill_val, width=line_width * 2)
                            elif deco == "corners":
                                box_margin = max(2, size // 15)
                                corner_len = max(5, size // 5)
                                draw_obj.line([(x - box_margin, y), (x - box_margin + corner_len, y)], fill=fill_val, width=line_width)
                                draw_obj.line([(x - box_margin, y), (x - box_margin, y + corner_len)], fill=fill_val, width=line_width)
                                draw_obj.line([(x + lw + box_margin, y), (x + lw + box_margin - corner_len, y)], fill=fill_val, width=line_width)
                                draw_obj.line([(x + lw + box_margin, y), (x + lw + box_margin, y + corner_len)], fill=fill_val, width=line_width)
                                draw_obj.line([(x - box_margin, y + base_font_height), (x - box_margin + corner_len, y + base_font_height)], fill=fill_val, width=line_width)
                                draw_obj.line([(x - box_margin, y + base_font_height), (x - box_margin, y + base_font_height - corner_len)], fill=fill_val, width=line_width)
                                draw_obj.line([(x + lw + box_margin, y + base_font_height), (x + lw + box_margin - corner_len, y + base_font_height)], fill=fill_val, width=line_width)
                                draw_obj.line([(x + lw + box_margin, y + base_font_height), (x + lw + box_margin, y + base_font_height - corner_len)], fill=fill_val, width=line_width)
                            elif deco == "star_corners":
                                box_margin = max(4, size // 10)
                                star_size = max(6, size // 6)
                                def draw_star(cx, cy):
                                    pts = []
                                    for i in range(5):
                                        for r in [star_size, star_size//2]:
                                            ang = math.radians(i * 72 + (0 if r==star_size else 36))
                                            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
                                    draw_obj.polygon(pts, fill=fill_val)
                                draw_star(x - box_margin, y)
                                draw_star(x + lw + box_margin, y)
                                draw_star(x - box_margin, y + base_font_height)
                                draw_star(x + lw + box_margin, y + base_font_height)
                                draw_obj.rectangle([x - box_margin, y, x + lw + box_margin, y + base_font_height], outline=fill_val, width=1)
                            elif deco == "circle":
                                box_margin = max(4, size // 10)
                                draw_obj.ellipse([x - box_margin, y - box_margin, x + lw + box_margin, y + base_font_height + box_margin], outline=fill_val, width=line_width)
                            elif deco == "rhombus":
                                box_margin = max(4, size // 8)
                                cx, cy = x + lw/2, y + base_font_height/2
                                draw_obj.polygon([(cx, y - box_margin), (x + lw + box_margin, cy), (cx, y + base_font_height + box_margin), (x - box_margin, cy)], outline=fill_val, width=line_width)

                else:
                    if vertical_align == "top": y = extra_margin
                    elif vertical_align == "center": y = extra_margin + (text_height - lh) // 2
                    else: y = extra_margin + (text_height - lh)
                    x = extra_margin + i * (size + line_spacing)
                    
                    curr_y = y
                    for char in line:
                        char_bbox = font_obj.getbbox(char)
                        char_h = char_bbox[3] if char_bbox[3] > 0 else size
                        char_x = x + (size - char_bbox[2]) // 2
                        draw_obj.text((char_x, curr_y), char, font=font_obj, fill=fill_val, stroke_width=s_width, stroke_fill=s_fill_val)
                        curr_y += char_h + letter_spacing

        # Calculate visual bounding box of text (without effects) to adjust alignment
        temp_mask = Image.new('L', (layer_width, layer_height), 0)
        draw_text_internal(ImageDraw.Draw(temp_mask), 255, 0, 0)
        text_bbox = temp_mask.getbbox()

        # 1. Shadow Layer
        final_text_layer = Image.new('RGBA', (layer_width, layer_height), (0,0,0,0))
        if shadow_distance > 0:
            shadow_mask = Image.new('L', (layer_width, layer_height), 0)
            draw_shadow_mask = ImageDraw.Draw(shadow_mask)
            draw_text_internal(draw_shadow_mask, 255, stroke_width, 255)
            if shadow_blur > 0:
                shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(shadow_blur))
            
            shadow_fill = Image.new('RGBA', (layer_width, layer_height), shadow_color)
            final_text_layer = Image.composite(shadow_fill, final_text_layer, shadow_mask)

        # 2. Glow Layer
        if glow_blur > 0:
            glow_mask = Image.new('L', (layer_width, layer_height), 0)
            draw_glow_mask = ImageDraw.Draw(glow_mask)
            draw_text_internal(draw_glow_mask, 255, stroke_width, 255)
            glow_mask = glow_mask.filter(ImageFilter.GaussianBlur(glow_blur))
            
            glow_fill = Image.new('RGBA', (layer_width, layer_height), glow_color)
            glow_layer = Image.new('RGBA', (layer_width, layer_height), (0,0,0,0))
            glow_layer = Image.composite(glow_fill, glow_layer, glow_mask)
            final_text_layer = Image.alpha_composite(final_text_layer, glow_layer)

        # 3. Main Text Fill Layer
        text_mask = Image.new('L', (layer_width, layer_height), 0)
        draw_text_internal(ImageDraw.Draw(text_mask), 255, stroke_width, 255)
        
        # Create the fill image
        if text_texture is not None:
            tex_pil = T.ToPILImage()(text_texture.permute([0,3,1,2])[0]).convert('RGBA')
            fill_image = tex_pil.resize((layer_width, layer_height), Image.Resampling.LANCZOS)
        elif gradient_direction != "none":
            fill_image = Image.new('RGBA', (layer_width, layer_height), color)
            draw_grad = ImageDraw.Draw(fill_image)
            
            # Prepare colors
            g_colors = [color]
            if gradient_colors and gradient_colors.strip():
                g_colors = [c.strip() for c in gradient_colors.split(',')]
            elif color_2:
                g_colors = [color, color_2]
            
            rgb_colors = [ImageColor.getrgb(c) for c in g_colors]
            
            def get_interpolated_color(rel):
                if len(rgb_colors) < 2: return rgb_colors[0]
                idx = rel * (len(rgb_colors) - 1)
                i1 = int(math.floor(idx))
                i2 = min(i1 + 1, len(rgb_colors) - 1)
                f = idx - i1
                return tuple(int(rgb_colors[i1][j] + (rgb_colors[i2][j] - rgb_colors[i1][j]) * f) for j in range(3))

            if gradient_direction == "vertical":
                for i in range(layer_height):
                    fill_image.paste(get_interpolated_color(i / max(1, layer_height-1)), (0, i, layer_width, i+1))
            elif gradient_direction == "horizontal":
                for i in range(layer_width):
                    fill_image.paste(get_interpolated_color(i / max(1, layer_width-1)), (i, 0, i+1, layer_height))
            elif gradient_direction == "diagonal":
                for i in range(layer_width + layer_height):
                    rel = i / max(1, layer_width + layer_height - 1)
                    c = get_interpolated_color(rel)
                    draw_grad.line([(i, 0), (0, i)], fill=c)
            elif gradient_direction == "angle":
                # General linear gradient for arbitrary angle
                # angle 0 is left to right, 90 is top to bottom
                rad = math.radians(gradient_angle)
                dx = math.cos(rad)
                dy = math.sin(rad)
                
                # Projection range
                # Find the bounding box corners' projection onto the gradient vector
                corners = [(0,0), (layer_width, 0), (0, layer_height), (layer_width, layer_height)]
                projections = [c[0] * dx + c[1] * dy for c in corners]
                min_p = min(projections)
                max_p = max(projections)
                range_p = max_p - min_p if max_p > min_p else 1.0
                
                for y in range(layer_height):
                    for x in range(layer_width):
                        p = x * dx + y * dy
                        rel = (p - min_p) / range_p
                        rel = max(0, min(1, rel))
                        fill_image.putpixel((x, y), get_interpolated_color(rel))
        else:
            fill_image = Image.new('RGBA', (layer_width, layer_height), color)

        main_text_layer = Image.new('RGBA', (layer_width, layer_height), (0,0,0,0))
        main_text_layer = Image.composite(fill_image, main_text_layer, text_mask)
        
        # Handle stroke if it has a different color and stroke_width > 0
        if stroke_width > 0:
            stroke_mask = Image.new('L', (layer_width, layer_height), 0)
            draw_stroke = ImageDraw.Draw(stroke_mask)
            draw_text_internal(draw_stroke, 0, stroke_width, 255) # Only stroke
            
            actual_stroke_color = color if stroke_color.lower() == "#00000000" else stroke_color
            stroke_fill = Image.new('RGBA', (layer_width, layer_height), actual_stroke_color)
            main_text_layer = Image.composite(stroke_fill, main_text_layer, stroke_mask)

        final_text_layer = Image.alpha_composite(final_text_layer, main_text_layer)

        # Rotate
        if rotation != 0:
            final_text_layer = final_text_layer.rotate(rotation, expand=True, resample=Image.BICUBIC)

        # Final Compositing
        if img_composite is not None:
            img_composite_pil = T.ToPILImage()(img_composite.permute([0,3,1,2])[0]).convert('RGBA')
            cw, ch = img_composite_pil.width, img_composite_pil.height
        else:
            cw, ch = width, height
            
        image = Image.new('RGBA', (cw, ch), color=background_color)
        
        # Calculate visual bounds of text for alignment
        # We use the text_bbox we calculated earlier (which is relative to the unrotated layer)
        if text_bbox:
            tw_visual = text_bbox[2] - text_bbox[0]
            th_visual = text_bbox[3] - text_bbox[1]
            
            # Target top-left of the visual text block
            px, py = offset_x, offset_y
            if horizontal_align == "center": px += (cw - tw_visual) // 2
            elif horizontal_align == "right": px += cw - tw_visual
            if vertical_align == "center": py += (ch - th_visual) // 2
            elif vertical_align == "bottom": py += ch - th_visual
            
            if rotation == 0:
                # Paste so that text_bbox[0], text_bbox[1] lands at px, py
                image.paste(final_text_layer, (int(px - text_bbox[0]), int(py - text_bbox[1])), final_text_layer)
            else:
                # For rotation, we align the center of the text block
                target_center_x = px + tw_visual / 2
                target_center_y = py + th_visual / 2
                paste_x = int(target_center_x - final_text_layer.width / 2)
                paste_y = int(target_center_y - final_text_layer.height / 2)
                image.paste(final_text_layer, (paste_x, paste_y), final_text_layer)
        
        # Output
        mask_out = T.ToTensor()(image).unsqueeze(0).permute([0,2,3,1])
        mask_out = mask_out[:, :, :, 3] if mask_out.shape[3] == 4 else torch.ones_like(mask_out[:, :, :, 0])
        
        if img_composite is not None:
            image = Image.alpha_composite(img_composite_pil, image)
        
        image_out = T.ToTensor()(image).unsqueeze(0).permute([0,2,3,1])
        return (image_out[:, :, :, :3], mask_out,)

NODE_CLASS_MAPPINGS = {
    "DrawTextAdvanced": DrawTextAdvanced,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DrawTextAdvanced": "XYZ Draw Text Advanced",
}
