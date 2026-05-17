from PIL import Image

def turn_grey_to_shadow(image_path):
    img = Image.open(image_path).convert("RGBA")
    width, height = img.size
    datas = img.getdata()
    
    new_data = []
    for idx, (r, g, b, a) in enumerate(datas):
        y = idx // width
        # Only apply to the bottom portion of the tree (where roots and shadow are)
        if y > height * 0.75:
            # Check if it is a grey/black/white neutral color
            is_grey = abs(r - g) < 30 and abs(g - b) < 30 and abs(r - b) < 30
            if is_grey and a > 0:
                # Turn it into a soft black shadow!
                # We can set the color to black (0,0,0) and keep the alpha, or make it slightly softer
                new_data.append((0, 0, 0, int(a * 0.8)))
            else:
                new_data.append((r, g, b, a))
        else:
            new_data.append((r, g, b, a))
            
    img.putdata(new_data)
    img.save(image_path, "PNG")
    print("Successfully turned grey base into a soft black shadow!")

try:
    turn_grey_to_shadow(r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png")
except Exception as e:
    print(e)
