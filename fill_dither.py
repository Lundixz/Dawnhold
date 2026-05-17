from PIL import Image

def fill_dithered_shadow(image_path):
    img = Image.open(image_path).convert("RGBA")
    width, height = img.size
    
    # We will do a few iterations of dilation to fill the checkerboard holes
    for iteration in range(2):
        pixels = list(img.getdata())
        new_pixels = list(pixels)
        
        for y in range(int(height * 0.75), height - 1):
            for x in range(1, width - 1):
                idx = y * width + x
                r, g, b, a = pixels[idx]
                
                if a == 0:
                    # Check 4-neighbors
                    neighbors = [
                        pixels[idx - 1],          # Left
                        pixels[idx + 1],          # Right
                        pixels[idx - width],      # Up
                        pixels[idx + width]       # Down
                    ]
                    
                    # Count how many neighbors are shadow pixels (black and semi-transparent)
                    shadow_neighbors = [n for n in neighbors if n[0] == 0 and n[1] == 0 and n[2] == 0 and n[3] > 0]
                    
                    if len(shadow_neighbors) >= 1:
                        # Fill the hole! Use the average alpha of the shadow neighbors
                        avg_alpha = sum(n[3] for n in shadow_neighbors) // len(shadow_neighbors)
                        new_pixels[idx] = (0, 0, 0, avg_alpha)
                        
        img.putdata(new_pixels)
        
    # Finally, apply a very gentle blur to ONLY the shadow pixels in the bottom area to make it super smooth
    # We can do this by running a box blur on the alpha channel of black pixels
    pixels = list(img.getdata())
    new_pixels = list(pixels)
    for y in range(int(height * 0.75), height - 1):
        for x in range(1, width - 1):
            idx = y * width + x
            r, g, b, a = pixels[idx]
            if r == 0 and g == 0 and b == 0 and a > 0:
                # Average the alpha with neighbors to smooth it out
                neighbors = [
                    pixels[idx - 1],
                    pixels[idx + 1],
                    pixels[idx - width],
                    pixels[idx + width],
                    pixels[idx]
                ]
                shadow_alphas = [n[3] for n in neighbors if n[0] == 0 and n[1] == 0 and n[2] == 0]
                if shadow_alphas:
                    new_alpha = sum(shadow_alphas) // len(shadow_alphas)
                    new_pixels[idx] = (0, 0, 0, new_alpha)
                    
    img.putdata(new_pixels)
    img.save(image_path, "PNG")
    print("Filled dithered shadow holes and smoothed the edges!")

try:
    fill_dithered_shadow(r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png")
except Exception as e:
    print(e)
