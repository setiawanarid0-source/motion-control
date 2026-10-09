import assert from 'node:assert/strict';
import {cameraDecision} from './camera_policy.mjs';
function report(type,shift=0){return {schema:'r4-camera-v1',classification:type,median_inlier_ratio:.95,original_resolution:[360,640],work_resolution:[360,640],trajectory:Array.from({length:24},(_,i)=>({t:i/10,dx:shift*i/23,dy:0,degrees:0,scale:1}))};}
assert.equal(cameraDecision(report('STATIC'),report('MOVING',20)).action,'candidate');
assert.equal(cameraDecision(report('STATIC'),report('MOVING',0)).action,'pass');
assert.equal(cameraDecision(report('MOVING',20),report('MOVING',20)).action,'pass');
assert.equal(cameraDecision(report('STATIC'),report('MOVING',160)).reason,'CORRECTION_TOO_LARGE');
assert.equal(cameraDecision(report('UNKNOWN'),report('MOVING',20)).reason,'UNCERTAIN_CAMERA');
const unstable=report('STATIC');unstable.median_inlier_ratio=.3;
assert.equal(cameraDecision(unstable,report('STATIC')).reason,'LOW_BACKGROUND_CONFIDENCE');
const bad=report('MOVING');bad.trajectory[5].dx=NaN;
assert.equal(cameraDecision(bad,report('STATIC')).reason,'MALFORMED_REPORT');
console.log('PASS: camera QA policy tests (static, moving, mismatch, limits, unknown, low confidence).');
