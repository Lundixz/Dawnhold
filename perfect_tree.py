import shutil
from PIL import Image

def process_perfect_tree(src_path, dest_path):
    print("Processing perfect tree...")
    img = Image.open(src_path).convert("RGBA")
    width, height = img.size
    datas = img.getdata()
    
    new_data = []
    for idx, (r, g, b, a) in enumerate(datas):
        y = idx // width
        
        # 1. Clean white/grey fringe from the entire tree
        is_near_white = r > 220 and g > 220 and b > 220
        is_grey_fringe = (r > 140 and g > 140 and b > 140) and abs(r - g) < 25 and abs(g - b) < 25
        
        if is_near_white or is_grey_fringe:
            new_data.append((255, 255, 255, 0))
            continue
            
        # 2. Specifically clean up the grass base at the bottom
        if y > height * 0.76:
            # We want to keep ONLY the brown trunk and roots.
            # Brown trunk has R > G and G > B, and isn't too light or extremely dark.
            is_brown_wood = (r > g) and (g > b) and (r > 35) and (b < 100)
            if not is_brown_wood:
                new_data.append((255, 255, 255, 0))
            else:
                new_data.append((r, g, b, a))
        else:
            new_data.append((r, g, b, a))
            
    img.putdata(new_data)
    
    # Crop to the tight bounding box of the tree trunk
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
        print(f"Cropped tree to bounding box: {bbox}")
        
    img.save(dest_path, "PNG")
    print(f"Saved perfect tree to {dest_path}")

src_path = r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\iso_cozy_tree_1779049745863.png"
dest_path = r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png"

try:
    process_perfect_tree(src_path, dest_path)
except Exception as e:
    print(e)
