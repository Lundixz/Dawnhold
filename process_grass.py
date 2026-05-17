import os
from PIL import Image

def process_grass(src_path, dest_path):
    print(f"Processing grass {src_path} -> {dest_path}")
    img = Image.open(src_path).convert("RGBA")
    datas = img.getdata()
    
    new_data = []
    for r, g, b, a in datas:
        # Aggressive white removal for the grass block
        is_near_white = r > 230 and g > 230 and b > 230
        is_grey_fringe = (r > 170 and g > 170 and b > 170) and abs(r - g) < 25 and abs(g - b) < 25
        
        if is_near_white or is_grey_fringe:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append((r, g, b, a))
            
    img.putdata(new_data)
    
    # Let's crop it tightly to the grass block bounding box to make anchor calculation exact!
    # Get bounding box of non-transparent pixels
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
        print(f"Cropped grass block to tight bounding box: {bbox}")
        
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    img.save(dest_path, "PNG")
    print(f"Saved grass block to {dest_path}")

src_path = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\iso_grass_tile_1779049726980.png"
dest_path = r"d:\Program\Dawnhold\frontend\public\v2_assets\grass_tile.png"

try:
    process_grass(src_path, dest_path)
except Exception as e:
    print(e)
