import assert from 'node:assert/strict';
import {canStartNewTask,isTrackableTaskCode} from '../account-eligibility.js';
for(const [s,expected] of [[{remainCoins:500},true],[{remainCoins:99},false],[{remainCoins:100},true],[{error:'offline'},false],[null,false]])
  assert.equal(canStartNewTask(s),expected);
for(const [c,d,e] of [[804,{},true],[813,{},true],[805,{},true],[0,{data:[]},true],[802,{},false],[0,{data:null},false]])
  assert.equal(isTrackableTaskCode(c,d),e);
console.log('PASS: low-credit accounts remain trackable, cannot start new jobs; recover rejects unauthorized keys.');
