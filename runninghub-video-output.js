// RunningHub removed VHS_VideoCombine's Filenames port. VideoCombineV2 is
// registered with that port and retains the VHS encoder and format options.
// Only encoders with downstream file consumers need to migrate.
export const RH_VIDEO_OUTPUT_NODE='VideoCombineV2';
const edge=value=>Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]);
const invalid=()=>Object.assign(new Error('Sambungan keluaran video tidak valid. Task belum dikirim.'),
  {code:'RH_WEB_INVALID_GRAPH',definitelyRejected:true});

export function withRunningHubVideoOutputs(graph){
  const sources=new Set();
  for(const node of Object.values(graph))for(const value of Object.values(node.inputs||{})){
    if(!edge(value)||graph[value[0]]?.class_type!=='VHS_VideoCombine')continue;
    if(value[1]!==0)throw invalid();
    sources.add(value[0]);
  }
  if(!sources.size)return graph;
  const result=structuredClone(graph);
  for(const id of sources)result[id].class_type=RH_VIDEO_OUTPUT_NODE;
  return result;
}

export function withRunningHubVideoOutputsEditor(source){
  const editor=structuredClone(source),outgoing=new Map();
  for(const link of editor.links||[]){
    const id=String(link[1]);
    if(!outgoing.has(id))outgoing.set(id,[]);
    outgoing.get(id).push(link);
  }
  for(const node of editor.nodes||[]){
    if(node.type!=='VHS_VideoCombine')continue;
    const links=outgoing.get(String(node.id))||[];
    if(!links.length){node.outputs=[];continue;}
    if(links.some(link=>link[2]!==0))throw invalid();
    node.type=RH_VIDEO_OUTPUT_NODE;
    node.properties={...node.properties,'Node name for S&R':RH_VIDEO_OUTPUT_NODE};
    // These installation identifiers belonged to the original VHS extension.
    for(const name of ['cnr_id','ver','aux_id'])delete node.properties[name];
  }
  return editor;
}
