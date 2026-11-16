import fs from 'node:fs';

// The web editor's workflowContent and executable prompt are different formats.
// Serialize the actual submitted graph, using inspected native ports/layouts.
// This never changes the executable prompt or selects a different recipe.
const schemas=JSON.parse(fs.readFileSync(new URL('./workflows/runninghub-web-node-schemas.json',import.meta.url),'utf8')).nodes;
const clone=structuredClone;
const edge=value=>Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isSafeInteger(value[1]);
const fail=message=>Object.assign(new Error(message),{code:'RH_WEB_INVALID_GRAPH',definitelyRejected:true});
const compatible=(a,b)=>a==='*'||b==='*'||a===b||String(a).split(',').includes(b)||String(b).split(',').includes(a);

export function runningHubWorkflowContent(graph){
  if(!graph||typeof graph!=='object'||Array.isArray(graph)||!Object.keys(graph).length)
    throw fail('Graf workflow kosong atau tidak valid. Task belum dikirim.');
  const nodes=new Map();
  for(const [id,api] of Object.entries(graph)){
    if(!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||!api?.inputs||typeof api.inputs!=='object'||Array.isArray(api.inputs))
      throw fail('ID atau input node workflow tidak valid: '+id);
    const schema=schemas[api.class_type];
    if(!schema)throw fail('Layout editor RunningHub belum tersedia untuk node '+api.class_type+'.');
    const named={},ports=clone(schema.inputs).map(input=>({...input,link:null}));
    for(const [name,value] of Object.entries(api.inputs)){
      if(edge(value)){
        if(!ports.some(input=>input.name===name))throw fail('Port editor tidak tersedia: '+id+'.'+name);
      }else named[name]=clone(value);
    }
    // VHS persists named widgets, including its selected video-format fields.
    // Other nodes retain native widget order and fixed seed-control widgets.
    const values=[];
    for(const name of schema.widgetOrder){
      if(name&&Object.entries(schema.dynamicChoices||{}).some(([selector,choices])=>
        name.startsWith(selector+'.')&&!choices[api.inputs[selector]]?.includes(name)))continue;
      values.push(name===null?null:clone(named[name]??schema.defaults[name]??null));
      if(schema.controls?.[name])values.push(schema.controls[name]);
    }
    const index=nodes.size;
    nodes.set(id,{id:Number(id),type:api.class_type,pos:[index%6*400,Math.floor(index/6)*340],
      size:[350,280],flags:{},mode:0,order:index,inputs:ports,
      outputs:clone(schema.outputs).map((output,slot)=>({...output,slot_index:slot,links:[]})),
      properties:{'Node name for S&R':api.class_type},
      widgets_values:schema.objectWidgets?clone(named):values,widgets_values_named:named,
      ...(api._meta?.title?{title:api._meta.title}:{})});
  }
  const links=[];
  for(const [id,api] of Object.entries(graph))for(const [name,value] of Object.entries(api.inputs)){
    if(!edge(value))continue;
    const from=nodes.get(value[0]),to=nodes.get(id),slot=to.inputs.findIndex(input=>input.name===name);
    const input=to.inputs[slot],output=from?.outputs[value[1]];
    if(!input||!output||!compatible(input.type,output.type))
      throw fail('Sambungan editor RunningHub tidak cocok: '+id+'.'+name);
    const linkId=links.length+1;
    links.push([linkId,from.id,value[1],to.id,slot,input.type]);
    input.link=linkId;output.links.push(linkId);
  }
  return JSON.stringify({last_node_id:Math.max(...[...nodes.values()].map(node=>node.id)),last_link_id:links.length,
    nodes:[...nodes.values()],links,groups:[],config:{},extra:{ds:{scale:1,offset:[0,0]}},version:0.4});
}
