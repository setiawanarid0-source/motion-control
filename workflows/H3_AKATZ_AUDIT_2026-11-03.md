# Akatz Character Swap audit — 3 November 2026

## Decision and evidence boundary

Akatz V1.5 is a valid candidate for a controlled character-consistency comparison.
It has not been rendered or qualified on this Vanta account. No RunningHub render
or schema submission was made during this audit. The new inspection route is
prepared and locally tested, but has not been deployed. Production remains at
`615daf9dbb4ff5c012449903f78c5667a0aad1da`.

The attempted default-branch push was rejected by automatic approval review
because it could trigger a production deployment without explicit authorization
for that mutation. This change is offered on a separate review branch; it does
not establish worker compatibility or visual acceptance.

## Exact recipe under review

- Model repository: [akatz-ai/MiniMax-H3-Character-Swap-LoRA](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA),
  revision `96ea3407b230b6f7df71c58c70e31df96bd7e533`.
- Adapter: `h3_character_swap_v1.5.safetensors`, 155,110,792 bytes,
  SHA-256 `8f2c3c3eba161df8d0c6099598b4730f641f5ce01e04cd16d2427cff8a35218f`.
  The internal workflow filename `h3-v2-challenge-eval-20261013/v2-1000.safetensors`
  refers to these same weights, not another model to substitute.
- Ref2VA INT8 base, native H3 text encoder and video/audio VAEs.
- Separate `minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` at strength 1.
  Character adapter strength 1, 8 steps, CFG 1, `er_sde`, `normal`.
- Native image-reference and original-video-reference conditioning, SAM detection
  and tracking, recovered/expanded masks, source-encoded masked sampling, and
  generated continuation history. No pose-only or face-crop substitution.
- Default 124-frame windows and 18-frame matched history, fixed seed 904239,
  source soundtrack, raw decoded frames and ordinary video encoding.

Sources: [author API graph](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/blob/96ea3407b230b6f7df71c58c70e31df96bd7e533/examples/H3-Character-Swap-Relay-V2.api.json),
[workflow guide](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/blob/96ea3407b230b6f7df71c58c70e31df96bd7e533/examples/README.md),
[shared toolkit](https://github.com/akatz-ai/h3-relay/blob/main/h3_relay/toolkit.py),
[author integration validation](https://github.com/akatz-labs/h3-character-swap-tool/blob/main/release/toolkit-v2-validation.md).

Vanta's ordinary path instead uses Alissonerdx's distinct Character Swap v1.1,
DMAD four-step LCM sampling and RGB AddGuide conditioning with five generated
overlap frames. The model version numbers are from different releases/authors;
V1.5 is not evidence of a direct upgrade from the installed v1.1.

## Executed CPU findings

The actual upstream pure canvas and planning functions were evaluated without
loading models. The source blob identities are:

| File | Git blob |
| --- | --- |
| `video_prep.py` | `23bb3a6eba7f4072520de9126266335c747be544` |
| `planning.py` | `9155725745cd0aef44a30b15d6233d948bbc1e8e` |
| `toolkit.py` | `ac470f18318b9e4cf355560a869e4ba39334e2c0` |

The available Vanta comparison source is 720×1280, approximately 15 seconds.
The original `768` budget computes **736×1344 / 989,184 pixels** for it. A
1080×1920 input also computes 736×1344. This is a 1 MP area budget, not a
native-1080 setting. Achieving native 1080 would require a declared canvas
adaptation and a new memory/time measurement, rather than post-generation scaling.

For every source length from 1 through 1,440 frames, the upstream 124/18 planner
delivers every source index exactly once after trimming padding and overlap.
This checks timeline mechanics only; it does not measure generated motion.

| 361-frame window | Source interval, end exclusive | History | Delivered | Padding |
| --- | --- | --- | --- | --- |
| 1 | 0–124 | None | 124 | 0 |
| 2 | 123–247 | 106–124 | 123 | 0 |
| 3 | 246–361 | 229–247 | 114 | 9 |

The local short/reference and full-duration cases therefore can use one canonical
timeline without dropping real frames. The 18-frame history is source-time
aligned; it is not 18 independently repeated output frames at every boundary.

## What this establishes and does not establish

- The mask constrains edits around a selected source person. Pixels/latents
  outside that region remain source-scene conditioned. The default graph does
  not implement replacement of the entire scene by the photo background.
- The mask is detection/tracking geometry, not a reconstruction of the photo's
  3D body volume. Hair, clothing and a larger reference silhouette can extend
  beyond the source silhouette; the expanded mask needs visual inspection.
- Matched generated history is a concrete continuity mechanism. It does not
  prove exposure locking, fixed fabric texture, unchanged accessories or exact
  facial identity across all 15 seconds.
- Author qualification includes short functional and migration comparisons;
  some recorded older/generic-prompt runs return toward the source identity.
  The V1.5 selected stylized comparison is not a matched realistic-human
  benchmark against Vanta's portrait and driving clip.
- Vanta's available 1143×2048 portrait is the same checksum used in the recent
  private comparison series. It is not the unrecovered 1536×2752 original
  upload from the reported production task. Do not call it a byte-identical
  re-render of that earlier upload.
- Native 1080, ≤25-minute 15-second runtime, short-clip speed and 1:1 camera
  behavior remain unmeasured for the Akatz recipe on the target worker.

## Reviewable worker-inspection change

`h3-akatz-inspect.js` adds a private route under the existing expiring inspection
credential and original-task scope. It accepts only fixed node checks, not
arbitrary graph JSON. It has no sampler or video output. Every preview output
depends on an intentionally nonexistent input image; unexpected acceptance is
cancelled against the new task ID only. Permanent per-check checkpoints prevent
duplicate submissions across restarts.

A deliberately nonexistent node is the negative control: it must be rejected
as missing before unused-node presence results can be trusted. Recognized class
identifiers do not prove matching input schemas, weights, kernels or execution.
The separate model check reports only filtered loader choices; it does not
download weights or render a video.

Validation: the full `npm run check` passed using the isolated local Python
dependencies needed by the existing CPU-media tests. The new tests cover the
no-sampler invariant, invalid-image output ancestry, fixed allowlist, auth,
credential privacy, restart/concurrent idempotency and scoped cancellation.

Next gate: authorize deployment of this private checker, verify the negative
control and required worker nodes/models, then prepare a bounded real comparison
using the supported original recipe. Any native-1080 adaptation must be labelled
explicitly. Visual acceptance must include identity/hair, photo body proportions,
outfit/accessories, unwanted source objects, lighting, natural texture, camera,
full frame count and actual provider-submission-to-ready time.
