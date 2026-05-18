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
                    
                # Fetch source sand pixel colors
                r_s, g_s, b_s, a_s = sand_pixels[idx]
                
                # Use pure sand colors
                r = r_s
                g = g_s
                b = b_s
                
                # Alpha is proportional to sand presence (t_sand)
                alpha = int(255 * t_sand)
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

def generate_grass_sand_transitions():
    print("Generating rounded autotile grass-to-sand transitions...")
    
    # Paths
    grass_path = r"d:\Program\Dawnhold\frontend\public\v2_assets\grass_tile.png"
    sand_path = r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_tile.png"
    dest_dir = r"d:\Program\Dawnhold\frontend\public\v2_assets"
    
    # Load source tiles
    grass_img = Image.open(grass_path).convert("RGBA")
    
    tile_w, tile_h = 256, 128
    cx, cy = tile_w / 2, tile_h / 2
    rx, ry = tile_w / 2, tile_h / 2
    
    grass_pixels = list(grass_img.getdata())
    
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
                
                # Bilinear interpolation of grass probability (0.0 to 1.0)
                val = (1.0 - u) * (1.0 - v) * c_top + \
                      u * (1.0 - v) * c_right + \
                      u * v * c_bottom + \
                      (1.0 - u) * v * c_left
                      
                # Smoothstep threshold for rounded, painted transition
                if val <= 0.45:
                    t_grass = 0.0
                elif val >= 0.55:
                    t_grass = 1.0
                else:
                    t_grass = (val - 0.45) / 0.10
                    t_grass = t_grass * t_grass * (3.0 - 2.0 * t_grass)
                    
                # Fetch source grass pixel colors
                r_g, g_g, b_g, a_g = grass_pixels[idx]
                
                # Use pure grass colors
                r = r_g
                g = g_g
                b = b_g
                
                # Alpha is proportional to grass presence (t_grass)
                alpha = int(255 * t_grass)
                new_pixels.append((r, g, b, alpha))
                
        # Save image
        out_img = Image.new("RGBA", (tile_w, tile_h))
        out_img.putdata(new_pixels)
        out_path = os.path.join(dest_dir, f"grass_sand_{combo}.png")
        out_img.save(out_path, "PNG")
        print(f"Successfully generated {out_path}")

try:
    generate_grass_sand_transitions()
except Exception as e:
    print(e)

def generate_shallow_deep_transitions():
    print("Generating rounded autotile shallow-to-deep water transitions...")
    
    # Paths
    shallow_path = r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile.png"
    dest_dir = r"d:\Program\Dawnhold\frontend\public\v2_assets"
    
    # Load source tiles
    shallow_img = Image.open(shallow_path).convert("RGBA")
    
    tile_w, tile_h = 256, 128
    cx, cy = tile_w / 2, tile_h / 2
    rx, ry = tile_w / 2, tile_h / 2
    
    shallow_pixels = list(shallow_img.getdata())
    
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
                
                # Bilinear interpolation of shallow water probability (0.0 to 1.0)
                val = (1.0 - u) * (1.0 - v) * c_top + \
                      u * (1.0 - v) * c_right + \
                      u * v * c_bottom + \
                      (1.0 - u) * v * c_left
                      
                # Smoothstep threshold for rounded, painted transition
                if val <= 0.45:
                    t_shallow = 0.0
                elif val >= 0.55:
                    t_shallow = 1.0
                else:
                    t_shallow = (val - 0.45) / 0.10
                    t_shallow = t_shallow * t_shallow * (3.0 - 2.0 * t_shallow)
                    
                # Fetch source shallow water pixel colors
                r_w, g_w, b_w, a_w = shallow_pixels[idx]
                
                # Use pure shallow water colors
                r = r_w
                g = g_w
                b = b_w
                
                # Alpha is proportional to shallow water presence (t_shallow)
                alpha = int(255 * t_shallow)
                new_pixels.append((r, g, b, alpha))
                
        # Save image
        out_img = Image.new("RGBA", (tile_w, tile_h))
        out_img.putdata(new_pixels)
        out_path = os.path.join(dest_dir, f"shallow_deep_{combo}.png")
        out_img.save(out_path, "PNG")
        print(f"Successfully generated {out_path}")

try:
    generate_shallow_deep_transitions()
except Exception as e:
    print(e)
