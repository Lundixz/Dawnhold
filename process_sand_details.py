import os
from PIL import Image

def process_detail_image(src_path, dest_path, target_size=(24, 24)):
    print(f"Processing detail image {src_path}...")
    img = Image.open(src_path).convert("RGBA")
    w, h = img.size
    
    min_x, min_y = w, h
    max_x, max_y = 0, 0
    
    pixels = list(img.getdata())
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            r, g, b, a = pixels[idx]
            # Non-white pixels represent the object
            if not (r > 240 and g > 240 and b > 240):
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                
    if max_x < min_x or max_y < min_y:
        print(f"No object detected in {src_path}, using whole image.")
        cropped = img
    else:
        pad = 8
        min_x = max(0, min_x - pad)
        max_x = min(w - 1, max_x + pad)
        min_y = max(0, min_y - pad)
        max_y = min(h - 1, max_y + pad)
        cropped = img.crop((min_x, min_y, max_x + 1, max_y + 1))
        
    cropped_pixels = list(cropped.getdata())
    new_pixels = []
    for r, g, b, a in cropped_pixels:
        if r > 235 and g > 235 and b > 235:
            new_pixels.append((255, 255, 255, 0))
        else:
            new_pixels.append((r, g, b, 255))
            
    cropped.putdata(new_pixels)
    cropped.thumbnail(target_size, Image.Resampling.LANCZOS)
    
    canvas = Image.new("RGBA", target_size, (255, 255, 255, 0))
    offset = ((target_size[0] - cropped.size[0]) // 2, (target_size[1] - cropped.size[1]) // 2)
    canvas.paste(cropped, offset)
    
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    canvas.save(dest_path, "PNG")
    print(f"Saved processed detail to {dest_path}")

src_pebble = r"C:\Users\lundm\.gemini\antigravity\brain\da71a42f-7e3f-462f-9f30-04e8fe567d22\sand_pebble_1779185734368.png"
src_shell = r"C:\Users\lundm\.gemini\antigravity\brain\da71a42f-7e3f-462f-9f30-04e8fe567d22\sand_shell_1779185751096.png"

try:
    process_detail_image(src_pebble, r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_pebble.png")
    process_detail_image(src_shell, r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_shell.png")
    print("Sand details processing complete!")
except Exception as e:
    print(e)
