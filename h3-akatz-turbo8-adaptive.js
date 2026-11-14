import fs from 'node:fs';
import {prepareH3Input} from './minimax-h3-motion.js';
import {AKATZ_PROFILE} from './h3-akatz-motion.js';
const clone=structuredClone;
const edge=v=>Array.isArray(v)&&v.length===2&&typeof v[0]==='string'&&Number.isSafeInteger(v[1]);

export function prepareTurbo8Input(video,mode,image){
  return prepareH3Input(video,mode,image,{inferenceProfile:AKATZ_PROFILE,identityFocus:false,nativeDriver:true,
    maxSeconds:null,maxGuideBytes:null,detectScenes:false});
}

// Extend the reviewed third continuation block, retaining raw five-frame AV
// latent history. Long inputs never increase a sampler's native 124-frame window.
export function extendTurbo8Graph(prototype,source,plan){
  const g=clone(prototype),loader=clone(g['1000']),third=Object.entries(g)
    .filter(([id])=>Number(id)>=1080&&Number(id)<1120);
  const p=plan.segments,offsetIds=new Set(third.map(([id])=>id));
  for(let i=3;i<p.length;i++){
    const base=p[i].base;
    for(const [old,node] of third){
      const n=clone(node);
      for(const [key,value] of Object.entries(n.inputs))if(edge(value)&&offsetIds.has(value[0]))
        n.inputs[key]=[String(base+Number(value[0])-1080),value[1]];
      g[base+Number(old)-1080]=n;
    }
  }
  for(let i=0;i<p.length;i++){
    const s=p[i],b=s.base;
    if(i===0){g['1000'].inputs.frame_load_cap=s.inputFrames;}
    else{
      g[b]=clone(loader);
      Object.assign(g[b].inputs,{skip_first_frames:s.loadStart,frame_load_cap:s.inputFrames});
      Object.assign(g[b+1].inputs,{batch_index:s.inputFrames-1});
      g[b+2].inputs.amount=Math.max(1,plan.window-s.inputFrames);
      g[b+7].inputs.context_latent=[String(p[i-1].base+11),0];
    }
    if(g[b+4])Object.assign(g[b+4].inputs,{start_time:s.loadStart/24,duration:s.inputFrames/24});
    if(g[b+17])Object.assign(g[b+17].inputs,{start_time:s.start/24,duration:s.frames/24});
    Object.assign(g[b+14].inputs,{batch_index:s.contextFrames,length:s.frames});
    g[s.seedNode].inputs.expression=String(s.seed);
  }
  if(g['50'])g['50'].inputs.duration=source.totalFrames/24;
  // Balanced joins keep concatenation depth small and preserve exact ordering.
  let next=p.reduce((max,s)=>Math.max(max,s.base+39),5108)+1;
  const reserved=new Set([760060,900001,900002,900003]);
  const allocate=()=>{while(g[next]||reserved.has(next))next++;return String(next++);};
  function join(items,root=false){
    if(items.length===1)return items[0];
    const mid=Math.floor(items.length/2),a=join(items.slice(0,mid)),b=join(items.slice(mid));
    const id=root?'49':allocate();g[id]={class_type:'ImageBatch',inputs:{image1:[a,0],image2:[b,0]}};return id;
  }
  join(p.map(s=>String(s.base+15)),true);
  const keep=new Set(),pending=['490','493','496','5108'];
  while(pending.length){
    const id=pending.pop();if(keep.has(id))continue;
    const node=g[id];if(!node)throw Error('Segmen Akatz kehilangan sambungan: '+id);
    keep.add(id);for(const v of Object.values(node.inputs))if(edge(v))pending.push(v[0]);
  }
  return Object.fromEntries(Object.entries(g).filter(([id])=>keep.has(id)));
}

