from PIL import Image

try:
    sand = Image.open(r"d:\Program\Dawnhold\frontend\public\v2_assets\sand_tile.png")
    water = Image.open(r"d:\Program\Dawnhold\frontend\public\v2_assets\water_tile.png")
    print("Sand Tile size:", sand.size, "Mode:", sand.mode)
    print("Water Tile size:", water.size, "Mode:", water.mode)
except Exception as e:
    print("Error:", e)
