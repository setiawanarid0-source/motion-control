// Read-only compatibility for videos cached by the superseded website converter.
// New tasks are delivered directly from RunningHub's native 40 FPS workflows.
import fs from 'node:fs';
import path from 'node:path';
const ROOT=path.join(process.env.VANTA_DATA_DIR||'/data','final-40fps');
const TASK_ID=/^\d{10,25}$/;
export function readLegacyFinal40(taskId){
  if(!TASK_ID.test(String(taskId||'')))return null;
  const cached=path.join(ROOT,String(taskId),'result.mp4');
  try{return fs.statSync(cached).size>1000?cached:null;}catch{return null;}
}
