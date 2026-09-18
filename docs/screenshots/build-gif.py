"""Resample the screencast to a constant frame rate on the REAL timeline, draw the caption band,
write seq/NNNN.png. Usage: build.py <framesdir> <seqdir> [fps]"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
src, dst = sys.argv[1], sys.argv[2]; fps = float(sys.argv[3]) if len(sys.argv) > 3 else 15
os.makedirs(dst, exist_ok=True)
for f in os.listdir(dst): os.remove(os.path.join(dst, f))
BAND, BG, FG = 66, (17, 24, 39), (255, 255, 255)
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 26, index=1)
meta = json.load(open(os.path.join(src, 'captions.json')))
t0 = meta['frames'][0]['ts']
frames = [(fr['ts'] - t0, fr['file']) for fr in meta['frames']]
caps = sorted([(c['at'] - t0, c['text']) for c in meta['captions']])
total = max(frames[-1][0], caps[-1][0]) + 0.3  # the recording ran until the last caption
n = int(total * fps) + 1
last_file = None; cache = None; written = 0
for k in range(n):
    t = k / fps
    file = frames[0][1]
    for ts, f in frames:
        if ts <= t + 1e-6: file = f
        else: break
    text = ''
    for ts, c in caps:
        if ts <= t + 1e-6: text = c
    key = (file, text)
    if cache is None or cache[0] != key:
        im = Image.open(file).convert('RGB'); w, h = im.size
        canvas = Image.new('RGB', (w, h + BAND), BG); canvas.paste(im, (0, 0))
        if text:
            dr = ImageDraw.Draw(canvas); tw = dr.textlength(text, font=font)
            dr.text(((w - tw) / 2, h + (BAND - 30) / 2), text, font=font, fill=FG)
        cache = (key, canvas)
    cache[1].save(os.path.join(dst, f'{k:04d}.png'), compress_level=1); written += 1
print(f'{written} frames at {fps:g} fps = {written / fps:.1f} s; captions at', [round(ts, 1) for ts, _ in caps])
