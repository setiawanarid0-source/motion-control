const isVideo=output=>/video|mp4/i.test(String(output?.fileType||''))||
  /\.mp4(?:\?|$)/i.test(String(output?.fileUrl||''));

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
