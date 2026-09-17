"""Prepare imagegen layers: background alpha, uniform alignment, and PSD preview.

No facial feature is drawn or locally stretched by this script. Layer separation
is intentional for this Live2D authoring experiment, not sprite frame compositing.
"""
from pathlib import Path
import json
import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SIZE = (940, 1674)
SOURCE = HERE / 'sources'
OUTPUT = HERE / 'layers'
OUTPUT.mkdir(exist_ok=True)
reference = np.asarray(Image.open(ROOT / 'public/assets/kurisu/kurisu_normal1.png').convert('RGBA').resize(SIZE, Image.Resampling.LANCZOS))
spoken = np.asarray(Image.open(ROOT / 'public/assets/kurisu/kurisu_normal3.png').convert('RGBA').resize(SIZE, Image.Resampling.LANCZOS))
sift = cv2.SIFT_create(nfeatures=4000)

def cutout(rgba, name):
    rgb = rgba[:, :, :3].astype(np.int16)
    colored = np.uint8((rgb.max(2) - rgb.min(2) > 14) | (rgb.min(2) < 180)) * 255
    colored = cv2.morphologyEx(colored, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    alpha = np.zeros(colored.shape, np.uint8)
    if name == 'body':
        # The pale coat reaches the bottom edge: close the complete outside
        # silhouette row by row, as in the existing portrait cutout workflow.
        for y, row in enumerate(colored):
            xs = np.flatnonzero(row)
            if len(xs):
                alpha[y, xs[0]:xs[-1]+1] = 255
    else:
        contours, _ = cv2.findContours(colored, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = max(contours, key=cv2.contourArea)
        cv2.drawContours(alpha, [contour], -1, 255, cv2.FILLED)
    rgba[:, :, 3] = cv2.GaussianBlur(alpha, (3, 3), .4)
    return rgba

def align_large(rgba, name):
    mask = np.uint8(reference[:, :, 3] > 240) * 255
    mask = cv2.erode(mask, np.ones((15, 15), np.uint8))
    if name == 'head':
        mask[900:, :] = 0
        mask[350:750, 260:720] = 0
    else:
        mask[:800, :] = 0
        mask[800:1280, 570:810] = 0
    ref_keys, ref_desc = sift.detectAndCompute(cv2.cvtColor(reference[:, :, :3], cv2.COLOR_RGB2GRAY), mask)
    keys, desc = sift.detectAndCompute(cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2GRAY), rgba[:, :, 3])
    matches = [a for a, b in cv2.BFMatcher().knnMatch(desc, ref_desc, k=2) if a.distance < .7 * b.distance]
    src = np.array([keys[m.queryIdx].pt for m in matches])
    dst = np.array([ref_keys[m.trainIdx].pt for m in matches])
    best = np.zeros(len(src), bool)
    rng = np.random.default_rng(5)
    for _ in range(800):
        i, j = rng.choice(len(src), 2, replace=False)
        delta = src[j] - src[i]
        if np.linalg.norm(delta) < 60:
            continue
        scale = np.dot(delta, dst[j] - dst[i]) / np.dot(delta, delta)
        shift = dst[i] - scale * src[i]
        inliers = np.linalg.norm(src * scale + shift - dst, axis=1) < 3
        if inliers.sum() > best.sum():
            best = inliers
    assert best.sum() >= 10, (name, 'Insufficient alignment anchors', int(best.sum()))
    a, b = src[best], dst[best]
    ac, bc = a.mean(0), b.mean(0)
    scale = np.sum((a-ac)*(b-bc)) / np.sum((a-ac)**2)
    shift = bc - scale * ac
    return float(scale), shift.tolist(), int(best.sum())

def align_feature(rgba, name):
    # Match extracted parts to their original eye/mouth areas using only the part alpha.
    target = spoken if name == 'mouth' else reference
    regions = {'eye-left': (265, 380, 430, 510), 'eye-right': (505, 380, 685, 510), 'mouth': (425, 585, 515, 675)}
    x0, y0, x1, y1 = regions[name]
    search = target[y0:y1, x0:x1, :3]
    ys, xs = np.where(rgba[:, :, 3] > 200)
    bx, by, bw, bh = xs.min(), ys.min(), xs.max()-xs.min()+1, ys.max()-ys.min()+1
    part = rgba[by:by+bh, bx:bx+bw]
    best = None
    for scale in np.linspace(.5, 1.4, 91):
        size = (round(bw*scale), round(bh*scale))
        if size[0] >= search.shape[1] or size[1] >= search.shape[0]:
            continue
        sample = cv2.resize(part, size, interpolation=cv2.INTER_AREA)
        mask = np.uint8(sample[:, :, 3] > 230) * 255
        match = cv2.matchTemplate(search, sample[:, :, :3], cv2.TM_SQDIFF_NORMED, mask=mask)
        score, _, position, _ = cv2.minMaxLoc(match)
        if best is None or score < best[0]:
            best = (score, scale, position)
    score, scale, (px, py) = best
    return float(scale), [float(x0+px-bx*scale), float(y0+py-by*scale)], round(float(score), 4)

layers = []
report = []
for name in ['body', 'head', 'eye-left', 'eye-right', 'mouth']:
    source_name = 'head-corrected.png' if name == 'head' else f'{name}-generated.png'
    rgba = cutout(np.asarray(Image.open(SOURCE / source_name).convert('RGBA')).copy(), name)
    scale, shift, evidence = align_large(rgba, name) if name in ['head', 'body'] else align_feature(rgba, name)
    matrix = np.float32([[scale, 0, shift[0]], [0, scale, shift[1]]])
    aligned = cv2.warpAffine(rgba, matrix, SIZE, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT)
    Image.fromarray(aligned).save(OUTPUT / f'{name}.png')
    layers.append(Image.fromarray(aligned))
    report.append(dict(name=name, scale=scale, translation=shift, alignmentEvidence=evidence))
    print(report[-1])

preview = Image.new('RGBA', SIZE)
for layer in layers:
    preview = Image.alpha_composite(preview, layer)
preview.save(HERE / 'assembled-preview.png')
background = Image.new('RGBA', SIZE, '#233033')
comparison = Image.new('RGB', (SIZE[0]*3, SIZE[1]), '#233033')
original = Image.alpha_composite(background, Image.fromarray(spoken))
assembled = Image.alpha_composite(background, preview)
comparison.paste(original, (0, 0))
comparison.paste(assembled, (SIZE[0], 0))
comparison.paste(Image.blend(original, assembled, .5), (SIZE[0]*2, 0))
comparison.resize((1410, 837), Image.Resampling.LANCZOS).save(HERE / 'alignment-review.png')
(HERE / 'alignment.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
