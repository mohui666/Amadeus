"""Align complete imagegen portraits to the original using hair/clothing overlap.

Only background alpha, uniform scale, translation and color tone are changed. No face,
mouth, hair or body compositing. Input manifest records each generator output.
"""
from pathlib import Path
import argparse
import json
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest', default='docs/expression-original-prompts.json')
parser.add_argument('--output', default='public/assets/kurisu/expressions-v3')
parser.add_argument('--report-prefix', default='test-results/expression')
args = parser.parse_args()
OUTPUT = ROOT / args.output
OUTPUT.mkdir(parents=True, exist_ok=True)
manifest = json.loads((ROOT / args.manifest).read_text(encoding='utf-8'))
report_prefix = ROOT / args.report_prefix
report_prefix.parent.mkdir(parents=True, exist_ok=True)
reference = Image.open(ROOT / 'public/assets/kurisu/kurisu_normal1.png').convert('RGBA')
small = reference.resize((940, 1674), Image.Resampling.LANCZOS)
ref_gray = cv2.cvtColor(np.asarray(small)[:, :, :3], cv2.COLOR_RGB2GRAY)
feature_mask = np.uint8(np.asarray(small)[:, :, 3] > 240) * 255
feature_mask = cv2.erode(feature_mask, np.ones((15, 15), np.uint8))
feature_mask[300:770, 230:730] = 0  # Expressions are not alignment anchors.
sift = cv2.SIFT_create(nfeatures=2500)
ref_keys, ref_desc = sift.detectAndCompute(ref_gray, feature_mask)
ref_rgba = np.asarray(reference)
ref_lab = cv2.cvtColor(ref_rgba[:, :, :3].astype(np.float32) / 255, cv2.COLOR_RGB2LAB)

def match_tone(rgba):
    """Match broad lighting/color to the original, preserving drawn features."""
    lab = cv2.cvtColor(rgba[:, :, :3].astype(np.float32) / 255, cv2.COLOR_RGB2LAB)
    mask = np.float32((rgba[:, :, 3] > 240) & (ref_rgba[:, :, 3] > 240))
    mask = cv2.erode(mask, np.ones((31, 31), np.uint8))
    # Different eyes/mouth are intentional: they must not influence exposure.
    mask[430:680, 300:890] = 0
    mask[770:885, 500:705] = 0
    weights = cv2.GaussianBlur(mask, (0, 0), 60)
    difference = cv2.GaussianBlur((ref_lab - lab) * mask[:, :, None], (0, 0), 60)
    correction = np.divide(difference, weights[:, :, None], out=np.zeros_like(difference), where=weights[:, :, None] > .001)
    lab += correction
    lab[:, :, 0] = np.clip(lab[:, :, 0], 0, 100)
    rgb = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
    corrected = rgba.copy()
    corrected[:, :, :3] = np.uint8(np.clip(np.rint(rgb * 255), 0, 255))
    return corrected

def cutout(image):
    rgba = np.asarray(image.convert('RGBA')).copy()
    if rgba[:, :, 3].min() < 255:
        return rgba
    rgb = rgba[:, :, :3].astype(np.int16)
    dark_background = np.median(rgb[:100, :40]) < 40
    contour = rgb.max(2) > 40 if dark_background else ((rgb.max(2) - rgb.min(2) > 12) | (rgb.min(2) < 185))
    # Ignore disconnected generator border marks before finding the portrait outline.
    _, labels, stats, _ = cv2.connectedComponentsWithStats(np.uint8(contour), connectivity=8)
    contour = labels == (1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    alpha = np.zeros(contour.shape, np.uint8)
    # Preserve every pixel inside the complete outer outline, including white fabric.
    for y, row in enumerate(contour):
        xs = np.flatnonzero(row)
        if len(xs):
            alpha[y, xs[0]:xs[-1] + 1] = 255
    rgba[:, :, 3] = alpha
    return rgba

report = []
for item in manifest['frames']:
    source = Image.open(ROOT / item['source'])
    gray = cv2.cvtColor(np.asarray(source.convert('RGB')), cv2.COLOR_RGB2GRAY)
    keys, desc = sift.detectAndCompute(gray, None)
    matches = [a for a, b in cv2.BFMatcher().knnMatch(desc, ref_desc, k=2) if a.distance < .7 * b.distance]
    src = np.array([keys[m.queryIdx].pt for m in matches])
    dst = np.array([ref_keys[m.trainIdx].pt for m in matches])
    # Robustly fit only s*x+tx, s*y+ty. Rotation/shear are not parameters.
    rng = np.random.default_rng(8)
    best = np.zeros(len(src), bool)
    for _ in range(500):
        i, j = rng.choice(len(src), 2, replace=False)
        delta = src[j] - src[i]
        if np.linalg.norm(delta) < 100:
            continue
        scale = np.dot(delta, dst[j] - dst[i]) / np.dot(delta, delta)
        shift = dst[i] - scale * src[i]
        inliers = np.linalg.norm(src * scale + shift - dst, axis=1) < 3
        if inliers.sum() > best.sum():
            best = inliers
    assert best.sum() >= 12, f'Insufficient stable hair/clothing matches: {item["name"]}'
    a, b = src[best], dst[best]
    ac, bc = a.mean(0), b.mean(0)
    scale = np.sum((a-ac)*(b-bc)) / np.sum((a-ac)**2)
    # Keep the complete coat across the bottom edge after overlap alignment.
    rgba = cutout(source)
    bottom = np.flatnonzero(rgba[-1, :, 3] > 240)
    assert len(bottom), f'Generated coat does not reach bottom: {item["name"]}'
    scale = max(scale, bc[1]/ac[1], (1675-bc[1])/(source.height-ac[1]),
                bc[0]/(ac[0]-bottom[0]), (940-bc[0])/(bottom[-1]-ac[0]))
    shift = bc - scale * ac
    factor = 1213 / 940
    matrix = np.float32([[scale*factor, 0, shift[0]*factor], [0, scale*factor, shift[1]*factor]])
    result = cv2.warpAffine(rgba, matrix, (1213, 2160), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
    result = match_tone(result)
    image = Image.fromarray(result)
    image.save(OUTPUT / f'{item["name"]}.png', optimize=True)
    residual = np.linalg.norm(a*scale+shift-b, axis=1)
    report.append({'frame':item['name'], 'matches':int(best.sum()), 'scale':float(matrix[0,0]), 'translation':[float(matrix[0,2]),float(matrix[1,2])], 'medianResidualAt940':round(float(np.median(residual)),2)})
    print(report[-1])

# Full-portrait comparison against the original at 50% opacity.
board = Image.new('RGB', (1120, ((len(manifest['frames']) + 3) // 4) * 535), '#192026')
for i, item in enumerate(manifest['frames']):
    frame = Image.open(OUTPUT / f'{item["name"]}.png').convert('RGBA')
    base = Image.new('RGBA', reference.size, '#192026')
    left = Image.alpha_composite(base, reference)
    right = Image.alpha_composite(base, frame)
    overlay = Image.blend(left, right, .5).resize((280, 499), Image.Resampling.LANCZOS)
    x, y = (i % 4)*280, (i // 4)*535
    board.paste(overlay, (x, y+25))
    ImageDraw.Draw(board).text((x+8,y+7), item['name']+' / original 50%', fill='white')
board.save(f'{report_prefix}-original-overlay.png')
Path(f'{report_prefix}-alignment.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
