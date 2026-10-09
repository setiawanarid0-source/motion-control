export const MIN_NEW_TASK_CREDITS=100;
export function canStartNewTask(status,minimum=MIN_NEW_TASK_CREDITS){
  return !!status && !status.error && Number.isFinite(Number(status.remainCoins))
    && Number(status.remainCoins)>=minimum;
}
export function isTrackableTaskCode(code,body){
  const n=Number(code);
  return n===804||n===813||n===805||(n===0&&(Array.isArray(body?.data)||body?.data!=null));
}
