# VANTA MiniMax H3 Character Swap

An additional Motion Control workflow. Existing graphs, account selection,
task monitoring, history, authentication and result retention are unchanged.

## Recipe

- MiniMax H3 **Ref2VA**, INT8 convrot; not H3 Max or a Wan API endpoint.
- Akatz **Character Swap V1.5**, strength 1.0, applied to the sampling model.
- 20 steps, res_multistep / simple, CFG 1, video/audio shift 12 / 3.
- `MiniMaxH3Director`, `rv2v`: each source segment is `<Video 1>` and the same
  uploaded character image is `<Picture 1>` in every segment.
- At most 5 seconds per segment; complete source coverage up to 60 seconds.
  Director motion-context guidance joins segments. Its H3 alignment frames and
  guidance prefixes are trimmed; `continuityKeepTail=false` prevents duration growth.
- One 24 FPS H.264 MP4, source audio, source aspect rounded to H3's 32px grid.
  Duration differs by at most one 24 FPS frame. Standard is about 0.4MP and
  Plus about 0.7MP, capped by source size. No local camera compensation or source
  re-encoding. The Director samples original timestamps at 24 FPS.
- Uses the existing owner-accessible RunningHub workflow ID plus a custom graph.
  No `retainSeconds`: no paid retained GPU reservation after this H3 job.

## RunningHub dependencies

| Component | File / node |
| --- | --- |
| UNET | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` |
| Text encoder | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` |
| Video VAE | `minimax_h3_video_vae_fp16.safetensors` |
| Audio VAE | `minimax_h3_audio_vae_fp32.safetensors` |
| LoRA | `h3_character_swap_v1.5.safetensors` |
| Director | `MiniMaxH3Director` from `AIMixer/ComfyUI_MiniMaxH3_Director` |
| Final output | `VHS_VideoCombine`, node 490 |

The LoRA is loaded by name from RunningHub's catalog. It is **not** a model
training step, a new person-specific LoRA, or an unimplemented upload placeholder.
No model weights are placed on Railway's account volume.

The Director input/timeline schema was checked against upstream revision
`4c6245e518dd8a494f3afc4f3cccd53f22d82d10`. RunningHub manages its installed
node versions independently. An explicit provider graph rejection remains a
failed, unaccepted submission and is not resent across accounts.

## Evidence and attribution

- [MiniMax H3 Character Swap, Akatz](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA)
  — V1.5, strength 1.0; MiniMax H3 Community License applies.
- [RunningHub V1.5 workflow](https://www.runninghub.ai/post/2113278202089521154)
  — lists the exact V1.5 LoRA, base models and native loader.
- [Director source](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director/tree/4c6245e518dd8a494f3afc4f3cccd53f22d82d10)
  — rv2v source/reference binding, timeline schema, frame alignment, original audio.
- [Director on RunningHub](https://www.runninghub.ai/post/2094582511883345922)
  — installed node and base model dependencies.

## Verification limits

The automated tests exercise actual media probing, all supported timeline
lengths, graph links, LoRA routing and the production `createTask` payload with
a mocked provider. They do not establish GPU memory fit, current provider
availability or character fidelity. Paid RunningHub generation must be checked
separately with a short, single-subject source before a one-minute job. Occlusion,
hard cuts, multiple people, camera motion and segment joins can still drift.
This is not a pixel-preserving masked replacement workflow or an uncensored-service
guarantee. No inference charge estimate is fabricated.
