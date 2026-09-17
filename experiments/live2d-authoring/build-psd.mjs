import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from '../../.local/live2d/authoring/node_modules/pngjs/lib/png.js';
import { writePsdBuffer, readPsd } from '../../.local/live2d/authoring/node_modules/ag-psd/dist/index.js';

const here = fileURLToPath(new URL('./', import.meta.url));
const names = ['body', 'head', 'eye-left', 'eye-right', 'mouth'];
const read = path => PNG.sync.read(fs.readFileSync(here + path));
const imageData = png => ({ width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) });
const composite = read('assembled-preview.png');
const psd = {
  width: composite.width, height: composite.height,
  imageData: imageData(composite),
  children: names.map(name => ({ name, top: 0, left: 0, imageData: imageData(read(`layers/${name}.png`)) })),
};
const bytes = writePsdBuffer(psd, { generateThumbnail: false });
fs.writeFileSync(here + 'Kurisu-original-v1.psd', bytes);
const check = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
console.log(JSON.stringify({ width: check.width, height: check.height, layers: check.children.map(layer => layer.name), bytes: bytes.length }));
