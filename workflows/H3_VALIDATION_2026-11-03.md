# Native H3 regression checks — 3 November 2026

## Release decision

No replacement has passed the complete visual contract yet. Ordinary generation
still selects `guide-dmad4-character-caption`, revision
`motion-transfer-native-1080-v6`. Its reported visual defects remain unresolved.
Do not describe the private candidates or passing application checks as a
completed production fix.

The private face128 comparison was deployed from
`e9050ad1659fa0e8a4c6495858146e2ed2d6b2b7`, Railway deployment
`ad3d992d-d68a-4035-b35f-fda9bc530f47`, observed `SUCCESS` at
2026-11-03T06:28:59.952Z. All required pre-deployment application checks passed.

## Input and acceptance contract

- The current native photo supplies identity, hair, body proportions, clothes,
  visible accessories, materials, setting and illumination.
- The driving video supplies the motion and performance timeline. Full RGB
  performer/body/scene frames must not reach the appearance conditioning path.
- The exported short edge is 1080 pixels, sampled at the final canvas. No output
  resize, refinement, grading, interpolation or beautification is used.
- All 361 real frames of the 15.041667-second, 24 FPS test must be exported once.
  A single 362-frame native model shot repeats only the final padding frame and
  removes it on export. This test does not validate longer-window joins.
- The runtime target is 25 minutes from provider submission to ready, including
  queueing, rather than sampling time alone.
- Review the entire result and native wrist, face and garment crops. The
  200-pixel contact sheets previously hid an unwanted silver wristwatch.
- The changed-photo fixture has pink hair, glasses and black gloves. Preserving
  those accessories is separate from matching the source performance.

The checked native portrait is 1143×2048. It is not the unrecovered 1536×2752
upload from reported task `2117176682029084674`; neither its runtime nor its
pixels should be represented as a re-render of that exact upload.

## Completed comparisons before face128

| Candidate / task | Provider / submission-to-ready | Result |
| --- | --- | --- |
| Reported v6 / `2117176682029084674` | 1916 s / 1950.873 s | Source scrunchie; ceiling jumps at frames 124 and 243; appearance drift |
| Windowed face4 / `2117267691572387841` | 1407 s / 1616.450 s | Four independent windows, visible exposure and material drift; over target |
| Global4 / `2117280220814069761` | 972 s / 991.224 s | Single native shot removes window boundaries; unrequested silver watch by the opening seconds; rejected |
| Dense-opening global4 / `2117292765385940993` | 1061 s / 1089.548 s | Short screen had bare wrists, but full result has a silver watch at frame 48 / 2 s; rejected |

All full-length candidates in this table export 1080×1936, 24 FPS, 361 frames.
The dense-opening full result's fixed ceiling ROI changes by at most 0.997934
8-bit gray levels between adjacent frames, but rises from 41.0651 to 48.1395
over the shot. This supports removal of the earlier abrupt window-boundary
jumps, not a claim of constant illumination. Fabric and necklace detail remain
re-synthesized. Bone retargeting does not prove preservation of 3D body volume.

The saved photo inventory for the dense-opening run explicitly describes bare
wrists; it does not mention a watch. The 361 tight source-face crops also do
not show that watch. These checks do not establish which model prior or
conditioning interaction invented it.

## Face128 comparison in progress

The only graph change from dense-opening global4 is a 128×128 input face crop
instead of 256×256, with matching strict frame-count/dimension checks. Every
source frame, the whole native photo, caption, pose, seed, sampling schedule,
output dimensions and sparse-attention schedule remain unchanged. Reducing
this input reference quarters its spatial latent positions; whether that
improves appearance isolation is a hypothesis requiring actual video review.

| Case | Provider task | Acceptance time UTC | Status |
| --- | --- | --- | --- |
| Native gray portrait, complete 15 s | `2117504600521400322` | 2026-11-03T06:30:12.940Z | Running; no quality decision |
| Changed portrait, first 3.5 s | `2117504677084225537` | 2026-11-03T06:30:31.344Z | Complete; accessories retained, expression timing failed |

The changed-portrait result has 84 frames at 1080×1842 / 24 FPS, with an actual
84-frame 128×128 facial guide. Provider execution is 208 seconds and observed
submission-to-ready is 230.907 seconds. All 84 frames were inspected, with
native head/glove crops at frames 0, 48 and 83. Glasses, pink hair and black
gloves remain, but the source's early one-eye wink is absent and the generated
mouth begins open while the source mouth is closed. It is not a performance
acceptance pass. The inventory also labels the visible brown skirt black;
generated inventory text is fallible even though the native photo is still fed.

A follow-up `native-fun-global4-face128-keypoints` comparison is prepared,
not yet submitted. It changes only node 68 to draw the aligned source facial
and mouth landmarks alongside the existing body/hand pose. The current face128
graph had those landmarks disabled and relied on the video-reference lane for
facial acting. Case `native-facepose128-reference3-v1` is a new permanent
once-only checkpoint; the existing face128 cases and their graphs are unchanged.
The full-length follow-up case must wait for the changed-portrait screen.

The preceding 3.5-second changed-photo warmup test retained glasses and gloves,
but began from the photo's three-quarter pose before turning toward the source
pose. Exact initial pose and expression timing therefore remain acceptance
items, even if an accessory test passes.

## Source review and implementation checks

- [Native ComfyUI H3 nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py):
  AddGuide encodes RGB appearance; ReferenceToVideo video references also carry
  appearance information. Tight crops reduce the exposed area, not guarantee
  appearance isolation. Native reference inputs have no separate image/video
  strength control.
- [Hugging Face community multishot settings](https://huggingface.co/joeygambino/MiniMax-H3-Multishot-Workflow/blob/main/SETTINGS.md):
  its reference-video lane explicitly supplies scene/appearance, and its own
  single-shot setting is 362 frames. It is not evidence of a validated Vanta
  motion-only path. Its output normalization/upscale stages do not satisfy
  Vanta's native-output contract and were not copied.
- [Alibaba-PAI ControlNet Union 2.0](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0/blob/main/README.md):
  the author's examples use 40 steps and a different control checkpoint/config.
  They do not validate the available Vanta four-step/Union-v1 combination or
  establish its speed. No unverified checkpoint/config substitution was made.
- Omitted and explicit default profiles now produce identical execution-plan
  metadata. A mid-node progress-socket disconnect is marked partial rather
  than a completed sampler measurement.
- Normal requests omit private pose, source-face and inventory exports.
  Checksummed fixed cases and permanent once-only checkpoints prevent duplicate
  paid submissions. Diagnostic access uses an expiring credential; close the
  deployment gates after testing.

Validation evidence is separate from acceptance: targeted graph, provider seed,
frame-count, timing and private-route checks passed, as did Railway's full
`npm run check`. None of those checks judges generated appearance.
