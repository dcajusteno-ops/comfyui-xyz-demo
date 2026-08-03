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
            },
            "optional": {
                "img_composite": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK",)
    FUNCTION = "execute"
    CATEGORY = "xyz_nodes"

    def execute(self, text, font, size, color, background_color, shadow_distance, shadow_blur, shadow_color, horizontal_align, vertical_align, offset_x, offset_y, direction, rotation, stroke_width, stroke_color, img_composite=None):
        from PIL import Image, ImageDraw, ImageFont, ImageColor, ImageFilter
        import math

        if not text or not text.strip():
            # Handle empty text gracefully
            if img_composite is not None:
                img_composite_pil = T.ToPILImage()(img_composite.permute([0,3,1,2])[0]).convert('RGBA')
                mask = torch.ones_like(img_composite[:, :, :, 0])
                return (img_composite, mask,)
            else:
                image = Image.new('RGBA', (1, 1), color=(0,0,0,0))
                mask = torch.ones((1, 1, 1))
                return (T.ToTensor()(image).unsqueeze(0).permute([0,2,3,1])[:, :, :, :3], mask,)

        if font != "default":
            font_path = os.path.join(FONTS_DIR, font)
            font_obj = ImageFont.truetype(font_path, size)
        else:
            font_obj = ImageFont.load_default()

        lines = text.split("\n")
        if direction == "rtl":
            lines = [line[::-1] for line in lines]

        # Calculate the width and height of the text block
        text_width = max(font_obj.getbbox(line)[2] for line in lines) if lines else 0
        bbox = font_obj.getmask(text).getbbox()
        if bbox is None:
            line_height = size
        else:
            try:
                line_height = bbox[3] + font_obj.getmetrics()[1]  # add descent to height
            except AttributeError:
                line_height = bbox[3]
        text_height = line_height * len(lines)

        # Draw the text block on a temporary layer
        text_layer = Image.new('RGBA', (text_width + stroke_width * 2 + shadow_distance, text_height + stroke_width * 2 + shadow_distance), color=(0, 0, 0, 0))
        text_layer_shadow = None
        if shadow_distance > 0:
            text_layer_shadow = Image.new('RGBA', text_layer.size, color=(0, 0, 0, 0))

        if stroke_width > 0 and stroke_color.lower() == "#00000000":
            actual_stroke_color = color
        else:
            actual_stroke_color = stroke_color

        for i, line in enumerate(lines):
            line_bbox = font_obj.getbbox(line)
            line_width = line_bbox[2] if line_bbox else 0
            if horizontal_align == "left":
                x = stroke_width
            elif horizontal_align == "center":
                x = int((text_width - line_width) / 2) + stroke_width
            elif horizontal_align == "right":
                x = text_width - line_width + stroke_width
            
            y = i * line_height + stroke_width

            if text_layer_shadow is not None:
                draw_s = ImageDraw.Draw(text_layer_shadow)
                draw_s.text((x + shadow_distance, y + shadow_distance), line, font=font_obj, fill=shadow_color, stroke_width=stroke_width, stroke_fill=actual_stroke_color)

            draw = ImageDraw.Draw(text_layer)
            draw.text((x, y), line, font=font_obj, fill=color, stroke_width=stroke_width, stroke_fill=actual_stroke_color)

        if text_layer_shadow is not None:
            if shadow_blur > 0:
                text_layer_shadow = text_layer_shadow.filter(ImageFilter.GaussianBlur(shadow_blur))
            text_layer = Image.alpha_composite(text_layer_shadow, text_layer)

        # Rotate the text layer
        if rotation != 0:
            text_layer = text_layer.rotate(rotation, expand=True, resample=Image.BICUBIC)

        if img_composite is not None:
            img_composite_pil = T.ToPILImage()(img_composite.permute([0,3,1,2])[0]).convert('RGBA')
            width = img_composite_pil.width
            height = img_composite_pil.height
            image = Image.new('RGBA', (width, height), color=background_color)
        else:
            width = text_layer.width
            height = text_layer.height
            bg_color_rgb = ImageColor.getrgb(background_color)
            image = Image.new('RGBA', (width, height), color=bg_color_rgb)

        # Calculate paste coordinates based on alignment
        paste_x = offset_x
        paste_y = offset_y
        
        if horizontal_align == "center":
            paste_x += (width - text_layer.width) // 2
        elif horizontal_align == "right":
            paste_x += width - text_layer.width
            
        if vertical_align == "center":
            paste_y += (height - text_layer.height) // 2
        elif vertical_align == "bottom":
            paste_y += height - text_layer.height

        # Paste the rotated text layer onto the image
        image.paste(text_layer, (paste_x, paste_y), text_layer)

        # Generate mask
        mask = T.ToTensor()(image).unsqueeze(0).permute([0,2,3,1])
        mask = mask[:, :, :, 3] if mask.shape[3] == 4 else torch.ones_like(mask[:, :, :, 0])

        if img_composite is not None:
            image = Image.alpha_composite(img_composite_pil, image)
        
        image_out = T.ToTensor()(image).unsqueeze(0).permute([0,2,3,1])

        return (image_out[:, :, :, :3], mask,)

NODE_CLASS_MAPPINGS = {
    "DrawTextAdvanced": DrawTextAdvanced,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DrawTextAdvanced": "XYZ Draw Text Advanced",
}
