// Execute the supplied editor workflow with its configured single-reference
// switches. Editor-only Set/Get links are resolved without rebuilding the model.
export const MOTIONFLY_HD_ID='motionflyHD';
export const MOTIONFLY_HD_NAME='MotionFly · 1080 HD + ZIP';
export const RETIRED_R4_WORKFLOWS=new Set(['r15','koh1AntiObject','r4Lab']);

export function compileMotionFlyHD(editor){
  const nodes=new Map(editor.nodes.map(node=>[String(node.id),node]));
  const links=new Map(editor.links.map(link=>[link[0],link]));
  const setters=new Map(editor.nodes.filter(node=>node.type==='SetNode').map(node=>[node.widgets_values[0],node]));
  const graph={},visiting=new Set();
  const edge=input=>{
    const link=links.get(input?.link);
    if(!link)throw Error('MotionFly: sambungan tidak ditemukan.');
    return resolve(String(link[1]),link[2]);
  };
  function resolve(id,slot=0){
    const node=nodes.get(id);
    if(!node||node.mode===2)throw Error('MotionFly: node input tidak tersedia: '+id);
    if(node.type==='GetNode'){
      const set=setters.get(node.widgets_values[0]);
      if(!set)throw Error('MotionFly: referensi tidak ditemukan.');
      return edge(set.inputs[0]);
    }
    if(node.type==='SetNode')return edge(node.inputs[0]);
    if(node.type==='PrimitiveBoolean'||node.type==='easy int')return node.widgets_values[0];
    if(node.type==='ComfySwitchNode'){
      const select=node.inputs.find(input=>input.name==='switch');
      const value=select?.link!=null?edge(select):node.widgets_values[0];
      if(typeof value!=='boolean')throw Error('MotionFly: nilai sakelar belum pasti.');
      return edge(node.inputs.find(input=>input.name===(value?'on_true':'on_false')));
    }
    if(node.mode===4){
      const type=node.outputs?.[slot]?.type;
      const input=node.inputs.find(item=>item.link!=null&&(item.type===type||type==='*'));
      if(!input)throw Error('MotionFly: cabang nonaktif tidak memiliki input: '+id);
      return edge(input);
    }
    emit(id);return [id,slot];
  }
  function emit(id){
    if(graph[id])return;
    if(visiting.has(id))throw Error('MotionFly: sambungan melingkar.');
    visiting.add(id);
    const node=nodes.get(id),inputs={};
    if(!node||node.mode||['GetNode','SetNode','Note','Fast Groups Bypasser (rgthree)'].includes(node.type))
      throw Error('MotionFly: node editor tidak dapat dieksekusi: '+id);
    const widgets=node.widgets_values;
    if(widgets&&!Array.isArray(widgets)){
      for(const [key,value]of Object.entries(widgets))
        if(!['videopreview','choose video to upload'].includes(key))inputs[key]=structuredClone(value);
    }else if(Array.isArray(widgets)){
      const values=node.type==='KSampler'?widgets.filter((_,index)=>index!==1):widgets;
      const fields=(node.inputs||[]).filter(input=>input.widget);
      fields.forEach((input,index)=>{
        if(input.type!=='IMAGEUPLOAD'&&index<values.length)inputs[input.name]=values[index];
      });
    }
    if(node.type==='VHS_SelectFilename')inputs.index=widgets[0];
    for(const input of node.inputs||[])if(input.link!=null)inputs[input.name]=edge(input);
    graph[id]={class_type:node.type,inputs};
    visiting.delete(id);
  }
  // Final HD, saved backup, and ZIP. Disconnected diagnostic previews and the
  // disabled multi-photo branches do not change these outputs.
  for(const root of ['490','493','496'])emit(root);
  if(graph['30']?.class_type!=='LoadImage'||graph['33']?.class_type!=='VHS_LoadVideo')
    throw Error('MotionFly: input foto/video tidak cocok.');
  return graph;
}
