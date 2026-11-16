// Retired experiments may still occur in old browser requests and frozen
// History records. Keep their identifiers readable, but never generate them.
export const AKATZ_RETIRED_FLAGS=Object.freeze(['akatzExpression','akatzFaceControl','akatzSubjectMask']);
export const AKATZ_RETIRED_REVISIONS=Object.freeze([
  'akatz-native-1080-turbo8-expression-v1',
  'akatz-native-1080-turbo8-expression-v2-framealigned',
  'akatz-native-1080-turbo8-face-controlnet-v1',
  'akatz-native-1080-turbo8-subject-mask-v1',
  'akatz-native-1080-turbo8-subject-mask-memory-v2'
]);
export function assertAkatzBaseline(options={}){
  if(AKATZ_RETIRED_FLAGS.some(key=>options[key]===true||options[key]==='true'))
    throw Object.assign(new Error('Workflow percobaan Akatz ini sudah dihapus karena gagal diuji. Muat ulang Vanta dan gunakan Versi dasar Akatz.'),
      {code:'AKATZ_VARIANT_RETIRED',statusCode:410,definitelyRejected:true});
}
export function parseAkatzOptions(_workflow,options={}){
  for(const key of AKATZ_RETIRED_FLAGS){
    if(options[key]!=null&&options[key]!==''&&!['true','false'].includes(options[key]))
      throw Object.assign(new Error('Pilihan workflow Akatz tidak valid.'),{statusCode:400,definitelyRejected:true});
  }
  assertAkatzBaseline(options);
  return {akatzExpression:false,akatzFaceControl:false,akatzSubjectMask:false};
}
