// Isolated review candidate. No server import, upload or provider submission.
// Adds one 17-frame cycle of REAL history to window 3 only. It is a hypothesis
// about residual appearance drift, not a visually qualified production fix.
import {akatzGraphForInputs,akatzExecutionPlan,AKATZ_REVISION} from './h3-akatz-motion.js';

export const H3_TAIL_CONTEXT_CANDIDATE='akatz-tail-context22-candidate-20261104';
export function buildAkatzTailContextCandidate(args){
  if(AKATZ_REVISION!=='akatz-native-1080-v6')throw Error('Review this candidate against the new baseline first.');
  const graph=akatzGraphForInputs(args),baseline=akatzExecutionPlan(args.source);
  const segments=baseline.segments.map(s=>({...s})),applied=segments.length===3;
  if(applied){
    const i=2,b=1000+i*40,s=segments[i],extra=17;
    s.contextFrames+=extra;s.inputFrames+=extra;s.modelFrames+=extra;s.loadStart-=extra;
    // Native phase is unchanged: every added cycle is 17 pixel / 5 latent frames.
    // Predecessor 2 is full of real input, so its 22-frame tail contains no pad.
    const input=offset=>graph[String(b+offset)].inputs;
    input(0).skip_first_frames=s.loadStart;input(0).frame_load_cap=s.inputFrames;
    if(graph[String(b+1)])input(1).batch_index=s.inputFrames-1;
    input(5).length=s.modelFrames;
    input(7).context_length=String(s.contextFrames);
    input(14).batch_index=s.contextFrames;
    if(args.source.hasAudio){
      input(4).start_time=s.loadStart/24;input(4).duration=s.inputFrames/24;
      input(8).frame_idx=s.contextFrames;
      // The new-frame audio guide (b+17) and final source mux are unchanged.
    }
    graph['490'].inputs.filename_prefix+='-TAIL-CONTEXT22-CANDIDATE';
  }
  return {graph,plan:{...baseline,revision:H3_TAIL_CONTEXT_CANDIDATE,
    baselineRevision:baseline.revision,productionEnabled:false,submissionReady:false,applied,
    segments,continuationFrames:applied?null:baseline.continuationFrames,
    continuationFramesPerWindow:segments.map(s=>s.contextFrames),
    peakWindowFrames:Math.max(...segments.map(s=>s.modelFrames)),
    workBudget:{...baseline.workBudget,
      baselineModelFrames:baseline.segments.reduce((n,s)=>n+s.modelFrames,0),
      candidateModelFrames:segments.reduce((n,s)=>n+s.modelFrames,0),
      measuredPeakMemory:null,measuredRuntimeSeconds:null},
    visualAcceptance:'not_rendered',
    blockers:applied?['plus_141_frame_memory_runtime','paired_complete_visual_comparison']:[],
    sourceEvidenceTask:'2117928878505025537'
  }};
}

// One review task can produce a true paired comparison: the first two sampled
// latents and decoded exports are shared, with two alternative final windows.
// This costs four samplers (16 steps), not two full three-sampler renders.
// Deliberately not connected to any production submission route.
export function buildAkatzTailPairedComparison(args){
  const baseline=akatzGraphForInputs(args),candidate=buildAkatzTailContextCandidate(args);
  if(!candidate.plan.applied)throw Error('Paired tail comparison requires a three-window source.');
  const graph=structuredClone(baseline);
  const shared=new Set(['1089','1096','1097']);
  const remap=id=>Number(id)>=1080&&Number(id)<1120&&!shared.has(id)?String(Number(id)+1000):id;
  for(const [id,n] of Object.entries(candidate.graph)){
    if(Number(id)<1080||Number(id)>=1120||shared.has(id))continue;
    const copy=structuredClone(n);
    for(const [key,v] of Object.entries(copy.inputs))
      if(Array.isArray(v)&&typeof v[0]==='string')copy.inputs[key]=[remap(v[0]),v[1]];
    graph[remap(id)]=copy;
  }
  graph['2049']=structuredClone(candidate.graph['49']);
  graph['2049'].inputs.image_3=['2095',0];
  graph['2490']=structuredClone(candidate.graph['490']);
  graph['2490'].inputs.images=['2049',0];
  graph['490'].inputs.filename_prefix+='-BASELINE-V6-COMPARISON';
  return {graph,plan:{revision:H3_TAIL_CONTEXT_CANDIDATE+'-paired',
    baselineRevision:AKATZ_REVISION,productionEnabled:false,submissionReady:false,
    outputCount:2,samplerCount:4,totalSteps:16,sharedOutputFrames:243,
    peakWindowFrames:candidate.plan.peakWindowFrames,
    baselineOutput:'490',candidateOutput:'2490',
    measuredRuntimeSeconds:null,visualAcceptance:'not_rendered',
    blockers:['explicit_paid_comparison_authorization','plus_141_frame_memory_runtime',
      'paired_complete_visual_comparison']}};
}