// A long editor export is compiled for the selected source duration. Its node
// ports/widgets come from the same reviewed template and inspected RH schemas.
export function serializeTurbo8Editor(api,blueprint,source,additionalSchemas={}){
  const schemas={...JSON.parse(fs.readFileSync(new URL('./workflows/runninghub-akatz-node-schemas.json',import.meta.url))),...additionalSchemas};
  const original=new Map(blueprint.nodes.map(n=>[String(n.id),n])),nodes=new Map();
  for(const [id,n] of Object.entries(api)){
    const exact=original.get(id);let proto=exact?.type===n.class_type?exact:blueprint.nodes.find(x=>x.type===n.class_type);
    if(!proto&&additionalSchemas[n.class_type]){
      const s=additionalSchemas[n.class_type];
      proto={id:0,type:n.class_type,pos:[0,0],size:[350,300],flags:{},mode:0,order:0,
        inputs:clone(s.inputs),outputs:clone(s.outputs),properties:{'Node name for S&R':n.class_type},
        widgets_values:s.widgetOrder.map(k=>s.defaults[k]),widgets_values_named:clone(s.defaults)};
    }
    if(!proto)throw Error('Schema editor Akatz tidak tersedia: '+n.class_type);
    const node=clone(proto);node.id=Number(id);node.mode=0;node.order=nodes.size;
    node.inputs=(node.inputs||[]).map(x=>({...x,link:null}));
    for(const [name,value] of Object.entries(n.inputs))if(edge(value)&&!node.inputs.some(x=>x.name===name)){
      const port=schemas[n.class_type]?.inputs.find(x=>x.name===name);
      if(!port)throw Error('Input editor Akatz tidak tersedia: '+id+'.'+name);
      node.inputs.push({...clone(port),link:null});
    }
    node.outputs=(node.outputs||[]).map(x=>({...x,links:[]}));
    const named={...clone(proto.widgets_values_named||{})};
    for(const [key,value] of Object.entries(n.inputs))if(!edge(value)&&!(key==='lora_name'&&value===''))named[key]=clone(value);
    node.widgets_values_named=named;
    if(Array.isArray(proto.widgets_values)){
      const order=schemas[n.class_type]?.widgetOrder||Object.keys(proto.widgets_values_named||{});
      node.widgets_values=order.map((key,i)=>key===null?proto.widgets_values[i]:named[key]);
    }else node.widgets_values=clone(named);
    if(n.class_type==='VHS_VideoCombine'){
      node.widgets_values_named.videopreview={hidden:id==='490',paused:false,params:{}};
      if(!Array.isArray(node.widgets_values))node.widgets_values.videopreview=node.widgets_values_named.videopreview;
    }
    if(Number(id)>=10000)node.pos=[(Number(id)%40%5)*390,9000+Math.floor((Number(id)-10000)/40)*1700+Math.floor(Number(id)%40/5)*300];
    nodes.set(id,node);
  }
  const links=[];
  for(const [id,n] of Object.entries(api))for(const [name,value] of Object.entries(n.inputs)){
    if(!edge(value))continue;
    const from=nodes.get(value[0]),to=nodes.get(id),slot=to.inputs.findIndex(x=>x.name===name);
    if(!from?.outputs[value[1]]||slot<0)throw Error('Port editor Akatz tidak cocok: '+id+'.'+name);
    const input=to.inputs[slot],output=from.outputs[value[1]];
    if(input.type!=='*'&&output.type!=='*'&&input.type!==output.type&&
      !(typeof input.type==='string'&&input.type.split(',').includes(output.type)))
      throw Error('Tipe editor Akatz tidak cocok: '+id+'.'+name);
    const number=links.length+1;links.push([number,from.id,value[1],to.id,slot,input.type]);
    input.link=number;output.links.push(number);
  }
  return {...clone(blueprint),nodes:[...nodes.values()],links,last_node_id:[...nodes.values()].reduce((max,n)=>Math.max(max,n.id),0),last_link_id:links.length,
    extra:{...clone(blueprint.extra),vanta_export:{...clone(blueprint.extra.vanta_export),
      duration_strategy:'compiled_for_selected_video',preset_frames:source.totalFrames,preset_seconds:source.totalFrames/24,
      generation_window_frames:124,continuation_frames:5,automatic_window_count:true}}};
}
