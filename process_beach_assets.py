import os
from PIL import Image

def make_seamless_diamond(src_path, dest_path, feather_start=0.98, feather_end=1.02):
    print(f"Converting {src_path} to seamless diamond tile...")
    src_img = Image.open(src_path).convert("RGBA")
    
    tile_w, tile_h = 256, 128
    
    # Crop a 512x256 region from the center and scale it down to 256x128
    src_w, src_h = src_img.size
    crop_w, crop_h = 512, 256
    left = (src_w - crop_w) // 2
    top = (src_h - crop_h) // 2
    patch = src_img.crop((left, top, left + crop_w, top + crop_h))
    patch = patch.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
    
    pixels = list(patch.getdata())
    new_pixels = []
    
    cx, cy = tile_w / 2, tile_h / 2
    rx, ry = tile_w / 2, tile_h / 2
    
    for idx, (r, g, b, a) in enumerate(pixels):
        x = idx % tile_w
        y = idx // tile_w
        
        # Distance check for diamond boundary
        dist = abs(x - cx) / rx + abs(y - cy) / ry
        
        # Soft feathering at the boundary
        if dist <= feather_start:
            alpha = 255
        elif dist >= feather_end:
            alpha = 0
        else:
            t = (dist - feather_start) / (feather_end - feather_start)
            alpha = int(255 * (1.0 - t))
            
        new_pixels.append((r, g, b, alpha))
        
    patch.putdata(new_pixels)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    patch.save(dest_path, "PNG")
    print(f"Successfully saved seamless diamond tile to {dest_path}")

src_sand = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\seamless_cozy_sand_1779052121514.png"
dest_sand = r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_tile.png"

src_water = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\seamless_cozy_water_1779052139057.png"
dest_water = r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile.png"

try:
    # We want a slightly wider feathering on sand/water so they blend even softer!
    make_seamless_diamond(src_sand, dest_sand, feather_start=0.96, feather_end=1.04)
    make_seamless_diamond(src_water, dest_water, feather_start=0.96, feather_end=1.04)
except Exception as e:
    print(e)
