from PIL import Image

try:
    img = Image.open(r"d:\Program\Dawnhold\frontend\public\v2_assets\beach_0001.png")
    pixels = list(img.getdata())
    print("Image size:", img.size)
    print("Format:", img.format)
    print("Mode:", img.mode)
    
    # Print the first 20 non-transparent pixels
    found = 0
    for idx, (r, g, b, a) in enumerate(pixels):
        if a > 0:
            print(f"Pixel {idx} (x={idx % 256}, y={idx // 256}): R={r}, G={g}, B={b}, A={a}")
            found += 1
            if found >= 20:
                break
except Exception as e:
    print("Error:", e)
