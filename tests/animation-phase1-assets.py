"""Inspect whole-frame alignment/alpha and create review sheets; never edit asset pixels."""
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results/animation-phase1'
OUT.mkdir(parents=True, exist_ok=True)
frames = {}
reference_alpha = np.asarray(Image.open(ROOT / 'public/assets/kurisu/kurisu_normal1.png').convert('RGBA'))[:, :, 3]
for eye in ('open', 'half', 'closed'):
    for mouth in (1, 2, 3):
        path = ROOT / (f'public/assets/kurisu/kurisu_normal{mouth}.png' if eye == 'open'
                       else f'public/assets/kurisu/animation-phase1/{eye}{mouth}.png')
        im = Image.open(path).convert('RGBA')
        assert im.size == (1213, 2160), path
        alpha = np.asarray(im)[:, :, 3]
        assert alpha[:200, :80].max() == 0, f'Background remains: {path}'
        for corner in (slice(0, 20), slice(-20, None)):
            coat = reference_alpha[-20:, corner] > 250
            assert alpha[-20:, corner][coat].mean() > 250, f'Coat corner missing: {path}'
        frames[f'{eye}{mouth}'] = im

def opaque(im):
    return Image.alpha_composite(Image.new('RGBA', im.size, '#182629'), im).convert('RGB')

sheet = Image.new('RGB', (1080, 1320), '#182629')
for row, eye in enumerate(('open', 'half', 'closed')):
    for col, mouth in enumerate((1, 2, 3)):
        name = f'{eye}{mouth}'
        face = opaque(frames[name]).crop((225, 360, 990, 1220)).resize((360, 405), Image.Resampling.LANCZOS)
        sheet.paste(face, (col * 360, row * 440 + 30))
        ImageDraw.Draw(sheet).text((col * 360 + 12, row * 440 + 9), name, fill='#e5c995')
sheet.save(OUT / 'frames.png')

pairs = [(f'{a}{mouth}', f'{b}{mouth}') for mouth in (1, 2, 3) for a, b in [('open', 'half'), ('half', 'closed')]]
pairs += [(f'{eye}{mouth}', f'{eye}{mouth+1}') for eye in ('half', 'closed') for mouth in (1, 2)]
sheet = Image.new('RGB', (1250, 960), '#182629')
for i, (a, b) in enumerate(pairs):
    overlap = Image.blend(opaque(frames[a]), opaque(frames[b]), .5).resize((250, 445), Image.Resampling.LANCZOS)
    x, y = (i % 5) * 250, (i // 5) * 480
    sheet.paste(overlap, (x, y + 30))
    ImageDraw.Draw(sheet).text((x + 8, y + 9), f'{a} / {b} 50%', fill='#e5c995')
sheet.save(OUT / 'adjacent-overlay.png')

# Review broad, unchanged hair/coat colors. Expression regions are excluded.
reference = np.asarray(frames['open1'])
mask = reference[:, :, 3] > 250
mask[:35] = False
mask[420:930, 260:950] = False
for name, im in frames.items():
    if name.startswith('open'):
        continue
    rgba = np.asarray(im)
    valid = mask & (rgba[:, :, 3] > 250)
    delta = np.asarray(rgba[:, :, :3], dtype=float) - reference[:, :, :3]
    print(name, 'mean RGB shift outside expression:', np.round(delta[valid].mean(0), 2).tolist())
print('PASS 9 frame sizes/backgrounds/coat corners; review sheets created')
