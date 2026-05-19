from PIL import Image

def analyze_borders(img_path):
    img = Image.open(img_path).convert("RGBA")
    w, h = img.size
    pixels = img.load()
    
    # We want to trace the boundary.
    # For each row y, find the first x where alpha > 0 (left edge) and the last x where alpha > 0 (right edge)
    print(f"Analyzing borders of {img_path} ({w}x{h})")
    
    left_edges = []
    right_edges = []
    
    for y in range(h):
        first_x = -1
        last_x = -1
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if a > 0:
                if first_x == -1:
                    first_x = x
                last_x = x
        if first_x != -1:
            left_edges.append((first_x, y, pixels[first_x, y]))
            right_edges.append((last_x, y, pixels[last_x, y]))
            
    print("Left edge samples (first 10):")
    for x, y, (r, g, b, a) in left_edges[:10]:
        print(f"y={y:3d}, x={x:3d}: R={r:3d}, G={g:3d}, B={b:3d}, A={a:3d}")
        
    print("\nRight edge samples (first 10):")
    for x, y, (r, g, b, a) in right_edges[:10]:
        print(f"y={y:3d}, x={x:3d}: R={r:3d}, G={g:3d}, B={b:3d}, A={a:3d}")

analyze_borders(r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_tile.png")
analyze_borders(r"d:\Program\Dawnhold\frontend\public\v2_assets\grass_tile.png")
