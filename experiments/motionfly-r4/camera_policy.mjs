// R4 camera safety gate. Source and output reports are produced by camera_motion.py.
// This module never warps frames or submits a paid task.
const finite = x => typeof x === 'number' && Number.isFinite(x);
function sample(path,t){
  if(!Array.isArray(path)||!path.length)throw Error('empty camera trajectory');
  const a=path[0], last=path[path.length-1];
  if(t<=a.t)return a;
  if(t>=last.t)return last;
  let lo=0,hi=path.length-1;
  while(lo+1<hi){const m=(lo+hi)>>1;if(path[m].t<t)lo=m;else hi=m;}
  const l=path[lo],r=path[hi],f=(t-l.t)/(r.t-l.t);
  const out={};for(const k of ['dx','dy','degrees','scale'])out[k]=l[k]+f*(r[k]-l[k]);return out;
}
function safeReport(x){
  return x?.schema==='r4-camera-v1'&&Array.isArray(x.trajectory)&&x.trajectory.length>=4&&
    Array.isArray(x.work_resolution)&&x.work_resolution.length===2&&x.work_resolution.every(finite)&&
    Array.isArray(x.original_resolution)&&x.original_resolution.length===2&&x.original_resolution.every(finite)&&
    x.trajectory.every(p=>['t','dx','dy','degrees','scale'].every(k=>finite(p[k])))&&
    x.trajectory.every((p,i,a)=>i===0||p.t>a[i-1].t);
}
export function cameraDecision(source,output,{maxCorrectionPx=35,qualityRequired=.65}={}){
  const hold=(reason)=>({action:'hold',reason});
  if(!safeReport(source)||!safeReport(output))return hold('MALFORMED_REPORT');
  if(source.classification==='UNKNOWN'||output.classification==='UNKNOWN')return hold('UNCERTAIN_CAMERA');
  if(source.median_inlier_ratio<qualityRequired||output.median_inlier_ratio<qualityRequired)
    return hold('LOW_BACKGROUND_CONFIDENCE');
  if(Math.abs(source.original_resolution[0]/source.original_resolution[1] -
              output.original_resolution[0]/output.original_resolution[1])>.03)return hold('ASPECT_MISMATCH');
  const ends=[source.trajectory.at(-1).t,output.trajectory.at(-1).t];
  if(Math.abs(ends[0]-ends[1])>.40)return hold('DURATION_MISMATCH');
  const w=output.original_resolution[0],h=output.original_resolution[1];
  const work=output.work_resolution;
  let maxError=0, samples=0;
  const cap=Math.min(...ends);
  for(let t=0;t<=cap;t+=Math.max(.12,cap/70)){
    const src=source.classification==='STATIC'?{dx:0,dy:0,degrees:0,scale:1}:sample(source.trajectory,t);
    const out=sample(output.trajectory,t);
    const dx=(src.dx-out.dx)*w/work[0],dy=(src.dy-out.dy)*h/work[1];
    const rotate=(src.degrees-out.degrees)*Math.PI/180;
    const zoom=(src.scale/out.scale)-1;
    // Corner displacement bound in pixels includes scale, rotation and translation.
    const radius=Math.hypot(w,h)/2;
    const excess=Math.hypot(dx,dy)+radius*(Math.abs(rotate)+Math.abs(zoom));
    maxError=Math.max(maxError,excess);samples++;
  }
  if(maxError>maxCorrectionPx)return {action:'hold',reason:'CORRECTION_TOO_LARGE',maxEstimatedCorrectionPx:Math.round(maxError*100)/100};
  if(maxError<1.5)return {action:'pass',reason:'CAMERA_MATCH',maxEstimatedCorrectionPx:Math.round(maxError*100)/100};
  return {action:'candidate',reason:'SMALL_2D_CORRECTION',maxEstimatedCorrectionPx:Math.round(maxError*100)/100,
          note:'Needs artifact-free frame correction and post-render QA before publishing.'};
}
