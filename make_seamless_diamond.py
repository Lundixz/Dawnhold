from PIL import Image, ImageDraw

def make_seamless_diamond(src_path, dest_path):
    print(f"Converting {src_path} to seamless diamond tile...")
    src_img = Image.open(src_path).convert("RGBA")
    
    # We want a high-res 256x128 isometric tile
    tile_w, tile_h = 256, 128
    
    # Resize a patch of the seamless texture to 256x128
    # Let's crop a 512x256 region from the center and scale it down to 256x128
    src_w, src_h = src_img.size
    crop_w, crop_h = 512, 256
    left = (src_w - crop_w) // 2
    top = (src_h - crop_h) // 2
    patch = src_img.crop((left, top, left + crop_w, top + crop_h))
    patch = patch.resize((tile_w, tile_h), Image.Resampling.LANCZOS)
    
    # Create the diamond mask with feathering (anti-aliasing)
    pixels = list(patch.getdata())
    new_pixels = []
    
    cx, cy = tile_w / 2, tile_h / 2
    rx, ry = tile_w / 2, tile_h / 2
    
    for idx, (r, g, b, a) in enumerate(pixels):
        x = idx % tile_w
        y = idx // tile_w
        
        # Distance calculation for diamond boundary
        dist = abs(x - cx) / rx + abs(y - cy) / ry
        
        # Soft feathering at the boundary
        if dist <= 0.98:
            alpha = 255
        elif dist >= 1.02:
            alpha = 0
        else:
            # Interpolate smoothly
            t = (dist - 0.98) / (1.02 - 0.98)
            alpha = int(255 * (1.0 - t))
            
        new_pixels.append((r, g, b, alpha))
        
    patch.putdata(new_pixels)
    patch.save(dest_path, "PNG")
    print(f"Successfully saved seamless diamond grass tile to {dest_path}")

src_path = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\seamless_cozy_grass_1779051615796.png"
dest_path = r"d:\Program\Dawnhold\frontend\public\v2_assets\grass_tile.png"

try:
    make_seamless_diamond(src_path, dest_path)
except Exception as e:
    print(e)
