// Reuse the owner's target-FPS RIFE node in the same provider graph, before
// encoding. There is no video reload, second submission, or backend conversion.
import fs from 'node:fs';
const base=JSON.parse(fs.readFileSync(new URL('./workflows/rife60-api.json',import.meta.url)));
export const INTEGRATED_RIFE_ID='760060';
export const INTEGRATED_RIFE_WORKFLOWS=new Set(['current','motionflyHD','minimaxH3Akatz']);
export const RIFE60_EDITOR_FILENAME='VANTA_AKATZ_TURBO8_RIFE60_TIGA_FRAME_ZIP_RUNNINGHUB.json';
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isInteger(v[1]);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function withIntegratedRife60(graph){
  const final=graph?.['490'];
  if(final?.class_type!=='VHS_VideoCombine'||!edge(final.inputs.images))
    throw Error('Batch gambar final untuk RIFE tidak ditemukan.');
  if(graph[INTEGRATED_RIFE_ID]){
    if(graph[INTEGRATED_RIFE_ID].class_type==='RIFEInterpolation'&&
      same(final.inputs.images,[INTEGRATED_RIFE_ID,0])&&final.inputs.frame_rate===60)return graph;
    throw Error('ID node RIFE sudah dipakai oleh node lain.');
  }
  const original=final.inputs.images,fps=final.inputs.frame_rate;
  if(!(edge(fps)&&graph[fps[0]])&&!(Number.isFinite(fps)&&fps>0&&fps<=60))
    throw Error('FPS batch sumber RIFE belum tervalidasi.');
  const result=structuredClone(graph);
  // A small batch keeps the established RIFE recipe suitable for a worker
  // which has just generated the frames, rather than a standalone empty GPU.
  result[INTEGRATED_RIFE_ID]={...structuredClone(base['2']),inputs:{...structuredClone(base['2'].inputs),
    images:structuredClone(original),source_fps:structuredClone(fps),target_fps:60},
    _meta:{title:'RIFE · FINAL GENERATED FRAMES → 60 FPS · SAME JOB'}};
  for(const [id,node] of Object.entries(result)){
    if(node.class_type==='VHS_VideoCombine'&&same(node.inputs.images,original)){
      node.inputs.images=[INTEGRATED_RIFE_ID,0];node.inputs.frame_rate=60;
    }else if(Number(id)>=5100&&Number(id)<=5108){
      for(const [field,value] of Object.entries(node.inputs))
        if(same(value,original))node.inputs[field]=[INTEGRATED_RIFE_ID,0];
    }
  }
  return result;
}

export function integratedRifePlan(plan){
  return {...plan,outputFps:60,outputFrames:Math.floor(plan.frames/plan.fps*60),
    interpolation:{revision:'integrated-rife60-v1',node:INTEGRATED_RIFE_ID,
      sourceFps:plan.fps,targetFps:60,scale:1,singleTask:true},
    nodeClasses:{...plan.nodeClasses,[INTEGRATED_RIFE_ID]:'RIFEInterpolation'}};
}

// Keep the downloadable editor graph consistent with the website submission.
export function withIntegratedRife60Editor(source){
  const editor=structuredClone(source),nodes=new Map(editor.nodes.map(n=>[n.id,n]));
  const final=nodes.get(490),input=final?.inputs.find(i=>i.name==='images');
  const original=editor.links.find(l=>l[0]===input?.link)?.slice();
  if(!original||nodes.has(Number(INTEGRATED_RIFE_ID)))throw Error('Graf editor RIFE tidak valid.');
  const target=Number(INTEGRATED_RIFE_ID),originalRate=final.widgets_values_named?.frame_rate;
  const rateInput=final.inputs.find(i=>i.name==='frame_rate');
  const rateEdge=editor.links.find(l=>l[0]===rateInput?.link);
  if(!rateEdge&&!(Number.isFinite(originalRate)&&originalRate>0))throw Error('FPS editor tidak tersedia.');
  let next=editor.links.reduce((max,l)=>Math.max(max,l[0]),editor.last_link_id||0)+1;
  const named={...structuredClone(base['2'].inputs),source_fps:originalRate||24};delete named.images;
  const names=['source_fps','target_fps','scale','model_name','batch_size','use_fp16'];
  const n={id:target,type:'RIFEInterpolation',title:'RIFE · FINAL → 60 FPS · ONE JOB',
    pos:[(final.pos?.[0]||0)-360,(final.pos?.[1]||0)+440],size:[330,250],flags:{},mode:0,order:editor.nodes.length,
    inputs:[{name:'images',type:'IMAGE',link:null},...names.map(name=>({name,
      type:name==='model_name'?'COMBO':name==='batch_size'?'INT':name==='use_fp16'?'BOOLEAN':'FLOAT',
      widget:{name},link:null}))],outputs:[{name:'images',type:'IMAGE',links:[],slot_index:0}],
    properties:{'Node name for S&R':'RIFEInterpolation',aux_id:'GACLove/ComfyUI-VFI'},
    widgets_values:names.map(name=>named[name]),widgets_values_named:named};
  editor.nodes.push(n);nodes.set(target,n);
  const connect=(from,slot,to,inputSlot,type)=>{
    const id=next++;editor.links.push([id,from,slot,to,inputSlot,type]);
    const output=nodes.get(from).outputs[slot];(output.links||=[]).push(id);
    nodes.get(to).inputs[inputSlot].link=id;return id;
  };
  connect(original[1],original[2],target,0,'IMAGE');
  if(rateEdge)connect(rateEdge[1],rateEdge[2],target,1,'FLOAT');
  // Reuse IMAGE link IDs/backlinks at consumers; no stale or duplicate edges.
  for(const link of editor.links){
    if(link[3]===target||link[1]!==original[1]||link[2]!==original[2])continue;
    const consumer=nodes.get(link[3]);
    if(consumer.type!=='VHS_VideoCombine'&&!(consumer.id>=5100&&consumer.id<=5108))continue;
    const out=nodes.get(link[1]).outputs[link[2]];out.links=out.links.filter(id=>id!==link[0]);
    link[1]=target;link[2]=0;n.outputs[0].links.push(link[0]);
    if(consumer.type==='VHS_VideoCombine'){
      const rate=consumer.inputs.find(i=>i.name==='frame_rate');
      if(rate?.link!=null){
        const old=editor.links.find(l=>l[0]===rate.link);
        const oldOut=nodes.get(old[1]).outputs[old[2]];oldOut.links=oldOut.links.filter(id=>id!==old[0]);
        editor.links=editor.links.filter(l=>l[0]!==old[0]);rate.link=null;
      }
      consumer.widgets_values_named.frame_rate=60;
      if(Array.isArray(consumer.widgets_values))throw Error('Schema widget video editor tidak cocok.');
      consumer.widgets_values.frame_rate=60;
    }
  }
  editor.last_node_id=Math.max(editor.last_node_id||0,target);editor.last_link_id=next-1;
  editor.extra.vanta_export={...editor.extra.vanta_export,interpolation:'RIFEInterpolation',output_fps:60,single_task:true};
  return editor;
}
