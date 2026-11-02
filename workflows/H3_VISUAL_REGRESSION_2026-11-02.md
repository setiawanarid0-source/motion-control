# H3 v6 visual regression audit — 2 November 2026

## Decision

The owner's retest fails visual acceptance. The earlier decision to promote
`guide-dmad4-character-caption` from limited frame inspection was premature.
Face consistency improved, but lighting, reference-only accessories, body
appearance and fabric consistency were not adequately checked. Passing the
application tests means the graph, queue and storage work; it does not mean
the video satisfies the visual requirements.

This audit documents the failed recipe and the implementation boundaries. It
does not declare a replacement recipe validated or change ordinary generation.
No new paid inference was needed to establish the findings below.

## Reported run

| Item | Observed value |
| --- | --- |
| Deployment / source | `09c313b5-09a9-4f2d-b41b-d9f7ad7aa616` / `c566024fc62e5f4efaeb810d87906c9fd716c0f8` |
| Provider task | `2117176682029084674` |
| Uploaded result SHA-256 | `9ff0fea2000821aada0f172079ae32ca824966256adb2182e7076b7a0a3c9bf4` |
| Actual output | 1080×1936, 24 FPS, 361 frames, 15.041667 s |
| Native photo dimensions in the run's media plan | 1536×2752 |
| Model canvas | 1088×1952 |
| Sampling | DMAD four-step / LCM / simple / CFG 1 / video-audio shift 12/2 |
| Task adapter | Character Swap v1.1 |
| Attention | Sol-Attn, tau 1, start 20%, dense blocks 0 and 1, exact reference KV |
| Exported window starts | frames 0, 124, 243; 0, 5.166667, 10.125 s |
| Continuation | Five previous generated frames in windows two and three |
| Provider execution | 1916 s / 31m56s |
| Submission to ready | 1950.873 s / 32m30.873s |

The report's native input is larger than the previously screened 1143×2048
photo. The earlier 24m53.431s timing cannot be presented as a result for this
run. Worker allocation and all causes of the runtime difference have not been
isolated. The current run exceeds the 25-minute target by 7m30.873s.

## Visual findings

| Requirement | Finding | Evidence |
| --- | --- | --- |
| Facial identity | Improved, as the owner also reports | Remains recognisable over the inspected clip; this is not a biometric identity assessment |
| Reference-only objects/accessories | Fail | The driving performer's large wrist scrunchie is visible by about 3 s and persists in later frames |
| Lighting continuity | Fail | Ceiling luminance steps exactly at both independently sampled window boundaries |
| Body proportions / appearance | Fail reported by owner; not validated | Torso/chest contour and garment shape are re-synthesised while following the driving body. No quantitative 3D body-ratio preservation was established |
| Fabric / fine texture | Fail | Large dark/light fabric patches change on the chest and torso, especially as hands and hair move |
| Native output geometry | Pass for the downloaded file | ffprobe confirms actual 1080×1936 frames; this does not establish appearance fidelity |
| Runtime target | Fail for this run | 32m30.873s overall |

The scrunchie appears before the first join, so removing window joins alone
cannot explain or fix every failure. The failed appearance checks also mean
that a consistent face must not be used as a proxy for full-body/scene fidelity.

## Measured lighting discontinuities

All 361 decoded frames were measured. The ROI is the fixed ceiling rectangle
`x=100, y=20, width=880, height=110`, away from the performer. FFmpeg converts
the crop to 8-bit gray and a small area sample; the mean is recorded per frame.
This is analysis of the result, not any output correction.

| Boundary | Mean before | Mean after | Delta |
| --- | --- | --- | --- |
| frame 124 / 5.166667 s | 38.0692 | 29.8564 | -8.2128 |
| frame 243 / 10.125 s | 30.1054 | 24.7128 | -5.3926 |

These are the two largest adjacent-frame ceiling luminance steps. They coincide
with the render windows recorded in Railway. Five generated context frames did
not enforce a continuous exposure across separately sampled windows.

For comparison, the previously supplied driving clip was fitted uniformly to
the same content canvas at 24 FPS and measured in the corresponding ROI. Its
changes at these frame numbers are +0.0351 and -0.0713. This earlier driving
asset matches the observed action, but its bytes were not retrieved from the
reported task; do not treat this as a hash-verified comparison of that task's
exact uploaded video.

