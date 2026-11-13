// The owner's version-12 editor graph is the source of truth. Specialize its
// duration-only controls on the server; never execute absent GPU branches.
import fs from 'node:fs';
import {createHash} from 'node:crypto';

export const TURBO8_REVISION='akatz-native-1080-turbo8-template-r2';
export const TURBO8_TEMPLATE_SHA256='b3824c07c0f33c2a0df2318fd213a3debbedce480d76ab1ae4f62f9d582062c2';
export const TURBO8_EDITOR_FILENAME='VANTA_AKATZ_TURBO8_TIGA_FRAME_ZIP_R2_RUNNINGHUB.json';
export const TURBO8_ASSET=Object.freeze({
  name:'minimax_h3_fl2v_turbo_8step_v1_0_768p',
  url:'https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/a29e57d195f80ead07c89f89e55ecf2911e893c5/minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',
  sha256:'08cfe946033af7d27719b964b6e0a0e50c32138daabbd6ce4137e23df6bf9980',
  size:1956193000,
  // Published content-addressed upload recorded by the source workflow's
  // RunningHub deduplication receipt; tied to the same pinned SHA-256.
  publishedUpload:Object.freeze({name:'api-lora-usa/6f3e07a52a1ab2ce9a525c31f3157a84.safetensors',
    sha256:'08cfe946033af7d27719b964b6e0a0e50c32138daabbd6ce4137e23df6bf9980'})
});
const bytes=fs.readFileSync(new URL('./workflows/h3-akatz-turbo8-template.json',import.meta.url));
if(createHash('sha256').update(bytes).digest('hex')!==TURBO8_TEMPLATE_SHA256)
  throw Error('Berkas sumber Akatz Turbo8 tidak sesuai versi yang diperiksa.');
const template=JSON.parse(bytes);
const link=value=>Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isSafeInteger(value[1]);
const clone=structuredClone;
const lora=name=>typeof name==='string'&&/^api-lora-[a-z0-9-]+\/[a-f0-9]{32}\.safetensors$/.test(name);
const file=name=>typeof name==='string'&&name.length>0&&name.length<=500&&!/[\u0000-\u001f\\]/.test(name)&&
  !name.startsWith('/')&&!name.includes('://')&&!name.split('/').includes('..');

export function turbo8TemporalPlan(source){
  const n=source?.totalFrames;
  if(!Number.isSafeInteger(n)||n<6||n>362||source.fps!==24||typeof source.hasAudio!=='boolean')
    throw Error('Akatz Turbo8 menerima video 0,25–15 detik pada 24 FPS.');
  for(const key of ['canvasWidth','canvasHeight','outputWidth','outputHeight'])
    if(!Number.isSafeInteger(source[key])||source[key]<64||source[key]>8192)
      throw Error('Canvas Akatz Turbo8 belum tervalidasi.');
  if(Math.min(source.outputWidth,source.outputHeight)!==1080||source.canvasWidth%32||source.canvasHeight%32||
    source.outputWidth>source.canvasWidth||source.outputHeight>source.canvasHeight)
    throw Error('Ukuran native Akatz Turbo8 tidak valid.');
  for(const key of ['padLeft','padTop','referencePadRight','referencePadBottom'])
    if(!Number.isSafeInteger(source[key])||source[key]<0||source[key]>31)
      throw Error('Padding Akatz Turbo8 belum tervalidasi.');
  const window=Math.max(124,5+17*Math.ceil((n-5)/51));
  const values={300:window,301:2*window-5,350:n/24};
  const segments=[];
  for(let i=0;i<3;i++){
    const base=320+i*10,start=i?i*(window-5):0;
    const inputFrames=Math.max(1,Math.min(window,n-start));
    const frames=i?Math.max(1,inputFrames-5):inputFrames;
    Object.assign(values,{[base]:start,[base+1]:inputFrames,[base+2]:frames,
      [base+3]:inputFrames-1,[base+4]:Math.max(1,window-inputFrames),
      [base+5]:inputFrames/24,[base+6]:start/24,[base+7]:(start+5)/24,[base+8]:frames/24});
    if(i===0||n>i*window-(i-1)*5){
      const noise=template.nodes.find(x=>x.id===1009+i*40);
      segments.push({start:i?start+5:0,loadStart:start,frames,inputFrames,modelFrames:window,
        contextFrames:i?5:0,seed:noise.widgets_values_named.noise_seed,seedNode:String(1016+i*40),noiseNode:String(noise.id)});
    }
  }
  if(segments.reduce((sum,s)=>sum+s.frames,0)!==n)throw Error('Durasi keluaran Akatz Turbo8 tidak cocok dengan sumber.');
  return {window,values,segments};
}

