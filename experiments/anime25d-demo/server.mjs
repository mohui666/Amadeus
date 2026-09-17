import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./',import.meta.url));
const routes=[['/voice/',resolve(root,'../../public/assets/voice')],['/original/',resolve(root,'../../public/assets/kurisu')],['/',root]];
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.ogg':'audio/ogg','.psd':'application/octet-stream'};
createServer(async(req,res)=>{
 try{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),[prefix,dir]=routes.find(([p])=>path.startsWith(p));
  const file=resolve(dir,path==='/'?'index.html':path.slice(prefix.length));
  if(!file.startsWith(resolve(dir)+sep)){res.writeHead(403).end();return;}
  const info=await stat(file);if(!info.isFile()){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Content-Length':info.size});
  if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
 }catch(e){res.writeHead(e.code==='ENOENT'?404:500).end(e.code==='ENOENT'?'Not found':e.message);}
}).listen(3013,'127.0.0.1',()=>console.log('Anime2.5DRig demo: http://127.0.0.1:3013/'));
