# Review of the remaining H3 tail texture variation — 4 November 2026

## Observed output

The owner reports that v6 now looks good overall, with a smaller residual
texture change around 14 seconds. This is an accepted improvement baseline,
not another complete failure.

The inspected attachment is 361 frames at 24 fps, 1080 x 1936, duration
15.041667 seconds, SHA-256
`6a2da3630b349063f1947dc14fb6ec20b14091ffa4e22c52d659a924dc7168ac`.
Its embedded provenance identifies task `2117928878505025537`.
The actual embedded graph contains two Motion Context nodes, using the previous
sampler's AV latent directly. There is no generated-RGB image guide or refine.

Full-frame 2 fps contact sheets and native-resolution crops at frames
300/312/324/330/336/342/348/354/360 were inspected. The residual is a small
change in the rendering of fine skin/hair detail while head angle, expression
and arm occlusion also change. It is not a gross identity replacement.
Those moving-image observations do not establish a unique numerical texture
loss or prove that the same skin patch is uniformly blurred.

The source task's actual archived photo and video previews were also inspected.
They are the matching task references, not a guessed older pair. The video
preview is 576px wide and compressed by the archive pipeline; it is useful
for motion/occlusion timing, not a pixel-quality ground truth. The photo was
archived as a 1280px preview. No private media bytes are committed here.

The registry identifies v6 and the expected source/photo geometry. The provider
reports 1588 seconds of execution (26m28s). This already exceeds the 25-minute
target; an additional-context variant must be timed rather than presented as
a free performance improvement.

## What the graph establishes

| Export | Frames | Source load | Context |
| --- | --- | --- | --- |
| Window 1 | 0–123 | 0–123 | none |
| Window 2 | 124–242 | 119–242 | 5 raw frames |
| Window 3 | 243–360 | 238–360 plus 1 tail pad | 5 raw frames |

The joins occur at 5.1667 and 10.125 seconds. Frame 336 at 14 seconds is
93 delivered frames into the third window. Therefore a new window boundary at
14 seconds is not the explanation. The raw continuation wiring is really
present in the generated file, not only in the deployed source.

The original photo still enters all three native reference nodes. Published
Motion Context implementations at v0.3.1 and current main preserve native
reference blocks when adding history/audio. The installed worker's precise
implementation has not been read; there is no evidence yet that it drops the
photo. Do not claim that as the diagnosed cause.

H3's own model smoothing, limited history, motion/lighting changes and decoder
behavior remain possible contributors. Increasing CRF, changing seeds, adding
a hard last-photo-frame anchor, or changing the accepted global recipe is not
justified by this evidence. Publisher suggestions involving refinement or
post-decode matching are excluded by the owner's constraints.

## Concrete candidate, kept outside production

`h3-akatz-tail-candidate.js` adds one native 17-frame cycle of real history
to window 3 only. Context grows from 5 to 22 frames, the publisher's suggested
starting length. It is a testable hypothesis about remaining continuation
drift, not proof that history length caused this clip's symptom.

For this 361-frame input:
- Windows 1 and 2 are byte-identical to v6.
- Window 3 loads 221–360 (140 real frames), pads once to native 141, carries
  the previous sampler's last 22 frames and exports its same 118 new frames.
- The source VAE's 17-frame phase stays aligned. No fake future motion or
  additional padding is introduced.
- Models, prompts, original photo, native canvas/crop, original source audio,
  seed mechanism and four-step scheduler stay unchanged.
- Normal candidate generation remains three samplers / 12 steps. The peak
  window rises from 124 to 141; aggregate model-frame count rises from 372 to
  389. This is more work despite the unchanged step count. Plus memory and
  runtime are unqualified.

## Controlled visual comparison

The paired builder shares the first two samplers and their decoded exports,
then branches into a v6 final window and a 22-frame-history final window.
Both complete outputs therefore share exactly the same first 243 generated
frames and the same raw predecessor latent. This avoids asking the owner to
compare two wholly regenerated baselines.

The final noise provider object is also shared, but different target shapes
consume noise differently; do not call the final windows pixel-identical noise
controls. Two complete outputs are written in one graph, with four samplers /
16 total scheduler steps. This is an explicit diagnostic exception to the
ordinary 12-step production budget, not a silent production change.

No server route imports either builder. No provider task, model upload or
deployment was performed for this review. Paid comparison requires owner
authorization. Even successful compatibility checks would not prove the visual
result. Keep v6 active unless the candidate visibly improves the tail without
regressing motion, expression, texture elsewhere, seams or runtime.

## Executed checks

714 duration/audio candidate cases pass: identical early windows, exact
source-time coverage, real aligned raw history, no extra padding, retained
original photo/audio and no extra production sampler. Paired graph tests verify
four samplers, shared early output buffers and predecessor, separate final
outputs, valid dependencies and no connection to the live route.
The new check is included in the standard regression command. No GPU inference
was executed.

## Primary sources

- [Motion Context publisher](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context):
  recommended context length 22; raw latents remove reconstruction loss, not
  all model drift.
- [v0.3.1 source](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context/blob/v0.3.1/nodes.py):
  native reference handling and raw history.
- [ComfyUI H3 VAE](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/ldm/minimax/vae.py):
  native temporal chunking and internal spatial tiling. This alone does not
  establish the decoder as the cause of the observed variation.