function editorApi(){
  const links=new Map(template.links.map(x=>[x[0],x]));
  const graph={};
  for(const node of template.nodes){
    if(node.type==='Note')continue;
    const inputs=clone(node.widgets_values_named||{});
    for(const name of ['videopreview','upload','choose audio to upload','control_after_generate'])delete inputs[name];
    for(const input of node.inputs||[]){
      if(input.link==null)continue;
      const edge=links.get(input.link);
      if(!edge)throw Error('Sambungan template Akatz tidak lengkap.');
      inputs[input.name]=[String(edge[1]),edge[2]];
    }
    graph[node.id]={class_type:node.type,inputs};
  }
  return graph;
}

export function turbo8GraphForInputs({imageName,videoName,source,characterLoraFile,turboLoraFile}){
  if(!file(imageName)||!file(videoName)||!lora(characterLoraFile)||!lora(turboLoraFile))
    throw Error('Referensi atau receipt model Akatz Turbo8 belum valid.');
  const temporal=turbo8TemporalPlan(source),graph=editorApi();
  graph['30'].inputs.image=imageName;
  graph['31'].inputs.right=source.referencePadRight;graph['31'].inputs.bottom=source.referencePadBottom;
  // API-uploaded weights require RH's loader. strength_clip=0 preserves the
  // template's model-only Turbo LoRA; the CLIP conditioning stays unchanged.
  graph['6']={class_type:'RHLoraLoader',inputs:{model:['1',0],clip:['2',0],lora_name:'',
    file_name:turboLoraFile,strength_model:1,strength_clip:0}};
  graph['7'].inputs.file_name=characterLoraFile;
  graph['1000'].inputs.video=videoName;
  for(const node of Object.values(graph)){
    if(node.class_type==='MiniMaxH3ReferenceToVideo'){
      node.inputs.width=source.canvasWidth;node.inputs.height=source.canvasHeight;
      if(!source.hasAudio)for(const key of Object.keys(node.inputs))
        if(/^(ref_video_audios|ref_audios)\./.test(key))delete node.inputs[key];
    }
    if(node.class_type==='ImageCrop')Object.assign(node.inputs,{width:source.outputWidth,height:source.outputHeight,
      x:source.padLeft,y:source.padTop});
    if(node.class_type==='VHS_VideoCombine'&&!source.hasAudio)delete node.inputs.audio;
  }
  const resolve=(value,seen=new Set())=>{
    if(!link(value))return value;
    const [id,port]=value,node=graph[id];
    if(!node)throw Error('Sumber sambungan Akatz Turbo8 tidak ditemukan.');
    if(seen.has(id))throw Error('Kontrol durasi Akatz Turbo8 membentuk siklus.');
    const next=new Set(seen).add(id);
    if(Object.hasOwn(temporal.values,id))return port===0?Math.trunc(temporal.values[id]):temporal.values[id];
    if(id==='310')return source.totalFrames>temporal.window;
    if(id==='311')return source.totalFrames>2*temporal.window-5;
    if(node.class_type==='WidgetToString'){
      if(node.inputs.widget_name!=='video'||node.inputs.id!==1000)throw Error('Pengikat nama video tidak dikenal.');
      return videoName;
    }
    if(node.class_type==='LazySwitchKJ'){
      const choose=resolve(node.inputs.switch,next);
      if(typeof choose!=='boolean')throw Error('Cabang durasi Akatz belum dapat dipilih.');
      return resolve(node.inputs[choose?'on_true':'on_false'],next);
    }
    if(!source.hasAudio&&node.class_type==='MiniMaxH3AddGuide')return resolve(node.inputs.positive,next);
    return value;
  };
  for(const node of Object.values(graph))for(const [key,value] of Object.entries(node.inputs))node.inputs[key]=resolve(value);
  for(const segment of temporal.segments){
    graph[segment.seedNode]={class_type:'MathExpression|pysssss',inputs:{expression:String(segment.seed)}};
    graph[segment.noiseNode].inputs.noise_seed=[segment.seedNode,0];
  }
  const keep=new Set();
  function visit(id){
    if(keep.has(id))return;
    const node=graph[id];if(!node)throw Error('Graf Akatz Turbo8 tidak lengkap.');
    keep.add(id);for(const value of Object.values(node.inputs))if(link(value))visit(value[0]);
  }
  // Both ZIPs are outputs: one original MP4 and one batch of three PNGs.
  for(const id of ['490','493','496','5108'])visit(id);
  const result=Object.fromEntries(Object.entries(graph).filter(([id])=>keep.has(id)));
  for(const node of Object.values(result)){
    if(['WidgetToString','LazySwitchKJ','easy compare'].includes(node.class_type))
      throw Error('Kontrol editor belum diselesaikan untuk API.');
    if(!source.hasAudio&&node.class_type==='VHS_LoadAudioUpload')throw Error('Sambungan audio kosong masih aktif.');
  }
  return result;
}

