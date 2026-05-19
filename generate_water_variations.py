import os
from PIL import Image

def offset_image(img, dx, dy):
    w, h = img.size
    dx = dx % w
    dy = dy % h
    
    new_img = Image.new("RGBA", (w, h))
    new_img.paste(img.crop((w - dx, h - dy, w, h)), (0, 0))
    new_img.paste(img.crop((0, h - dy, w - dx, h)), (dx, 0))
    new_img.paste(img.crop((w - dx, 0, w, h - dy)), (0, dy))
    new_img.paste(img.crop((0, 0, w - dx, h - dy)), (dx, dy))
    return new_img

def make_seamless_diamond(src_img, dest_path):
    tile_w, tile_h = 256, 128
    
    src_w, src_h = src_img.size
    crop_w, crop_h = 512, 256
    left = (src_w - crop_w) // 2
    top = (src_h - crop_h) // 2
    patch = src_img.crop((left, top, left + crop_w, top + crop_h))
    patch = patch.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
    
    pixels = list(patch.getdata())
    new_pixels = []
    
    cx, cy = 127.5, 63.5
    rx, ry = 127.5, 63.5
    
    for idx, (r, g, b, a) in enumerate(pixels):
        x = idx % tile_w
        y = idx // tile_w
        
        dist = abs(x - cx) / rx + abs(y - cy) / ry
        
        if dist <= 1.015:
            alpha = 255
        else:
            alpha = 0
            
        new_pixels.append((r, g, b, alpha))
        
    patch.putdata(new_pixels)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    patch.save(dest_path, "PNG")
    print(f"Successfully saved tile to {dest_path}")

src_water_path = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\seamless_cozy_water_1779052139057.png"

try:
    src_water_img = Image.open(src_water_path).convert("RGBA")
    
    # Generate 3 variations
    # Var 0: No offset (standard)
    make_seamless_diamond(src_water_img, r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile.png")
    make_seamless_diamond(src_water_img, r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile_soft.png")
    
    # Var 1: Offset 1
    water_v1 = offset_image(src_water_img, 128, 128)
    make_seamless_diamond(water_v1, r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile_v1.png")
    make_seamless_diamond(water_v1, r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile_soft_v1.png")
    
    # Var 2: Offset 2
    water_v2 = offset_image(src_water_img, 256, 384)
    make_seamless_diamond(water_v2, r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile_v2.png")
    make_seamless_diamond(water_v2, r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile_soft_v2.png")
    
    print("All water variations generated successfully!")
except Exception as e:
    print("Error:", e)
