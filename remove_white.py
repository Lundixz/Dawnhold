from PIL import Image

def make_white_transparent(image_path):
    img = Image.open(image_path)
    img = img.convert("RGBA")
    datas = img.getdata()
    
    new_data = []
    # AI images often have near-white anti-aliasing.
    # We will make anything close to white transparent.
    for item in datas:
        # Check if the pixel is very light (close to white)
        # item is (R, G, B, A)
        if item[0] > 240 and item[1] > 240 and item[2] > 240:
            # Fully transparent
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)
            
    img.putdata(new_data)
    img.save(image_path, "PNG")
    print(f"Removed white background from {image_path}")

make_white_transparent(r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png")
