"""Dev-only: assemble frames from record-demo.mjs into docs/demo.gif.

Usage (Pillow is only needed here, so pull it in for this one command):
    uv run --with pillow python ui/scripts/make_gif.py <frames dir> docs/demo.gif
"""

import json
import sys
from pathlib import Path

from PIL import Image

frames_dir, out = Path(sys.argv[1]), Path(sys.argv[2])
frames = json.loads((frames_dir / "frames.json").read_text(encoding="utf-8"))
width = 1100

images = []
for frame in frames:
    image = Image.open(frame["path"]).convert("RGB")
    image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    images.append(image.quantize(colors=96, method=Image.Quantize.MEDIANCUT))

out.parent.mkdir(parents=True, exist_ok=True)
images[0].save(out, save_all=True, append_images=images[1:], duration=[f["hold"] for f in frames],
               loop=0, optimize=True)
print(f"{out}: {len(images)} frames, {out.stat().st_size / 1e6:.1f} MB")
