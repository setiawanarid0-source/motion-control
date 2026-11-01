# H3 Motion Control in Vanta

The existing `minimaxH3` option now generates the whole scene from the uploaded
photo, with aligned video frames as the motion guide. It replaces the previous
head/hair source composite and the separate `/h3-review.html` prototype.
The existing two uploads, durable queue, Account Pool, History, owner session and
result storage remain the entry points. No extra login or review form is needed.
VideoHelperSuite supplies media loading/export; the existing KJNodes batch join
avoids caching a growing full-length image tensor at every segment boundary.

## Actual graph

Ref2VA INT8 → training adapter V2 → DMD Ref2VA turbo → Motion Transfer v1.0 →
Sigma Shift 12/3. CFG 1, Euler/simple, 8 steps. The model reaches both the guider
and scheduler. Each segment receives the same current photo in native reference
slot 1 and every aligned source frame through Add Guide at frame 0. The guide
is not also inserted as a native reference video. No cached identity text,
character-swap/head-swap adapter, mask, source composite, realism LoRA, ControlNet,
TARA patch, camera-motion style LoRA or refinement pass is loaded.

The prompt assigns the photo's complete subject appearance, outfit, proportions,
texture, lighting character and environment. The video supplies pose, hands,
head, facial performance, timing, framing and camera movement. Prompt wording
and aligned conditioning are instructions, not proof of exact motion or identity.

## Resolution and media

- **Generated frames are sampled at the final canvas**, never scaled afterward.
  Portrait 9:16 uses 1088×1920 (H3's 32-pixel grid) and removes only the 4-pixel
  left/right grid borders to export 1080×1920. Landscape uses 1920×1088 with the
  same border removal. Other ratios follow the photo, short edge 1080, even
  dimensions, long edge at most 2160. No content crop to match the guide ratio.
- The original photo file is uploaded unchanged. Grid padding on its right and
  bottom prevents native reference encoding from rounding its dimensions by
  resizing. H3 still encodes the photo into latent/reference features; this is
  not pixel copying. Short edges over 2048 are rejected instead of silently
  triggering H3's reference downscale. Minimum edge 64, ratio at most 2:1/1:2.
- The **control video**, not the photo or generated output, is resampled to
  24 FPS and fitted uniformly into the photo's output canvas with padding.
  This preserves all its visible content without stretch, center-crop, camera
  stabilisation or optical-flow interpolation. It does not recover missing
  detail from a low-resolution guide. Its original upload is not overwritten.
- Source audio is retained on the prepared control MP4 and loaded separately
  for the final full timeline. No synthetic model audio is exported. Silent
  video does not attempt to load a nonexistent soundtrack.
- Duration 0.25–60 seconds is accepted, not silently shortened. Segments have
  at most 107 guide frames including context. Within a continuous shot, the
  preceding generated frame is an additional first-frame guide at the matching
  one-frame source overlap. Hard cuts reset that context. Each segment is padded
  with its own last frame to 17n+5; only real non-overlap frames are exported,
  without interpolation, crossfade or padding tails. This is a native-node
  adaptation of short-guide generation; long-take seam quality remains untested.
- Plus is mandatory in UI and server. Memory failure is surfaced; there is no
  lower-resolution fallback, automatic paid retry or retained idle GPU.

## What is and is not verified

Local checks cover actual FFmpeg inputs, orientation, photo/guide ratio,
duration/audio alignment, cut boundaries, every supported frame count, native
graph schemas and routing, no generated-image resizer/refiner, per-request
identity isolation, provider payload, explicit validation rejection and existing
queue/History regressions. No paid inference or Vanta browser login is performed.

**Not yet verified:** RunningHub installation of the three exact adapters,
native-node version, memory fit at this canvas/duration, seam quality and the
five visual goals (static camera, expression fidelity, photo texture, complex
camera moves and stable facial features). Selecting a 1080p canvas does not
establish native 1080p detail or superiority over Kling. The author examples
use 0.4 MP; Vanta's approximately 2 MP canvas is an unvalidated extension. A
provider graph rejection must be shown, not hidden by changing models or sizes.

## Primary sources

- [Motion Transfer recipes and model links](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/docs/motion-transfer.md)
- [Author native Guide Latents workflow](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/workflows/minimax_h3_motion_transfer_workflow_native_nodes_v1.0.json)
- [Native ComfyUI H3 schemas and implementation](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [BFS continuity and conditioning contracts](https://github.com/alisson-anjos/ComfyUI-BFSNodes/blob/main/bfs_shot_loop.py)
- [VideoHelperSuite audio/video loaders](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)
