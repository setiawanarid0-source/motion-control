// Editor serialization only. The paid API inference builder remains unchanged.
import fs from 'node:fs';
import {AKATZ_PROFILE,AKATZ_REVISION,akatzGraphForInputs} from './h3-akatz-motion.js';
import {h3PhotoPlan} from './minimax-h3-motion.js';

const schemas=JSON.parse(fs.readFileSync(new URL('./workflows/runninghub-akatz-node-schemas.json',import.meta.url),'utf8'));
export const AKATZ_EDITOR_FILENAME='VANTA_MINIMAX_H3_AKATZ_V8_RUNNINGHUB.json';
export const AKATZ_EDITOR_PRESET=Object.freeze({frames:360,fps:24,width:1080,height:1920});
const PHOTO='UPLOAD_PHOTO_1080x1920.png',VIDEO='UPLOAD_VIDEO_15_SECONDS.mp4';
const clone=value=>structuredClone(value);
const isLink=value=>Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1]);

function position(id){
  const special={30:[0,100],200:[420,690],490:[1020,940],493:[1020,100],494:[1020,650],496:[1400,650],1000:[420,100]};
  if(special[id])return special[id];
  if(id>=1000){const window=Math.floor((id-1000)/40),offset=(id-1000)%40;
    return [(offset%7)*410,3100+window*1400+Math.floor(offset/7)*400];}
  const globals=[1,2,3,4,6,7,8,9,31,40,41,49,50,85,86,87];
  const index=globals.indexOf(id);
  if(index<0)throw Error('Posisi node editor tidak tersedia: '+id);
  return [(index%5)*410,1400+Math.floor(index/5)*400];
}

