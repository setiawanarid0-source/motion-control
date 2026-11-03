# Akatz V1.5 Native 1080p — owner-test candidate

This adds a separate `minimaxH3Akatz` option under Motion Control. The existing H3 workflow remains available. Video inference is initiated by the owner's Generate action; deployment, page load and local checks do not start inference.

## Compatibility and recipe

The inspected RunningHub worker rejected `H3RelayApplyEditMask`, `H3RelayApplyHistory` and `H3RelayWindowInputs` as unavailable. The Relay JSON therefore cannot be installed intact. Validation-only checks also recognized SAM3, AV latent separation/concatenation and latent noise masks, but this does not supply the missing Relay semantics.

This candidate adapts the author's original native Ref2VA image/video path (`examples/H3 Character Swap v1 Ref2VA.json`) with the recommended Akatz V1.5 character adapter. V3 replaces the eight-step accelerator after two owner trials exceeded the free RunningHub account's 40-minute limit. It is **not** the complete Relay/SAM tracked-mask/history workflow. There is no synthetic replacement for missing Relay nodes.

- Ref2VA INT8 base, native H3 Qwen text encoder and video/audio VAEs already used by the service.
- Akatz character-swap V1.5 and **Ref2VA Turbo 4-step v0.1**, both strength 1; `euler`, `simple`, CFG 1, sigma shifts video 12 / audio 3. This matches the accelerator publisher's native Ref2VA ComfyUI workflow. It is a separately trained four-step checkpoint, not the previous eight-step checkpoint with fewer scheduler steps.
- One owner-initiated RunningHub task exports the entire clip at 24 FPS. Accept 6–362 real frames (the existing duration tolerance covers nominal 15-second containers). Revision `akatz-native-1080-v3` bounds each sampling window and its source-video reference to at most 124 model frames. Consecutive windows share five already-generated full-canvas frames, anchored with native `MiniMaxH3AddGuide`. A 361-frame clip uses three windows and twelve total sampling steps. Original photo and caption are reused; source RGB frames are never hard appearance guides. Only each window's final input frame is repeated for the `17n+5` grid. Added tails and generated overlaps are removed before concatenating; every real source time is exported once.
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
| `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors` | `30f485ed874aa44c8183348ad361c5eabad318da` | `5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c` | 1956193000 |

The publisher documents the Ref2VA v0.1 accelerator as trained at 544p. This adaptation samples directly on the native 1080 canvas; it never upscales a lower-resolution render. Native 1080 visual quality and the combination with Akatz V1.5 remain owner tests. V0.1 was selected because the publisher provides an explicit matching native ComfyUI recipe; settings for another accelerator version are not inferred from its filename.

Model preparation starts on first Generate, streams approximately 2.1 GB into temporary storage, verifies size/SHA-256, then uploads using verified MD5. Only small receipts persist on the account volume. Both models must be ready before any paid inference task is submitted. Initial download/upload can add preparation time. The owner's first task completed model preparation in approximately 2 minutes 41 seconds; that is separate from inference. V3 must prepare its replacement accelerator on first use; an eight-step receipt cannot satisfy the different SHA-256. Native 1080 memory usage and inference runtime for revision v3 remain unmeasured.

### Model-transfer repair, 2026-11-03

Submission `942d91e1-c072-46df-b5f4-61c66bbdab61` reached input upload at 13:16:08.806Z and model preparation at 13:16:13.426Z. The approximately five-second input upload was followed by 303.508 seconds of replacement-model preparation, ending at 13:21:16.934Z. RunningHub then explicitly refused creation with `NOT_ENOUGH_BALANCE`; no task ID was acknowledged. These are separate transfer and provider-refusal events, not measured inference time.

Previously, a successful model receipt was only used by its original account. Automatic account changes could download and upload identical weights again. The uploader now asks the official `getLoraUploadUrl` endpoint, using the current account's credentials and a prior size/SHA-verified upload's MD5. It skips transfers only if the returned filename exactly matches a successful receipt, including its region. A different region/path or SHA remains a cache miss. Receipt reuse survives service restarts; concurrent transfers to one destination share a single PUT. API credentials are never forwarded to storage hosts.

Startup performs only this cache-authorization check for pool accounts. It never downloads model weights, uploads model bytes or creates inference. A first-use asset with no successful receipt still waits for the owner's Generate action. The UI reports actual model download/upload bytes, verification and storage acknowledgement instead of one indefinite preparation label. Progress persists through browser reconnects and excludes keys, URLs and local paths. Absolute download/upload deadlines are three/five minutes, respectively, so activity cannot keep a stalled transfer open indefinitely. A model-preparation failure stops the submission without repeating the same transfer through other accounts. An explicit `NOT_ENOUGH_BALANCE` response without a task ID is displayed as a refusal, rather than an unconfirmed acceptance; it is not automatically resubmitted.

