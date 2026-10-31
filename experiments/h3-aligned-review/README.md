# H3 aligned-guide review — non-explicit benchmark only

This is a separate diagnostic workflow, not a certified production fix. The main
H3 option and all existing workflow graphs are unchanged. The owner-only page
`/h3-review.html` runs one short review through the existing Account Pool,
durable submission queue, task registry, History and 72-hour output storage.
There is no navigation entry and no automatic paid render.

## Why this comparison exists

The user's original `minimax_h3_character_swap_workflow_v1.1.json` was recovered
and read in full (119 nodes, 106 links; SHA256
`0f49f3e3adeb9ec5a0dd7dad83066a309620c14f68aba7c71887fcd303e73c52`).
It uses BFS Shot H3 Conditioning in **aligned guide (Add Guide)** mode, the
Alissonerdx v1.1 FRO Character Swap LoRA plus a DMD 8-step adapter, Euler/simple,
CFG 1 and 24 FPS. It is materially different from Vanta's Director reference-video
path with Akatz 1.5 and a post-generation head matte.

The saved original preset is **0.3MP**, not a native 1080p preset. Its optional
second pass is disabled. Its first saved segment has crop/inpaint/paste disabled;
`match_colors=0` on Join, while seamless-edge controls are enabled. Those controls
alone do not establish active masked head editing. It also contains a creator
video filename, example picture sheet and cached scene/character descriptions.
These demo inputs and cached prompts must not be reused for a new reference.

## Read-only observations from the submitted clips

No generated edit, identity inference or face-specific optimization was run on
the submitted explicit clips. Analysis is limited to metadata and existing
visible defects, separate from this non-explicit benchmark.

| Property | Submitted source | Submitted result |
| --- | --- | --- |
| Stored raster | 640×360 with -90° rotation | 1080×1920 |
| Displayed raster | 360×640 | 1080×1920 |
| Video frame rate | 60 FPS | 24 FPS |
| Video frames | 301 | 120 |
| Video duration | 5.016667 s | 5.000000 s |
| Video bitrate | about 1.600 Mbps | about 8.915 Mbps |
| File size | about 1.09 MB | about 5.67 MB |
| Hard cuts at scene threshold 0.4 | none detected | none detected |

The output has nine times the displayed pixels, but scaling and higher bitrate do
not by themselves recover source detail. In the deployed canvas function, a
360×640 input is also capped to a 352×640 generation canvas on either machine.
Thus the head edit is not generated at the final raster. Lack of detail is
consistent with that pipeline; a bitrate increase is not evidence of restoration.
The supplied sample is one short continuous take at the chosen cut threshold;
it does not demonstrate a failure caused by long-video segment joins.

Observed cutout-like boundaries and inconsistent local appearance are visual
defects. Their individual causes cannot be proved from metadata or unit tests.
They must be assessed on the separate clothed benchmark with actual model output.

## Isolated review recipe

- Native H3 Reference to Video receives **only the reference image**.
- The complete source sequence enters **MiniMaxH3AddGuide at frame 0**.
- Uses the author's head-specific adapter, rather than the full-body adapter.
- DMD 8-step adapter follows the original workflow's sampling route.
- Requires Plus and 0.25–5 seconds. Source audio stays on the source path.
- The diffusion canvas is the final 1080-short-edge raster rounded upward to a
  32-pixel grid. For 9:16: 1088×1920 inference, with 4px horizontal padding per
  side removed by ImageCrop to produce 1080×1920. There is no post-render upscale.
- Source frames are padded to `17n+5` **before Add Guide**. Merely setting the
  generation length would let Add Guide truncate a non-grid guide. Generated
  padding is trimmed before export; no tail or extra scene is kept.
- Details must describe the actual reference, not an author's cached person.

This comparison regenerates full frames under the head-only conditioning. It
**does not prove pixel preservation outside the head**. Body/background drift
must be checked; this is one reason it is not substituted for production H3.
A positive API status or a 1080p raster is not a visual quality pass.

## Models and provider readiness

The model names in `REVIEW_MODELS` are the published checkpoint filenames, not
proof of their availability in RunningHub. In particular the head and DMD LoRAs
must be checked on the selected account. Missing models must not fall back to
Akatz 1.5 or a different sampler silently. An explicit provider rejection uses
the existing no-cross-account-retry handling. No `retainSeconds` reservation.

RunningHub's API-uploaded LoRAs require `RHLoraLoader`, according to its official
upload documentation. They cannot simply be renamed and routed through
LoraLoaderModelOnly. This prototype uses catalog loaders and does not implement
or pretend to have completed that private-upload conversion.

## Safe benchmark and acceptance

The public author's demo is a clothed source/result comparison:
https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/resolve/main/examples/character_swap_v1.0_1.mp4

A local crop of its original column and a separate reference crop are preparation
assets only. They are not outputs from the new Vanta recipe, and are not committed
or advertised as a successful render. No submitted explicit clip is used as a
render input for this review.

Before any promotion, inspect actual rendered video for head scale and perspective,
connection at the neck, stable reference identity and hair, source lighting,
forehead/hand occlusion, small-face shots, camera motion, frame timing, and changes
outside the intended head region. Also verify the two LoRA filenames, live node
schemas, memory fit and actual output dimensions. A short test cannot establish
one-minute or multi-scene reliability.

Local tests cover native graph links/model routing, guide and export alignment,
real media normalization, source audio, temporary cleanup, provider payload and
reference details surviving the durable async queue. They do not run H3 inference.
At preparation time, this executor has no GPU or RunningHub test key, and the
Cloud Browser is at Vanta's owner login form. A successful authenticated render
and visual review remain outstanding.

## Primary references

- [Character Swap author docs](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/docs/character-swap.md)
- [Head Swap author docs](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/docs/head-swap.md)
- [BFS conditioning implementation](https://github.com/alisson-anjos/ComfyUI-BFSNodes/blob/main/bfs_shot_loop.py)
- [Native H3 guide implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [RunningHub LoRA upload contract](https://www.runninghub.cn/runninghub-api-doc-en/api-425761100)
