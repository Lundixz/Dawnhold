from PIL import Image

def remove_checkerboard(image_path):
    img = Image.open(image_path).convert("RGBA")
    datas = img.getdata()
    
    new_data = []
    for r, g, b, a in datas:
        # Check if the pixel is light and grey-ish (the fake checkerboard)
        # The fake checkerboard usually consists of white (255,255,255) and light grey (around 200-230).
        if a > 0:
            is_light = r > 180 and g > 180 and b > 180
            is_grey = abs(r - g) < 15 and abs(g - b) < 15 and abs(r - b) < 15
            if is_light and is_grey:
                new_data.append((255, 255, 255, 0))
            else:
                new_data.append((r, g, b, a))
        else:
            new_data.append((r, g, b, a))
            
    img.putdata(new_data)
    img.save(image_path, "PNG")
    print("Removed checkerboard!")

try:
    remove_checkerboard(r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png")
except Exception as e:
    print(e)
