from PIL import Image

def aggressive_cleanup(image_path):
    img = Image.open(image_path).convert("RGBA")
    datas = img.getdata()
    
    # We will also restore a clean backup if we have one, or just process the existing file.
    # Since we already processed the file, some pixels are already A=0. We'll process the remaining ones.
    new_data = []
    for r, g, b, a in datas:
        if a > 0:
            # Aggressive threshold for light grey / white fringe
            # Let's target any neutral pixel that is somewhat light
            is_light = r > 140 and g > 140 and b > 140
            # Grey means R, G, B are very close to each other
            is_grey = abs(r - g) < 25 and abs(g - b) < 25 and abs(r - b) < 25
            
            # Also catch very bright pixels of any color that might be edge artifacts (e.g. anti-aliased white fringe)
            is_near_white = r > 220 and g > 220 and b > 220
            
            if (is_light and is_grey) or is_near_white:
                new_data.append((255, 255, 255, 0))
            else:
                new_data.append((r, g, b, a))
        else:
            new_data.append((r, g, b, a))
            
    img.putdata(new_data)
    img.save(image_path, "PNG")
    print("Aggressive cleanup complete!")

try:
    aggressive_cleanup(r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png")
except Exception as e:
    print(e)
