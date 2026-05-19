from PIL import Image
import numpy as np

def analyze_border_colors(img_path):
    img = Image.open(img_path).convert("RGBA")
    w, h = img.size
    pixels = img.load()
    
    cx, cy = w / 2, h / 2
    rx, ry = w / 2, h / 2
    
    border_colors = []
    inner_colors = []
    
    for y in range(h):
        for x in range(w):
            dist = abs(x - cx) / rx + abs(y - cy) / ry
            r, g, b, a = pixels[x, y]
            if a > 0:
                # Border pixels (within 0.02 of the edge)
                if dist >= 0.97 and dist <= 1.0:
                    border_colors.append((r, g, b))
                # Inner pixels (well inside the diamond)
                elif dist < 0.90:
                    inner_colors.append((r, g, b))
                    
    mean_border = np.mean(border_colors, axis=0)
    mean_inner = np.mean(inner_colors, axis=0)
    print(f"Analysis for {img_path}:")
    print(f"  Mean border color: R={mean_border[0]:.1f}, G={mean_border[1]:.1f}, B={mean_border[2]:.1f}")
    print(f"  Mean inner color:  R={mean_inner[0]:.1f}, G={mean_inner[1]:.1f}, B={mean_inner[2]:.1f}")
    print(f"  Difference (Border - Inner): R={mean_border[0]-mean_inner[0]:.1f}, G={mean_border[1]-mean_inner[1]:.1f}, B={mean_border[2]-mean_inner[2]:.1f}")

analyze_border_colors(r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_tile.png")
analyze_border_colors(r"d:\Program\Dawnhold\frontend\public\v2_assets\grass_tile.png")
analyze_border_colors(r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile.png")
