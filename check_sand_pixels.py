from PIL import Image

try:
    img = Image.open(r"d:\Program\Dawnhold\frontend\public\v2_assets\beach_1110.png")
    pixels = list(img.getdata())
    print("beach_1110.png loaded successfully.")
    
    # Print pixel at center (128, 64)
    idx_center = 64 * 256 + 128
    r, g, b, a = pixels[idx_center]
    print(f"Center Pixel (x=128, y=64): R={r}, G={g}, B={b}, A={a}")
    
    # Check if there are any pixels that have color but A=255
    found = 0
    for idx, (r, g, b, a) in enumerate(pixels):
        if a == 255:
            print(f"Solid Pixel {idx} (x={idx % 256}, y={idx // 256}): R={r}, G={g}, B={b}")
            found += 1
            if found >= 10:
                break
except Exception as e:
    print("Error:", e)