## Verified implementation issues

1. **The source is still a full RGB appearance guide.** `VHS_LoadVideo` supplies
   the original performer, clothing, accessories, illumination and scene to
   `MiniMaxH3AddGuide`. Only the beginning of later windows is replaced by the
   generated continuation. Native `MiniMaxH3AddGuide` VAE-encodes those image
   frames; it does not extract motion or skeletons. A prompt assigning
   motion-only semantics does not remove the RGB appearance from this path.
2. **The selected task model has a different scene contract.** The author's
   Character Swap v1.1 template preserves the guide's scene, lighting and
   performance while replacing its character. Vanta instead asks the current
   photo to define the full scene and lighting. The architecture and training
   prior are therefore not an independently verified appearance-isolation
   method for Vanta's requirement.
3. **The speed release changed inference behaviour.** `f76cc16` switched normal
   requests from eight-step DMD/Euler to four-step DMAD/LCM; previous releases
   also introduced sparse attention. `c566024` subsequently promoted a different
   task adapter and a generated caption. These are model/sampling changes, not
   merely faster I/O. Their separate effects on texture and body geometry have
   not been measured in a fixed-input, fixed-seed ablation. Do not state that
   any one of them alone caused all observed defects.
4. **Independent windows are not a shared denoising trajectory.** The native
   five-frame appearance guide in each later window is soft conditioning, not
   an exposure or material constraint. It did not prevent the measured joins.

The saved graph contains no output upscaler, output downscaler, face restoration
or refinement pass. The input plan reports untagged RGB with no ICC conversion.
There is no evidence that an output resizer or ICC conversion caused these
particular regressions.

## What the published alternatives actually establish

- Henge explicitly distinguishes source RGB, 2D subject marks, 3D body guides
  and region masks. It warns that source RGB does not guarantee unchanged
  background pixels. Vanta currently uses source RGB. Merely disabling guide
  CLIP context is not a new fix here: Vanta already does not send the source
  clip as an additional CLIP/native reference video.
- ComfyUI supplies a native trained pose-control route:
  `MiniMaxH3FunControlNetApply` with a compatible **pruned** H3 Fun control
  checkpoint. Its official template uses pose extraction/drawing and a model
  patch, rather than feeding a skeleton to the present Character Swap Add Guide
  graph and assuming the two methods are interchangeable.
- The template's default is 0.4 MP and 20 steps. Its optional four-step turbo
  is a different, explicitly selected asset. These example settings are not
  evidence that native 1080p, the current DMAD/Sol stack, all required facial
  expression/camera behaviours and a complete 15-second runtime have passed.
- H3 Reference Attention Binding is explicitly an experimental attention
  mechanism without published GPU quality validation in its own evidence
  section. It also excludes sparse routing while active. It must not be
  promoted as a proven repair for this video.

## Acceptance required for another promotion

Use the actual complete photo and driver, record their hashes and native
dimensions, and compare the same camera/action interval with a fixed seed.
Review the complete output, with checks around hand/face occlusion, the wrist
accessory, torso proportions, fabric patches, every segment boundary and the
last frame. A changed-reference case remains necessary, but is insufficient
alone. Timing and native output geometry are separate acceptance checks.

A short test can reject a candidate for accessories/body/texture. It cannot
establish full-duration lighting continuity or the 15-second speed target.
No production promotion is justified until all required checks pass; if a
candidate trades away motion, expression, camera behaviour, appearance or the
native-output constraints, record the failure rather than changing the target.

## Primary sources inspected

- [Character Swap model scope and exact prompt](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/docs/character-swap.md)
- [Native Add Guide and Fun Control implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [Henge source representations and generation defaults](https://github.com/alisson-anjos/Henge/blob/main/README.md)
- [Official native Fun pose workflow](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/video_minimax_h3_fun_controlnet_union.json)
- [Fun ControlNet Union 2.0 model and supported conditions](https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0)
- [Reference Attention Binding scope and evidence limits](https://github.com/alisson-anjos/ComfyUI-BFSNodes/blob/main/H3_REFERENCE_BINDING.md)
