const isVideo=output=>/video|mp4/i.test(String(output?.fileType||''))||
  /\.mp4(?:\?|$)/i.test(String(output?.fileUrl||''));
const isZip=output=>/^(?:application\/)?(?:x-)?zip(?:-compressed)?$/i.test(String(output?.fileType||''))||
  /\.zip(?:\?|$)/i.test(String(output?.fileUrl||''));
const frameZip=output=>String(output?.nodeId)==='5108'||
  /VANTA_AKATZ_3_FRAME_PNG/i.test(String(output?.fileUrl||'')+' '+String(output?.filename||output?.fileName||''));
export function selectFrameDiagnosticArchive(outputs){
  return Array.isArray(outputs)?outputs.find(x=>isZip(x)&&frameZip(x)):undefined;
}

// Web history may omit nodeId entirely. ZIP export is the original file;
// the separately listed MP4 is only a provider preview/backup.
export function selectOriginalVideoArchive(outputs){
  if(!Array.isArray(outputs))return undefined;
  const archives=outputs.filter(x=>isZip(x)&&!frameZip(x));
  const preferred=archives.find(x=>String(x.nodeId)==='496');
  if(preferred)return preferred;
  if(archives.length===1)return archives[0];
  if(archives.length>1)throw Error('RunningHub mengembalikan beberapa ZIP; video asli belum dapat dipastikan.');
}

// Reuse the proven export chain without changing sampling, frames, audio,
// resolution, FPS or the existing saved backup. Historical builders stay intact.
export function withOriginalVideoArchive(graph){
  if(Object.values(graph).some(n=>n?.class_type==='CompressImages'))return graph;
  const final=graph['490']?.class_type==='VHS_VideoCombine'?'490':
    graph['3']?.class_type==='VHS_VideoCombine'?'3':null;
  if(!final)throw Error('Node video final workflow tidak ditemukan.');
  const result=structuredClone(graph);
  let base=900001;while([base,base+1,base+2].some(id=>result[String(id)]))base+=3;
  const prefix='VANTA_ORIGINAL_'+String(result[final].inputs.filename_prefix||'video');
  result[base]={class_type:'VHS_VideoCombine',inputs:{...structuredClone(result[final].inputs),
    filename_prefix:prefix,save_output:false,no_preview:false}};
  result[base+1]={class_type:'VHS_SelectFilename',inputs:{filenames:[String(base),0],index:-1}};
  result[base+2]={class_type:'CompressImages',inputs:{'images or video_path':[String(base+1),0],
    filename_prefix:prefix+'_ZIP',image_format:'PNG',password:''}};
  return result;
}

// Diagnostic clips can finish before the final render. Prefer the graph's
// established final-video nodes, independently of provider response order.
export function selectFinalVideoOutput(outputs){
  if(!Array.isArray(outputs))return undefined;
  for(const id of ['490','393']){
    const output=outputs.find(x=>String(x?.nodeId)===id&&isVideo(x));
    if(output)return output;
  }
  return outputs.find(isVideo);
}
