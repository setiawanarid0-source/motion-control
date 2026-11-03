# Akatz V1.5 Native 1080p — owner-test candidate

This adds a separate `minimaxH3Akatz` option under Motion Control. The existing H3 workflow remains available. Video inference is initiated by the owner's Generate action; deployment, page load and local checks do not start inference.

## Compatibility and recipe

The inspected RunningHub worker rejected `H3RelayApplyEditMask`, `H3RelayApplyHistory` and `H3RelayWindowInputs` as unavailable. The Relay JSON therefore cannot be installed intact. Validation-only checks also recognized SAM3, AV latent separation/concatenation and latent noise masks, but this does not supply the missing Relay semantics.

This candidate adapts the author's original native Ref2VA image/video path (`examples/H3 Character Swap v1 Ref2VA.json`) to the recommended V1.5 model pair. It is **not** the complete Relay/SAM tracked-mask/history workflow. There is no synthetic replacement for missing Relay nodes.

- Ref2VA INT8 base, native H3 Qwen text encoder and video/audio VAEs already used by the service.
- Akatz character-swap V1.5 and FL2V Turbo **8-step**, both strength 1; `er_sde`, `normal`, CFG 1, sigma shifts video 12 / audio 3.
- One owner-initiated RunningHub task exports the entire clip at 24 FPS. Accept 6–362 real frames (the existing duration tolerance covers nominal 15-second containers). Revision `akatz-native-1080-v2` bounds each sampling window and its source-video reference to at most 124 model frames. Consecutive windows share 22 already-generated full-canvas frames, anchored with native `MiniMaxH3AddGuide`. Original photo and caption are reused; source RGB frames are never hard appearance guides. Only each window's final input frame is repeated for the `17n+5` grid. Added tails and generated overlaps are removed before concatenating; every real source time is exported once.
- Attention adaptation: Kitchen backend, SOL target attention after the first 20%, exact reference K/V, dense blocks 0 and 1. This is an adaptation for the native 1080 canvas, not a claim that the stock author graph is unchanged or that a runtime target has been met.

## References and output

The complete current photo is the appearance reference. The captioner sees that photo only. Instructions target its face, hair, body proportions, outfit, accessories, texture and scene lighting; the video supplies performance timing and camera motion. No source RGB frame is installed as a hard appearance guide. Source audio is retained when present.

Reference color handling reuses the existing validated path: ordinary RGB photos remain unchanged; required ICC/EXIF conversion does not resize or enhance them. The driver is normalized to 24 FPS, autorotated once and padded to the model grid without spatial scaling. The sampling canvas uses a native 1080-pixel short edge plus grid padding, with the photo's aspect ratio. Only that grid border is cropped after decoding. There is no decoded-output upscale/downscale, refinement, restoration, interpolation or composite step.

This variant has no Relay edit mask or Relay history nodes, and does not pin source background pixels. Continuity uses native generated-frame guides. The prompt requests the photo's scene and illumination. Visual identity, proportions, material consistency, lighting and camera fidelity remain acceptance criteria for the owner's generated outputs, not established facts.

## Exact model provisioning

Both LoRAs use the official RunningHub `getLoraUploadUrl` + `RHLoraLoader` path. Schema rejection alone did **not** prove that stock LoRA names were available; this implementation does not rely on that inference.

| Asset | Pinned revision | SHA-256 | Bytes |
| --- | --- | --- | ---: |
| `h3_character_swap_v1.5.safetensors` | `0f409f0c2a18f123f3985041ec52982c813f5a9c` | `8f2c3c3eba161df8d0c6099598b4730f641f5ce01e04cd16d2427cff8a35218f` | 155110792 |
| `minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors` | `3ec17a324ced54151364f24f8b5fb6bf7e26414f` | `08cfe946033af7d27719b964b6e0a0e50c32138daabbd6ce4137e23df6bf9980` | 1956193000 |

The Turbo asset's filename describes the published adapter; this service samples directly at its native 1080 canvas and does not upscale a 768p render.

Model preparation starts on first Generate, streams approximately 2.1 GB into temporary storage, verifies size/SHA-256, then uploads using verified MD5. Only small account-specific receipts persist on the account volume. Both uploads must succeed before any paid inference task is submitted. Initial download/upload can add preparation time. The owner's first task completed model preparation in approximately 2 minutes 41 seconds; that is separate from inference. Native 1080 memory usage and inference runtime for revision v2 remain unmeasured.

## Runtime repair, 2026-11-03

Owner task `2117568678426140673` used v1, 361 real frames and one 362-frame native sampler. It ended as failed with provider code 805 after 2432.633 seconds observed from submission. The legacy outputs API returned no usable node/exception reason. The exact provider-side cause must not be labelled as OOM or timeout without evidence.

V2 removes the unbounded full-clip sampling/reference workload. For that same 361-frame timeline it builds four 107-model-frame windows rather than one 362-frame window. Each is still eight steps with the same pinned adapters, sampler, scheduler, native canvas and full-resolution photo. Generated 22-frame context carries motion/appearance between windows; there is no extra provider task per window. This reduces peak sequence length and quadratic attention work, not the exported frame count. It does not establish a measured speedup or guarantee identical appearance at joins.

Akatz is now included in the existing read-only node monitor and terminal/timing audits; the old name filter accidentally excluded it. If the legacy API omits the failure reason, one bounded V2 result query is permitted and recorded durably, without a render, retry or cancellation. Historical v1 node IDs remain recognized. Failure audit lookup does not change the displayed duration, finished time, output retention or task credentials.

## Verification and pending acceptance

Local checks cover every accepted frame count, exact source-time coverage across overlaps, the 124-frame cap for both native sampling and source reference, generated-only native 22-frame history, model-grid tail handling, both pinned model paths, numeric seeds, Plus gating, failed model setup preventing submission, queue restart safety, Create-page selection, original-audio wiring and a real CPU preprocessing check with a rotated 0.25-second clip. They use fake provider/model upload boundaries and do not run GPU inference.

Automatic paid H3 benchmark flags are disabled for owner testing. The temporary compatibility inspector expires separately. The existing account pool, task tracking and output retention paths are reused.

The owner will evaluate generated outputs for identity/hair, body proportions, clothes/accessories, skin/fabric texture, lighting, source motion/camera and consistency across the entire clip. Native 1080 memory capacity and the requested runtime target of at most 25 minutes for 15 seconds remain unverified until those tests.

## Primary sources

- [Akatz model and examples](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA)
- [Author's native core workflow](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/blob/96ea3407b230b6f7df71c58c70e31df96bd7e533/examples/H3%20Character%20Swap%20v1%20Ref2VA.json)
- [Author's resource catalog](https://github.com/akatz-labs/h3-character-swap-tool/blob/main/docker/resource-catalog.json)
- [FL2V Turbo publisher](https://huggingface.co/lightx2v/Minimax-h3-Turbo)
- [RunningHub API documentation](https://www.runninghub.ai/runninghub-api-doc-en)
- [Native H3 reference and guide implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [Native sparse-attention documentation](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/BlockSparseAttention/en.md)