export function turbo8SeedNodeInfo(source){
  return turbo8TemporalPlan(source).segments.map(s=>({nodeId:s.seedNode,fieldName:'expression',fieldValue:String(s.seed)}));
}
export function turbo8ExecutionPlan(source){
  const p=turbo8TemporalPlan(source);
  const graph=turbo8GraphForInputs({imageName:'inspection.png',videoName:'inspection.mp4',source,
    characterLoraFile:'api-lora-inspection/00000000000000000000000000000000.safetensors',
    turboLoraFile:'api-lora-inspection/11111111111111111111111111111111.safetensors'});
  return {revision:TURBO8_REVISION,inferenceProfile:source.inferenceProfile,frames:source.totalFrames,fps:24,
    templateSha256:TURBO8_TEMPLATE_SHA256,sampling:{steps:8,sampler:'er_sde',scheduler:'normal',videoShift:12,audioShift:3,
      character:'Akatz V1.5',turbo:'FL2V Turbo 8-step v1.0 768p',turboSha256:TURBO8_ASSET.sha256},
    canvas:[source.canvasWidth,source.canvasHeight],output:[source.outputWidth,source.outputHeight],
    nativeWindowFrames:p.window,samplerCount:p.segments.length,segments:p.segments,seed:p.segments[0].seed,
    seedTransport:'template_fixed_int_expression_with_api_override',
    continuation:'sampler_av_latent_tail',continuationFrames:5,continuationVaeRoundTrips:0,
    outputEncoding:{format:'video/h264-mp4',crf:12},frameDiagnostics:{zipNode:'5108',positions:['first','middle','last']},
    nodeClasses:Object.fromEntries(Object.entries(graph).map(([id,n])=>[id,n.class_type])),
    workBudget:{totalSteps:p.segments.length*8,targetSeconds:1500,providerHardLimitSeconds:2400,measuredRuntimeSeconds:null},
    postDecodeResize:false,postRefinement:false,gpuExecutionQualified:false,visualAcceptance:'pending_owner_test'};
}
export function turbo8NodeClass(id,plan){
  return plan?.revision===TURBO8_REVISION?plan.nodeClasses?.[String(id)]||null:null;
}

export function turbo8EditorWorkflow({characterLoraFile,turboLoraFile}){
  if(!lora(characterLoraFile)||!lora(turboLoraFile))throw Error('Receipt kedua model Akatz belum tersedia.');
  const editor=clone(template),nodes=new Map(editor.nodes.map(n=>[n.id,n]));
  nodes.get(7).widgets_values_named.file_name=characterLoraFile;
  const characterSchema=JSON.parse(fs.readFileSync(new URL('./workflows/runninghub-akatz-node-schemas.json',import.meta.url))).RHLoraLoader;
  const n=nodes.get(6),oldOutputs=n.outputs,oldModelLink=n.inputs.find(i=>i.name==='model').link;
  n.type='RHLoraLoader';n.title='TURBO8 - RECEIPT RUNNINGHUB';
  n.properties={'Node name for S&R':'RHLoraLoader'};
  n.inputs=clone(characterSchema.inputs).map(input=>({...input,link:null}));
  n.outputs=clone(characterSchema.outputs).map((output,i)=>({...output,links:i===0?oldOutputs[0].links:[]}));
  n.inputs.find(i=>i.name==='model').link=oldModelLink;
  const clipSlot=n.inputs.findIndex(i=>i.name==='clip'),id=editor.last_link_id+1;
  if(clipSlot<0)throw Error('Schema loader model Akatz tidak lengkap.');
  n.inputs[clipSlot].link=id;nodes.get(2).outputs[0].links.push(id);
  editor.links.push([id,2,0,6,clipSlot,'CLIP']);editor.last_link_id=id;
  n.widgets_values_named={...clone(characterSchema.defaults),file_name:turboLoraFile,strength_model:1,strength_clip:0};
  n.widgets_values=characterSchema.widgetOrder.map(key=>n.widgets_values_named[key]);
  // RH expects the widget array as well as the named values on every import.
  const c=nodes.get(7);c.widgets_values=characterSchema.widgetOrder.map(key=>c.widgets_values_named[key]??characterSchema.defaults[key]);
  editor.extra.vanta_export={...editor.extra.vanta_export,source_revision:TURBO8_REVISION,
    source_template_sha256:TURBO8_TEMPLATE_SHA256,visual_acceptance:'pending_owner_test'};
  return editor;
}
