import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from '../../../.local/live2d/authoring/node_modules/pngjs/lib/png.js';
import { writePsdBuffer, readPsd } from '../../../.local/live2d/authoring/node_modules/ag-psd/dist/index.js';
const here = fileURLToPath(new URL('./', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(here + 'layers.json'));
const read = path => PNG.sync.read(fs.readFileSync(here + path));
const imageData = p => ({width:p.width,height:p.height,data:new Uint8ClampedArray(p.data)});
const composite=read('assembled-preview.png');
const children=manifest.layers.map(name=>{
  const full=read(`layers/${name}.png`);
  let left=full.width,top=full.height,right=0,bottom=0;
  for(let y=0;y<full.height;y++) for(let x=0;x<full.width;x++) {
    if(full.data[(y*full.width+x)*4+3]) {
      left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);
    }
  }
  const cropped=new PNG({width:right-left,height:bottom-top});
  PNG.bitblt(full,cropped,left,top,cropped.width,cropped.height,0,0);
  return {name,top,left,opacity:name.startsWith('EyeLower')?.22:1,hidden:false,imageData:imageData(cropped)};
});
const psd={width:composite.width,height:composite.height,imageData:imageData(composite),children};
const bytes=writePsdBuffer(psd,{generateThumbnail:false});
fs.writeFileSync(here+'Kurisu-fine.psd',bytes);
const check=readPsd(bytes,{skipLayerImageData:true,skipCompositeImageData:true,skipThumbnail:true});
console.log(JSON.stringify({width:check.width,height:check.height,layers:check.children.map(l=>l.name),bytes:bytes.length}));
