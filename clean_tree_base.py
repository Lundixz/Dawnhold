from PIL import Image

def clean_tree_base(image_path):
    img = Image.open(image_path).convert("RGBA")
    width, height = img.size
    datas = img.getdata()
    
    new_data = []
    for idx, (r, g, b, a) in enumerate(datas):
        y = idx // width
        # Target the very bottom base of the tree (roots and grassy stand)
        if y > height * 0.76:
            # Let's identify the brown wood of the trunk/roots.
            # Brown wood is characterized by R > G and G > B, and not extremely dark or bright.
            # e.g., r between 40 and 150, g between 25 and 110, b between 10 and 80.
            is_brown_wood = (r > g) and (g > b) and (r > 35) and (b < 100)
            
            # If it's NOT brown wood, we make it completely transparent!
            # This will instantly strip the green grassy stand and the dithered black shadow.
            if not is_brown_wood:
                new_data.append((255, 255, 255, 0))
            else:
                new_data.append((r, g, b, a))
        else:
            new_data.append((r, g, b, a))
            
    img.putdata(new_data)
    img.save(image_path, "PNG")
    print("Stripped the grassy stand and checkerboard shadow from tree base!")

try:
    # First, let's restore the original clean tree image from brain directory so we start fresh!
    import shutil
    shutil.copy(
        r"C:\Users\lundm\.gemini\antigravity\brain\e1a57445-fc4d-425d-b2bf-8fbf415c5334\iso_cozy_tree_1779049745863.png",
        r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png"
    )
    clean_tree_base(r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png")
except Exception as e:
    print(e)
