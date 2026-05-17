from PIL import Image

try:
    img = Image.open(r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_tile_soft.png")
    pixels = list(img.getdata())
    print("sand_tile_soft.png loaded successfully.")
    print("Size:", img.size)
    print("Mode:", img.mode)
    
    # Print pixel at center (128, 64)
    idx_center = 64 * 256 + 128
    r, g, b, a = pixels[idx_center]
    print(f"Center Pixel (x=128, y=64): R={r}, G={g}, B={b}, A={a}")
    
    # Check if there are any solid pixels
    found = 0
    for idx, (r, g, b, a) in enumerate(pixels):
        if a == 255:
            print(f"Solid Pixel {idx} (x={idx % 256}, y={idx // 256}): R={r}, G={g}, B={b}")
            found += 1
            if found >= 10:
                break
except Exception as e:
    print("Error:", e)