export function akatzEditorWorkflow({characterLoraFile,turboLoraFile}){
  const source={...h3PhotoPlan(1080,1920),inferenceProfile:AKATZ_PROFILE,
    fps:24,totalFrames:360,hasAudio:true,seed:42};
  const api=akatzGraphForInputs({imageName:PHOTO,videoName:VIDEO,source,characterLoraFile,turboLoraFile});
  const coreIds=Object.keys(api);
  // A real STRING connection, not an array stored inside a filename widget.
  api['200']={class_type:'PrimitiveString',inputs:{value:VIDEO}};
  for(const [id,node] of Object.entries(api)){
    if(node.class_type==='VHS_LoadAudioUpload')node.inputs.audio=['200',0];
    if(node.class_type==='VHS_LoadVideo'&&id!=='1000')node.inputs.video=['200',0];
  }
  api['493']={class_type:'VHS_VideoCombine',inputs:{...clone(api['490'].inputs),
    filename_prefix:'VANTA-AKATZ-V8-NODE-PREVIEW',save_output:false,no_preview:false}};
  // Keep the backup's native UI output payload for RunningHub's task archive.
  // Collapse/hide its canvas preview below, rather than suppressing that payload.
  api['494']={class_type:'VHS_SelectFilename',inputs:{filenames:['493',0],index:-1}};
  api['496']={class_type:'CompressImages',inputs:{'images or video_path':['494',0],
    filename_prefix:'VANTA_AKATZ_V8_ZIP',image_format:'PNG',password:''}};

  const byId=new Map();
  for(const [id,node] of Object.entries(api)){
    const schema=schemas[node.class_type];
    if(!schema)throw Error('Schema editor tidak tersedia: '+node.class_type);
    const named=clone(schema.defaults);
    for(const [key,value] of Object.entries(node.inputs)){
      if(isLink(value))continue;
      if(key==='lora_name'&&value==='')continue; // legacy API-only empty field
      if(!Object.hasOwn(named,key))throw Error('Widget editor tidak dikenal: '+node.class_type+'.'+key);
      named[key]=value;
    }
    if(node.class_type==='VHS_VideoCombine')named.videopreview={hidden:id==='490',paused:false,params:{}};
    if(node.class_type==='VHS_LoadVideo')named.videopreview={hidden:id!=='1000',paused:false,params:{}};
    const editor={id:Number(id),type:node.class_type,pos:position(Number(id)),size:[345,280],
      flags:{},mode:0,order:byId.size,inputs:clone(schema.inputs).map(i=>({...i,link:null})),
      outputs:clone(schema.outputs).map(o=>({...o,links:[]})),properties:{'Node name for S&R':node.class_type},
      widgets_values:schema.objectWidgets?named:schema.widgetOrder.map(key=>key===null?null:named[key]),
      widgets_values_named:named};
    byId.set(id,editor);
  }
  const links=[];
  for(const [id,node] of Object.entries(api))for(const [key,value] of Object.entries(node.inputs)){
    if(!isLink(value))continue;
    const from=byId.get(value[0]),to=byId.get(id),slot=to.inputs.findIndex(i=>i.name===key);
    const output=from?.outputs[value[1]],input=to.inputs[slot];
    if(!output||!input)throw Error('Koneksi editor tidak tersedia: '+id+'.'+key);
    if(input.type!=='*'&&output.type!=='*'&&input.type!==output.type)
      throw Error('Tipe koneksi editor tidak sesuai: '+id+'.'+key);
    const linkId=links.length+1;
    links.push([linkId,from.id,value[1],to.id,slot,input.type]);
    output.links.push(linkId);input.link=linkId;
  }
  const titles={30:'1 - UPLOAD FOTO REFERENSI (1080 x 1920)',1000:'2 - UPLOAD VIDEO 15 DETIK',
    200:'3 - SALIN NAMA FILE VIDEO DARI NODE 1000 KE SINI',
    493:'493 - PREVIEW MP4 FINAL',494:'494 - PILIH MP4 FINAL TERMASUK AUDIO',
    496:'496 - ZIP VIDEO - HASIL UNDUHAN',490:'490 - CADANGAN DI DAFTAR TUGAS'};
  for(const [id,title] of Object.entries(titles))byId.get(id).title=title;
  byId.get('30').size=[370,570];byId.get('1000').size=[400,540];byId.get('200').size=[560,80];
  byId.get('493').size=[560,450];byId.get('494').size=[330,90];byId.get('496').size=[440,170];
  byId.get('490').flags.collapsed=true;
  for(const id of ['493','494','496'])Object.assign(byId.get(id),{color:'#232',bgcolor:'#353'});
  const instructions='AKATZ V8 - MP4 FINAL DALAM ZIP\n\n'+
    'Preset editor: foto 1080 x 1920, video 15 detik (360 frame / 24 FPS), dengan audio. Vanta tetap merakit durasi dan rasio input lain secara dinamis.\n\n'+
    'Tunggu editor RunningHub selesai memuat semua ekstensi sebelum mengimpor file ini.\n\n'+
    '1. Upload foto pada node 30 dan video pada node 1000.\n'+
    '2. Salin nama file video yang tampil pada node 1000 ke node 200. Node 200 benar-benar terhubung ke semua slice video berikutnya dan semua slice audio.\n'+
    '3. Gunakan Plus, lalu jalankan workflow.\n'+
    '4. Unduh VANTA_AKATZ_V8_ZIP…zip pada Daftar Tugas, lalu ekstrak MP4. Preview MP4 ada pada node 493; node 490 tetap menyimpan cadangan dengan preview disembunyikan.\n\n'+
    'ZIP mengambil file terakhir dari Video Combine, termasuk audio bila ada. Jalur ZIP hanya membungkus MP4; tidak menambah encode video, resize atau refinement. Opsi PNG milik cabang gambar pada Zip Compress, bukan format video.\n\n'+
    'Resep v8 tetap: raw AV history 5 frame, bukan v7 / 22 frame. Untuk 360 frame, keluaran terbagi 124 + 119 + 68 + 49. Model, prompt, sampling, 24 FPS, CRF 12 dan audio sumber tetap. Perbaikan tekstur detik 14–15 belum lolos uji visual.\n\n'+
    'File model berasal dari receipt unggahan Vanta. Bila tidak tersedia di akun/region RunningHub yang dipakai, pilih unggahan dari dua bobot yang sama pada loader 6 dan 7. Tidak ada model upload atau render yang dipicu oleh unduhan workflow ini.';
  const note={id:5000,type:'Note',title:'PETUNJUK AKATZ V8 + ZIP',pos:[1880,100],size:[650,1050],
    flags:{},mode:0,order:byId.size,inputs:[],outputs:[],properties:{},widgets_values:[instructions]};
  return {last_node_id:5000,last_link_id:links.length,nodes:[...byId.values(),note],links,
    groups:[{id:1,title:'INPUT REFERENSI',bounding:[-35,40,1010,790],color:'#3f789e',font_size:24,flags:{}},
      {id:2,title:'MP4 FINAL + ZIP + CADANGAN',bounding:[990,40,870,980],color:'#3f789e',font_size:24,flags:{}}],
    config:{},extra:{ds:{scale:0.52,offset:[80,0]},VHS_MetadataImage:true,VHS_KeepIntermediate:true,
      vanta_export:{source_revision:AKATZ_REVISION,source_graph_nodes:coreIds.length,
        preset:AKATZ_EDITOR_PRESET,quality_change_from_vanta_v8:false,
        visible_download_node:493,backup_node:490,zip_node:496,
        filename_transport:'typed_STRING_links',generation_executed:false,visual_acceptance:'pending_owner_test'}},version:0.4};
}

export function installAkatzEditorDownload({app,getModelFiles}){
  app.get('/api/workflows/minimaxH3Akatz/runninghub',(_req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const models=getModelFiles();
      if(!models.characterLoraFile||!models.turboLoraFile)
        return res.status(503).json({error:'Receipt kedua model Akatz belum tersedia untuk ekspor. Tidak ada model upload atau generate yang dijalankan.'});
      const workflow=akatzEditorWorkflow(models);
      res.set('Content-Type','application/json; charset=utf-8');
      res.set('Content-Disposition','attachment; filename="'+AKATZ_EDITOR_FILENAME+'"');
      res.send(JSON.stringify(workflow,null,2)+'\n');
    }catch{res.status(503).json({error:'Workflow Akatz belum dapat diekspor. Tidak ada generate yang dijalankan.'});}
  });
}