This repair does not change the sampling recipe, 100 RH account eligibility, account removal, task concurrency, durations or output retention. Mocked-network regression checks cover account/region isolation, deployment reuse, simultaneous uploads, active-but-stalled transfers, accurate UI byte/acknowledgement states and provider balance refusal. No new GPU render is used for verification.

## Runtime repair, 2026-11-03

Owner task `2117568678426140673` used v1, 361 real frames and one 362-frame native sampler. It ended as failed with provider code 805 after 2432.633 seconds observed from submission. The legacy outputs API returned no usable node/exception reason. The exact provider-side cause must not be labelled as OOM or timeout without evidence.

V2 removes the unbounded full-clip sampling/reference workload. For that same 361-frame timeline it builds four 107-model-frame windows rather than one 362-frame window. Each is still eight steps with the same pinned adapters, sampler, scheduler, native canvas and full-resolution photo. Generated 22-frame context carries motion/appearance between windows; there is no extra provider task per window. This reduces peak sequence length and quadratic attention work, not the exported frame count. It does not establish a measured speedup or guarantee identical appearance at joins.

### V2 owner trial and V3 repair

The user confirmed that their free RunningHub account automatically stops a generation at 40 minutes. Task `2117585504367366145` used v2 and failed after 2427.998 observed seconds. Its sampler node timings were 496.99, 628.42 and 632.14 seconds for the first three windows; the fourth stopped at 339.08 seconds with its last progress at 3/8. The roughly 10.5-minute later windows leave insufficient room for four windows plus encoding/decoding. Windowing alone was not enough.

V3 changes the actual accelerator to the publisher's reference-specific four-step student and matches `euler/simple`, shifts 12/3 and CFG 1. Five generated context frames are a valid native `17n+5` guide and allow three windows for a 361-frame clip: input counts 124, 124 and 123; model counts 124 each; exported counts 124, 119 and 118. This cuts scheduler steps from 32 to 12 and avoids processing 66 overlap frames (now only 10). No frame-rate, reference-photo or output-resolution reduction is used.

The execution plan records the 1500-second target, 2400-second provider limit and maximum twelve total steps. These are a budget, not measured runtime. The pre-submit plan rejects an over-budget profile. No new GPU render, automatic retry, timer reset or cancellation is used to claim success. The owner must still validate actual runtime and visual continuity.

Akatz is now included in the existing read-only node monitor and terminal/timing audits; the old name filter accidentally excluded it. If the legacy API omits the failure reason, one bounded V2 result query is permitted and recorded durably, without a render, retry or cancellation. Historical v1/v2 node IDs remain recognized. The fallback decision is also checkpointed when a legacy reason exists but is unclassified, preventing that task from monopolizing every audit poll. Failure audit lookup does not change the displayed duration, finished time, output retention or task credentials.

## Verification and pending acceptance

Local checks cover every accepted frame count, the matched four-step recipe, maximum twelve total sampling steps, exact source-time coverage across overlaps, the 124-frame cap for both native sampling and source reference, generated-only native five-frame history, model-grid tail handling, both pinned model paths, numeric seeds, Plus gating, failed model setup preventing submission, queue restart safety, Create-page selection, original-audio wiring and a real CPU preprocessing check with a rotated 0.25-second clip. They use fake provider/model upload boundaries and do not run GPU inference.

Automatic paid H3 benchmark flags are disabled for owner testing. The temporary compatibility inspector expires separately. The existing account pool, task tracking and output retention paths are reused.

The owner will evaluate generated outputs for identity/hair, body proportions, clothes/accessories, skin/fabric texture, lighting, source motion/camera and consistency across the entire clip. Native 1080 memory capacity and the requested runtime target of at most 25 minutes for 15 seconds remain unverified until those tests.

## Primary sources

- [Akatz model and examples](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA)
- [Author's native core workflow](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA/blob/96ea3407b230b6f7df71c58c70e31df96bd7e533/examples/H3%20Character%20Swap%20v1%20Ref2VA.json)
- [Author's resource catalog](https://github.com/akatz-labs/h3-character-swap-tool/blob/main/docker/resource-catalog.json)
- [FL2V Turbo publisher](https://huggingface.co/lightx2v/Minimax-h3-Turbo)
- [Turbo publisher's native Ref2VA workflow](https://github.com/ModelTC/Minimax-H3-Turbo/blob/main/example_workflows/video_minimax_h3_ref2v_lightx2v_turbo.json)
- [Turbo publisher's training and inference specifications](https://github.com/ModelTC/Minimax-H3-Turbo#model-specs)
- [RunningHub API documentation](https://www.runninghub.ai/runninghub-api-doc-en)
- [Native H3 reference and guide implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [Native sparse-attention documentation](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/BlockSparseAttention/en.md)
