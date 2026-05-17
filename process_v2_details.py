import shutil
import os
from PIL import Image

def process_and_copy(src_path, dest_path):
    print(f"Processing {src_path} -> {dest_path}")
    # Convert and remove white background
    img = Image.open(src_path).convert("RGBA")
    datas = img.getdata()
    
    new_data = []
    for r, g, b, a in datas:
        # Aggressive white removal for pure white background
        is_near_white = r > 230 and g > 230 and b > 230
        is_grey_fringe = (r > 160 and g > 160 and b > 160) and abs(r - g) < 20 and abs(g - b) < 20
        
        if is_near_white or is_grey_fringe:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append((r, g, b, a))
            
    img.putdata(new_data)
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    img.save(dest_path, "PNG")
    print(f"Saved processed asset to {dest_path}")

# Source paths from anti-gravity folder
src_flowers = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\iso_cozy_flowers_1779051204815.png"
src_bush = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\iso_cozy_bush_1779051219286.png"
src_grass = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\iso_cozy_grass_tuft_1779051234561.png"

# Dest paths
dest_flowers = r"d:\Program\Dawnhold\frontend\public\v2_assets\flowers.png"
dest_bush = r"d:\Program\Dawnhold\frontend\public\v2_assets\bush.png"
dest_grass = r"d:\Program\Dawnhold\frontend\public\v2_assets\grass_tuft.png"

try:
    process_and_copy(src_flowers, dest_flowers)
    process_and_copy(src_bush, dest_bush)
    process_and_copy(src_grass, dest_grass)
except Exception as e:
    print(e)
