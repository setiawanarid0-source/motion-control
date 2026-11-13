// Download the existing three-frame archive. This route cannot submit inference.
import {selectFrameDiagnosticArchive} from './runninghub-output.js';

export function installFrameDiagnostics({app,registry,getAccount,getOutputs,request,validUrl,clock=()=>Date.now()}){
  app.get('/api/tasks/:taskId/frames',async(req,res)=>{
    const id=String(req.params.taskId||''),accountId=String(req.query?.accountId||'');
    if(!/^\d{10,25}$/.test(id)||!accountId)return res.status(404).json({error:'Task tidak tersedia.'});
    const account=getAccount(req,id,accountId),task=registry.get(id);
    if(!account||!task||task.accountId!==accountId)return res.status(404).json({error:'Task tidak tersedia.'});
    if(task.status!=='success')return res.status(409).json({error:'Frame pemeriksaan belum tersedia.'});
    const finished=Date.parse(task.finishedAt||'');
    if(!Number.isFinite(finished)||clock()>=finished+72*60*60*1000)
      return res.status(410).json({error:'Masa simpan hasil sudah berakhir.'});
    let upstream;
    try{
      let url=task.frameArchiveUrl;
      if(!url){
        url=selectFrameDiagnosticArchive(await getOutputs(id,account))?.fileUrl;
        if(!url)return res.status(404).json({error:'ZIP tiga frame tidak tersedia pada hasil ini.'});
      }
      if(!validUrl(url))return res.status(502).json({error:'Alamat keluaran RunningHub tidak valid.'});
      registry.update(id,{status:'success',hasFrameDiagnostics:true,frameArchiveUrl:url});
      upstream=await request(url,{responseType:'stream',timeout:120000,maxRedirects:3,
        validateStatus:status=>status===200});
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition','attachment; filename="akatz-'+id+'-3-frame-png.zip"');
      res.setHeader('Cache-Control','private, no-store');
      if(upstream.headers?.['content-length'])res.setHeader('Content-Length',upstream.headers['content-length']);
      upstream.data.on('error',()=>{if(!res.headersSent)res.status(502).end();else res.destroy();});
      res.on('close',()=>upstream?.data?.destroy?.());
      upstream.data.pipe(res);
    }catch{upstream?.data?.destroy?.();if(!res.headersSent)res.status(502).json({error:'Unduhan frame belum tersedia. Coba kembali sebentar lagi.'});else res.destroy();}
  });
}
