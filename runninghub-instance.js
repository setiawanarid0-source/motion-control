// RunningHub API instanceType mapping. Historical Lite jobs may finish normally,
// but new user submissions expose Standard and Plus only.
export const RUNNINGHUB_NEW_MODES=Object.freeze(['standard','plus']);
export function runningHubInstanceType(mode){
  if(mode==='standard')return 'default'; // 24 GB
  if(mode==='plus')return 'plus'; // 48 GB
  if(mode==='lite')return null; // read-only compatibility for previously queued tasks
  throw Error('Tipe mesin RunningHub tidak dikenali.');
}
export function canSubmitMachineMode(mode){return RUNNINGHUB_NEW_MODES.includes(mode);}
