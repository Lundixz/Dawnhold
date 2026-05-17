import os
from PIL import Image

def generate_beach_transitions():
    print("Generating rounded autotile beach transitions...")
    
    # Paths
    sand_path = r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_tile.png"
    water_path = r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile.png"
    dest_dir = r"d:\Program\Dawnhold\frontend\public\v2_assets"
    
    # Load source tiles
    sand_img = Image.open(sand_path).convert("RGBA")
    water_img = Image.open(water_path).convert("RGBA")
    
    tile_w, tile_h = 256, 128
    cx, cy = tile_w / 2, tile_h / 2
    rx, ry = tile_w / 2, tile_h / 2
    
    sand_pixels = list(sand_img.getdata())
    water_pixels = list(water_img.getdata())
    
    # 14 combinations (excluding 0000=all water, 1111=all sand)
    # Corners order: Top (00), Right (10), Bottom (11), Left (01)
    combinations = [
        "0001", "0010", "0011", "0100", "0101", "0110", "0111",
        "1000", "1001", "1010", "1011", "1100", "1101", "1110"
    ]
    
    for combo in combinations:
        c_top = int(combo[0])    # (0, 0)
        c_right = int(combo[1])  # (1, 0)
        c_bottom = int(combo[2]) # (1, 1)
        c_left = int(combo[3])   # (0, 1)
        
        new_pixels = []
        
        for idx in range(tile_w * tile_h):
            x = idx % tile_w
            y = idx // tile_w
            
            # Manhattan distance for diamond shape
            dist = abs(x - cx) / rx + abs(y - cy) / ry
            
            if dist >= 0.99:
                new_pixels.append((0, 0, 0, 0))
            else:
                # Bilinear mapping
                x_norm = (x - cx) / rx
                y_norm = (y - cy) / ry
                
                u = (x_norm + y_norm + 1.0) / 2.0
                v = (-x_norm + y_norm + 1.0) / 2.0
                
                # Clamp uv just in case
                u = max(0.0, min(1.0, u))
                v = max(0.0, min(1.0, v))
                
                # Bilinear interpolation of sand probability (0.0 to 1.0)
                val = (1.0 - u) * (1.0 - v) * c_top + \
                      u * (1.0 - v) * c_right + \
                      u * v * c_bottom + \
                      (1.0 - u) * v * c_left
                      
                # Smoothstep threshold for rounded, painted transition
                # 0.45 to 0.55 gives a beautifully narrow soft edge
                if val <= 0.45:
                    t_sand = 0.0
                elif val >= 0.55:
                    t_sand = 1.0
                else:
                    t_sand = (val - 0.45) / 0.10
                    t_sand = t_sand * t_sand * (3.0 - 2.0 * t_sand)
                    
                # Fetch source pixel colors
                r_s, g_s, b_s, a_s = sand_pixels[idx]
                r_w, g_w, b_w, a_w = water_pixels[idx]
                
                # Interpolate color channels
                r = int(r_s * t_sand + r_w * (1.0 - t_sand))
                g = int(g_s * t_sand + g_w * (1.0 - t_sand))
                b = int(b_s * t_sand + b_w * (1.0 - t_sand))
                
                # Narrow feathering at diamond edges to prevent subpixel seams
                if dist <= 0.93:
                    alpha = 255
                elif dist >= 0.98:
                    alpha = 0
                else:
                    t_edge = (dist - 0.93) / 0.05
                    alpha = int(255 * (1.0 - t_edge))
                    
                new_pixels.append((r, g, b, alpha))
                
        # Save image
        out_img = Image.new("RGBA", (tile_w, tile_h))
        out_img.putdata(new_pixels)
        out_path = os.path.join(dest_dir, f"beach_{combo}.png")
        out_img.save(out_path, "PNG")
        print(f"Successfully generated {out_path}")

try:
    generate_beach_transitions()
except Exception as e:
    print(e)
