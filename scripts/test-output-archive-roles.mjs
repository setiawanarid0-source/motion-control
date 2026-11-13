import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createOutputArchiveClassifier,inspectOutputArchive} from '../output-archive-roles.js';
import {selectOriginalVideoArchive,selectFrameDiagnosticArchive} from '../runninghub-output.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'output-zip-role-'));
execFileSync(process.env.VANTA_MEDIA_PYTHON||'python3',['-c',
  'import zipfile,sys,pathlib\np=pathlib.Path(sys.argv[1])\n'+
  'with zipfile.ZipFile(p/"video.zip","w") as z:\n z.comment=b"x"*60000\n with z.open("original.mp4","w",force_zip64=True) as f:f.write(b"v"*(2*1024*1024))\n'+
  'with zipfile.ZipFile(p/"frames.zip","w") as z:\n for n in range(3):z.writestr("frame-%s.png"%n,b"png-fixture")\n',dir]);
let requests=0,sent=0;
const server=http.createServer((req,res)=>{
  requests++;
  const file=req.url==='/b.zip'?'frames.zip':'video.zip',body=fs.readFileSync(path.join(dir,file));
  if(req.url==='/invalid.zip'){res.end('not-a-zip');return;}
  const range=req.headers.range;
  if(range&&req.url!=='/no-range.zip'){
    const m=/^bytes=(\d*)-(\d*)$/.exec(range);assert.ok(m);
    const start=m[1]?Number(m[1]):Math.max(0,body.length-Number(m[2]));
    const end=m[1]&&m[2]?Math.min(body.length-1,Number(m[2])):body.length-1;
    const part=body.subarray(start,end+1);sent+=part.length;
    res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':part.length});res.end(part);
  }else{sent+=body.length;res.writeHead(200,{'Content-Length':body.length});res.end(body);}
});
server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
try{
  const video={fileType:'zip',fileUrl:base+'/a.zip'},frames={fileType:'zip',fileUrl:base+'/b.zip'};
  const classify=createOutputArchiveClassifier({validUrl:url=>url.startsWith(base+'/')});
  const [a,b]=await Promise.all([classify([frames,video]),classify([video,frames])]);
  assert.equal(selectOriginalVideoArchive(a).fileUrl,video.fileUrl);
  assert.equal(selectFrameDiagnosticArchive(a).fileUrl,frames.fileUrl);
  assert.equal(selectOriginalVideoArchive(b).fileUrl,video.fileUrl);
  assert.equal(requests,2,'Concurrent output polling shares directory lookups');
  assert.ok(sent<300000,'Range-capable storage only sends ZIP directories, not the full MP4 archive');
  await classify([frames,video]);assert.equal(requests,2,'Reuse inspected output roles');
  assert.deepEqual(await inspectOutputArchive(base+'/no-range.zip'),{videos:1,pngs:0,files:1});
  await assert.rejects(inspectOutputArchive(base+'/invalid.zip'),/Direktori ZIP/);
  const before=requests;
  await classify([{...video,nodeId:'496'},{...frames,nodeId:'5108'}]);assert.equal(requests,before);
  await assert.rejects(classify([{fileType:'zip',fileUrl:'https://untrusted.example/a.zip'},frames]),/Alamat ZIP/);
  const ambiguous=createOutputArchiveClassifier({validUrl:()=>true,inspect:async()=>({videos:1,pngs:0,files:1})});
  await assert.rejects(ambiguous([video,frames]),/belum dapat dibedakan/);
  console.log('PASS: anonymous shuffled ZIPs classified by actual directory contents; range/ZIP64/comment support, full-stream fallback, shared cache, invalid archive and URL guards; no extraction or inference.');
}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
