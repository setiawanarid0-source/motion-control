// Review candidate only. Production does not import this module, and this
// module cannot upload models, contact RunningHub, or submit a task.
// Keep the accepted Akatz appearance/performance recipe; replace only the
// completed-clip relay with core H3 context fusion inside one sampling run.
import {akatzGraphForInputs,AKATZ_PROFILE,AKATZ_REVISION,AKATZ_SAMPLING} from './h3-akatz-motion.js';
import {h3ModelFrames} from './minimax-h3-motion.js';

export const H3_CONTEXT_CANDIDATE='akatz-native-context-candidate-20261104';
export const H3_CONTEXT_REQUIREMENT=Object.freeze({
  node:'MiniMaxH3ContextWindows',
  coreCommit:'6651247a8b50cefd1436c834f704bdf7767722e9',
  contextLength:124,contextOverlap:39,fuseMethod:'pyramid',
  // Leave noise unchanged so this candidate isolates the temporal mechanism.
  freenoise:false,splitConditions:false
});

export function buildAkatzContextCandidate(args){
  // The production builder validates inputs, native photo geometry, allowed
  // duration and model receipts. Reuse its first-window template and models;
  // there are no new model downloads or hidden fallback recipes here.
  const baseline=akatzGraphForInputs(args);
  const {source}=args,frames=source.totalFrames,modelFrames=h3ModelFrames(frames);
  const graph=Object.fromEntries(Object.entries(baseline).filter(([id])=>
    id!=='49'&&Number(id)<1040));
  const inputs=id=>graph[String(id)].inputs;
  inputs(1000).frame_load_cap=frames;
  inputs(1000).skip_first_frames=0;
  // Discard the template's padding and create just the full clip's grid tail.
  for(const id of [1001,1002,1003])delete graph[String(id)];
  let driver=['1000',0];
  if(modelFrames>frames){
    graph['1001']={class_type:'ImageFromBatch',inputs:{image:driver,batch_index:frames-1,length:1}};
    graph['1002']={class_type:'RepeatImageBatch',inputs:{image:['1001',0],amount:modelFrames-frames}};
    graph['1003']={class_type:'ImageBatch',inputs:{image1:driver,image2:['1002',0]}};
    driver=['1003',0];
  }
  inputs(1005).length=modelFrames;
  inputs(1005)['ref_videos.ref_video_1']=driver;
  inputs(1014).batch_index=0;
  inputs(1014).length=frames;
  if(source.hasAudio){
    for(const id of [50,1004]){
      inputs(id).start_time=0;
      inputs(id).duration=frames/24;
    }
  }
  const windowed=modelFrames>H3_CONTEXT_REQUIREMENT.contextLength;
  if(windowed){
    graph['12']={class_type:H3_CONTEXT_REQUIREMENT.node,inputs:{
      model:['8',0],context_length:H3_CONTEXT_REQUIREMENT.contextLength,
      context_overlap:H3_CONTEXT_REQUIREMENT.contextOverlap,
      fuse_method:H3_CONTEXT_REQUIREMENT.fuseMethod,
      freenoise:H3_CONTEXT_REQUIREMENT.freenoise,
      split_conds_to_windows:H3_CONTEXT_REQUIREMENT.splitConditions
    }};
    // Both must use the same patched model; no sampler may bypass the node.
    inputs(41).model=['12',0];
    inputs(1010).model=['12',0];
  }
  inputs(490).images=['1015',0];
  inputs(490).filename_prefix='VANTA-H3-AKATZ-CONTEXT-CANDIDATE';
  return {graph,plan:{
    revision:H3_CONTEXT_CANDIDATE,baselineRevision:AKATZ_REVISION,
    inferenceProfile:AKATZ_PROFILE,productionEnabled:false,submissionReady:false,
    frames,modelFrames,gridTailFrames:modelFrames-frames,fps:24,
    canvas:[source.canvasWidth,source.canvasHeight],
    output:[source.outputWidth,source.outputHeight],
    sampling:{...AKATZ_SAMPLING},samplerCount:1,decodeCount:1,
    temporalMechanism:windowed?'joint_context_fusion_per_denoising_step':'single_native_window',
    context:windowed?{...H3_CONTEXT_REQUIREMENT}:null,
    generatedHistoryFrames:0,originalPhotoThroughout:true,
    sourceReferenceFrames:modelFrames,
    // Only target windows are bounded; the full reference and final decode
    // still require memory. Four scheduler steps are not four model calls.
    workBudget:{schedulerSteps:AKATZ_SAMPLING.steps,modelCalls:null,
      measuredRuntimeSeconds:null,measuredPeakMemory:null,
      targetSeconds:1500,providerHardLimitSeconds:2400},
    sourceAudioRetained:source.hasAudio,postDecodeResize:false,postRefinement:false,
    blockers:['worker_core_and_node_compatibility','complete_visual_and_runtime_qualification'],
    visualAcceptance:'not_rendered'
  }};
}
