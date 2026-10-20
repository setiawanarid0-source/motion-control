// RunningHub explicit task-create rejection. Never treat transport errors or
// missing acknowledgements as definitive: those might already be paid jobs.
const CAPACITY_CODE='RUNNINGHUB_QUEUE_MAXED';
export function explicitQueueMaxed(response){
  if(!response||typeof response!=='object')return false;
  const message=[response.msg,response.message,response.data?.message,response.data?.error]
    .filter(x=>typeof x==='string').join(' ');
  return /(?:^|\W)TASK_QUEUE_MAXED(?:\W|$)/i.test(message);
}
export function queueCapacityError(){
  const error=new Error('Antrean task akun RunningHub penuh (TASK_QUEUE_MAXED).');
  error.code=CAPACITY_CODE;
  error.definitelyRejected=true;
  return error;
}
export function isDefinitelyRejectedAtCapacity(error){
  return error?.code===CAPACITY_CODE&&error?.definitelyRejected===true;
}
export function mayTryNextAccountAfterCreate({error,selectedAccount,attemptedCreate}){
  return selectedAccount==='auto'&&
    (isDefinitelyRejectedAtCapacity(error)||attemptedCreate!==true);
}
