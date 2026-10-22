import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const graphPath = path.join(baseDir, 'workflows/minimax-h3-character-swap-v1.1-api.json');
const template = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
export const CHARACTER_SWAP_KEY = 'characterSwap';
export const CHARACTER_SWAP_FRAME_CAP = 360;
export const CHARACTER_SWAP_NATIVE_FPS = 24;

function uploadedFileName(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || [...value].some(char => char.charCodeAt(0) < 32)) {
    throw new Error(label + ' belum diunggah secara valid ke RunningHub.');
  }
  return value;
}

export function buildCharacterSwapWorkflow({ imageName, videoName }) {
  const reference = uploadedFileName(imageName, 'Reference image');
  const guide = uploadedFileName(videoName, 'Driving video');
  const graph = structuredClone(template);
  const planner = graph['1283'];
  if (planner?.class_type !== 'BFSShotPlanner') throw new Error('Template BFS Shot Planner tidak valid.');
  const plan = JSON.parse(planner.inputs.plan);
  plan.video = guide;
  plan.global_ref = reference;
  plan.global_refs = [reference];
  plan.global_ref2 = '';
  plan.auto_prompts = {};
  plan.ref_details = {};
  plan.picture_details = {};
  plan.mask_video = '';
  plan.fps = CHARACTER_SWAP_NATIVE_FPS;
  plan.end_f = CHARACTER_SWAP_FRAME_CAP;
  plan.second_pass = { ...plan.second_pass, enabled: false };
  plan.auto_prompt = { ...plan.auto_prompt, enabled: false };
  plan.segs = (plan.segs || []).map(segment => ({
    ...segment, refs: [], ref: '', ref2: '', prompt: '', target: '', mask: {}
  }));
  planner.inputs.plan = JSON.stringify(plan);

  // An invisible, fixed model instruction replaces manual prompts. The guide
  // and reference inputs change per request, not the instruction.
  const internalInstruction = graph['1270']?.inputs?.value;
  if (!internalInstruction?.startsWith('body_swap:')) {
    throw new Error('Instruksi internal Character Swap tidak valid.');
  }
  if (plan.global_prompt !== internalInstruction) plan.global_prompt = internalInstruction;
  planner.inputs.plan = JSON.stringify(plan);
  return {
    graph,
    nodeInfoList: [{ nodeId: '1283', fieldName: 'plan', fieldValue: planner.inputs.plan }],
    fps: CHARACTER_SWAP_NATIVE_FPS,
    frameCap: CHARACTER_SWAP_FRAME_CAP
  };
}
