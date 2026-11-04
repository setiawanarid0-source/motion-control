# H3 texture: workflow comparison and joint-context candidate

## Outcome

The latest supplied result still fails texture acceptance. Seed transport is
not an established cause or remedy. The review candidate changes temporal
sampling itself: one long AV latent, core H3 context windows fused at each
denoising step, one final decode, and no generated-frame relay. It is not
connected to production or to a provider submission route.

No model upload, paid task, automatic retry, cancellation or production change
was made for this comparison. Worker support and complete visual/runtime
qualification remain open. Passing graph checks is not visual qualification.

## Latest attached output

- Attachment: `1000141378(1).mp4`.
- SHA-256: `2d3223c239ecafb207b42edbe241305584268861b10781306d34256187bc4715`.
- Embedded provenance: RunningHub task `2117861200645943298`.
- 361 frames, 24 fps, 15.041667 seconds, 1080 x 1936, H.264 CRF 12.
- The executed graph contains dense attention and three separate four-step
  native samplers. Later samplers receive five decoded generated frames at
  target frame zero. The original image still reaches every reference node.
- Native crops at frames 0, 124, 243, 288, 336 and 360 were inspected. Skin
  shading becomes more patch-like and hair highlights merge into wider bands
  toward the end; poses/expressions also differ, so these crops are qualitative
  evidence of the reported defect, not an isolated numerical texture metric.
- No byte-matched original photo/driving-video pair was established for this
  attachment. The older reference pair in scratch was not used to qualify it.

## Compared workflows and what they actually do

| Source | Actual reference / continuity path | Relevance and exclusions |
| --- | --- | --- |
| Vanta KOH (1), `workflows/current-api.json`, blob `1beb0e69402214d4506c78c36b6dea56e826fffd` | Wan/SCAIL model context length 101, overlap 32, `standard_uniform`, pyramid fusion, FreeNoise; reference image also reaches CLIP vision and SCAIL conditioning | The useful comparison is fusion during sampling. Its 640 x 1120 render and decoded 1080 x 1920 resize are excluded from the H3 candidate. Wan's node and frame arithmetic cannot simply be attached to H3. |
| [Alissonerdx Character Swap v1.1](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/docs/character-swap.md), native workflow | Character image is a native image reference. Original guide is aligned through `MiniMaxH3AddGuide(frame_idx=0)`; matched character LoRA and eight-step DMD recipe. A separate planner handles longer shots. | Its guide-latent training route differs from Akatz's native Video 1 route. Copying only its trigger, prompt or guide wiring into the Akatz recipe would mix distinct adapters. Optional LMS/upscaler stages are excluded. |
| [Akatz adaptive-window character swap](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/blob/main/examples/akatz-labs-character-swap-turbo8-adaptive-window.json) and [Relay 2.0](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/blob/main/examples/README.md) | Source performance and character image remain references; default history is 18 frames with matching source/audio time. Relay uses pre-target history and a shortened target latent. Its full graph also uses a tracked edit mask. | Native AddGuide with five frames inside a fresh target is not Relay's history layout. Relay classes were unavailable on the previously inspected worker. Its source-background mask also differs from Vanta's photo-scene requirement. These are differences, not proof that Relay will pass the user's footage. |
| [linoyts H3 character swap](https://huggingface.co/spaces/linoyts/minimax-h3-character-swap/blob/main/README.md) | Diffusers port of Alissonerdx's guide-latent method: native image reference plus guide on the target grid, with original soundtrack | Confirms that image reference and aligned guide have distinct model roles. It is a port of that family, not an independent success benchmark or a drop-in provider configuration. |
| [Joeygambino multishot settings](https://huggingface.co/joeygambino/MiniMax-H3-Multishot-Workflow/blob/main/SETTINGS.md) | Raw-latent continuation, explicit reference bank; author reports detail accumulating when generated output is carried forward | Supports treating feedback as a plausible drift mechanism. Its longer-chain measurements do not establish the cause of this three-window clip. Its normalization, texture leveling and upscaling are excluded. |

The installed Ref2VA four-step accelerator is trained at 544p according to
[its publisher](https://github.com/ModelTC/Minimax-H3-Turbo#1-model-specs).
Sampling a larger canvas is not evidence that its detail matches a native
1080p capture. This is a model limitation to qualify, not proof that this
accelerator alone caused the late change. The candidate keeps the accelerator
unchanged to isolate the temporal mechanism first.

## Concrete candidate

[ComfyUI PR 17425](https://github.com/Comfy-Org/ComfyUI/pull/17425), merged
30 October 2026 as `6651247a8b50cefd1436c834f704bdf7767722e9`, adds the native
`MiniMaxH3ContextWindows` node plus H3 video/audio mapping and guide slicing.
This supplies the relevant mechanism directly for H3 instead of reusing a Wan
node or pretending that RGB continuation equals context fusion.

`h3-akatz-context-candidate.js` builds an isolated candidate from the current
first-window graph template:

- Preserve the exact model/LoRA loaders, reference photo, caption/instructions,
  dense attention, four-step scheduler, source performance/audio and CRF 12.
- For a 361-frame clip create one 362-frame target and one full reference,
  repeating only the last input frame for grid padding. Trim that one padding
  frame after a single decode; export each real time once.
- Patch the same model into both guider and scheduler with H3 context length
  124, overlap 39 and pyramid fusion. Disable FreeNoise to avoid introducing
  an additional noise-redistribution variable. This deliberately differs from
  the node's FreeNoise-on default.
- Eliminate all later completed samplers, generated image-history guides and
  decoded-output concatenation. Short clips at or below 124 model frames keep
  their single-window path.
- Keep seed transport unchanged. This candidate is not another seed fix.
- Preserve the final canvas and crop; introduce no scaling, refinement,
  color matching, sharpening or frame interpolation.

Target windows are bounded; the full video reference and final VAE decode
still need memory. Four scheduler steps can require multiple window model
evaluations per step. Neither the old twelve-evaluation budget nor a
25-minute runtime is claimed for this candidate.

## Executed checks and remaining gate

The candidate graph check passed all 714 combinations of admitted duration
(6 through 362 frames) and audio presence. It checks complete timeline/grid
coverage, one sampler/decode, absence of generated appearance feedback, intact
native image/audio paths, both consumers using the patched model, valid graph
dependencies, identical inherited model/prompt settings and unchanged live
three-window generation.

The actual upstream `MiniMaxH3ContextWindowsNode.execute` and `video_latent_t`
functions were executed in a CPU-only schema harness. Its 124/39 pixel-frame
settings become 37/12 latent steps on temporal dimension 2, with static
standard scheduling and the requested pyramid/FreeNoise options. This checks
the upstream contract, not the installed provider version.

The existing Akatz production regression also passed locally. No claim is made
that the known-failing provider seed simulation has become valid.

Before any render, establish that the actual worker has the new node **and**
the associated core model/context implementation; a node name alone does not
qualify the runtime. Then qualify raw complete output for texture, identity,
accepted motion/expressions/camera, memory and end-to-end time. There is no
automatic task submission or promotion path in this change. Do not ask the
owner to rerun the unchanged live workflow as a texture remedy.
