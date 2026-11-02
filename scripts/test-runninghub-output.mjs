import assert from 'node:assert/strict';
import {selectFinalVideoOutput} from '../runninghub-output.js';

const crop={nodeId:494,fileType:'mp4',fileUrl:'https://example.test/face-qa.mp4'};
const render={nodeId:'490',fileType:'mp4',fileUrl:'https://example.test/native-render.mp4?signature=fixture'};
const mask={nodeId:'493',fileType:'png',fileUrl:'https://example.test/pose.png'};
assert.equal(selectFinalVideoOutput([crop,mask,render]),render,'A face-only QA clip must never replace the final render');
assert.equal(selectFinalVideoOutput([render,crop,mask]),render);
const legacy={nodeId:'393',fileType:'video',fileUrl:'https://example.test/legacy'};
assert.equal(selectFinalVideoOutput([mask,crop,legacy]),legacy);
assert.equal(selectFinalVideoOutput([mask,crop]),crop,'Other video workflows keep their existing fallback');
assert.equal(selectFinalVideoOutput([mask]),undefined);
assert.equal(selectFinalVideoOutput(null),undefined);
console.log('PASS: final native render selection across provider output order, diagnostic clips and legacy output nodes');
