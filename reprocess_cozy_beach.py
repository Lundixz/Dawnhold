import os
from PIL import Image

def make_seamless_diamond(src_path, dest_path, feather_start=0.99, feather_end=1.01):
    print(f"Converting {src_path} to seamless diamond tile with tight feathering...")
    src_img = Image.open(src_path).convert("RGBA")
    
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
        
        # 1.015 threshold creates a 2px horizontal / 1px vertical overlap to kill WebGL/WebGPU seams under zoom!
        if dist <= 1.015:
            alpha = 255
        else:
            alpha = 0
            
        new_pixels.append((r, g, b, alpha))
        
    patch.putdata(new_pixels)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    patch.save(dest_path, "PNG")
    print(f"Successfully saved tile to {dest_path}")

src_sand = r"C:\Users\lundm\.gemini\antigravity\brain\da71a42f-7e3f-462f-9f30-04e8fe567d22\clean_cozy_sand_1779185664158.png"
dest_sand = r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_tile.png"

src_water = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\seamless_cozy_water_1779052139057.png"
dest_water = r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile.png"

try:
    make_seamless_diamond(src_sand, dest_sand)
    make_seamless_diamond(src_water, dest_water)
except Exception as e:
    print(e)
