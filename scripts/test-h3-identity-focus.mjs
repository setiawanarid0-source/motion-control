import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {detectIdentityFocus,identityModel,validIdentityCrop} from '../h3-identity-focus.js';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'h3-identity-test-'));
try{
  const model=await identityModel();assert.ok(model.endsWith('.onnx'));
  const corrupt=path.join(dir,'corrupt.onnx');await fs.writeFile(corrupt,'invalid');
  await assert.rejects(identityModel(corrupt),/checksum/);
  const face={x:32,y:64,width:128,height:160,confidence:.95};
  assert.ok(validIdentityCrop(face,544,928));
  for(const invalid of [null,{}, {...face,x:-1},{...face,width:31},{...face,x:600}])
    assert.ok(!validIdentityCrop(invalid,544,928));
  const original=path.join(dir,'original.jpg');await fs.writeFile(original,'untouched-original');
  const args={width:544,height:928,getModel:async()=>model,
    execute:async(_bin,argv)=>{assert.equal(argv[1],original);return {stdout:JSON.stringify({face})};}};
  assert.deepEqual(await detectIdentityFocus({path:original},args),face);
  for(const output of ['null','malformed',JSON.stringify({face:{...face,x:999}}),JSON.stringify({face:{...face,confidence:.2}})])
    assert.equal(await detectIdentityFocus({path:original},{...args,execute:async()=>({stdout:output})}),null);
  assert.equal(await detectIdentityFocus({path:original},{...args,getModel:async()=>{throw Error('unavailable');}}),null);
  assert.equal(await fs.readFile(original,'utf8'),'untouched-original');
  console.log('PASS: bundled identity detector checksum, original-photo-only crop bounds and optional failure isolation');
}finally{await fs.rm(dir,{recursive:true,force:true});}
