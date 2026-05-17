import os
import io
from rembg import remove
from PIL import Image

def remove_bg(input_path, output_path):
    print(f"Processing {input_path}...")
    with open(input_path, 'rb') as i:
        with open(output_path, 'wb') as o:
            input_bytes = i.read()
            output_bytes = remove(input_bytes)
            o.write(output_bytes)
    print(f"Done: {output_path}")

try:
    remove_bg(r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png", r"d:\Program\Dawnhold\frontend\public\v2_assets\tree_1.png")
except Exception as e:
    print(e)
