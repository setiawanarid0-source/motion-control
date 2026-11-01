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
- Untagged RGB photos are uploaded byte-for-byte unchanged. Photos with an ICC
  profile are converted to sRGB with LittleCMS, at unchanged pixel dimensions,
  and saved losslessly as PNG. The original upload is not overwritten. This
  prevents the native loader from interpreting tagged colour values as untagged
  RGB. EXIF orientation is included when planning dimensions. Invalid profiles
  and HDR/16-bit references fail before a paid task; no silent tone mapping.
  Grid padding on the reference's right and bottom avoids native dimension
  rounding by resizing. H3 still encodes/reconstructs latent features rather
  than copying pixels. Short edges over 2048 are rejected instead of silently
  triggering reference downscale. Minimum edge 64, ratio at most 2:1/1:2.
- The **control video**, not the photo or generated output, is resampled to
  24 FPS and fitted uniformly into the photo's output canvas with padding.
  This preserves all its visible content without stretch, center-crop, camera
  stabilisation or optical-flow interpolation. It does not recover missing
  detail from a low-resolution guide. Its original upload is not overwritten.
- Source audio is retained on the prepared control MP4 and loaded separately
  for the final full timeline. No synthetic model audio is exported. Silent
  video does not attempt to load a nonexistent soundtrack.
- Duration 0.25–60 seconds is accepted, not silently shortened. Each model window
  has at most 124 guide frames including context. A five-second, 120-frame clip
  uses **one sampler / 124 model frames**, trimming four padding frames. A short
  clip is not restarted at a heuristic cut: its guide still contains the cut.
  The previous 106-frame cap incorrectly split five seconds into two 73-frame
  generations with different noise seeds at 2.5 seconds. This avoidable restart
  has been removed. For longer clips, within a continuous shot, the
  preceding generated frame is an additional first-frame guide at the matching
  one-frame source overlap. Hard cuts reset that context. Each segment is padded
  with its own last frame to 17n+5; only real non-overlap frames are exported,
  without interpolation, crossfade or padding tails. This is a native-node
  adaptation of short-guide generation; long-take seam quality remains untested.
- Plus is mandatory in UI and server. Memory failure is surfaced; there is no
  lower-resolution fallback, automatic paid retry or retained idle GPU.

## Colour and runtime diagnostics

ICC normalisation prevents a colour-management defect at the reference input;
it does **not** lock the generative model's palette, lighting or skin texture.
Full RGB guide conditioning can still influence generated appearance. No
histogram matching, LUT, colour-grading, denoise or refinement pass is added.
The export is H.264/YUV420 BT.709; RGB-to-YUV encoding is distinct from image
resizing and is not lossless pixel copying. A source/result colour difference
does not by itself prove an upscale or refinement operation.

The server records each new H3 request's canvas, output size, actual sampler
count, guide frame windows and reference colour metadata (never pixels or keys).
Provider `taskCostTime` is retained as workflow execution seconds, not summed
across output files. It is not labelled exclusive GPU time. The existing total
History duration still starts at submission and is never reduced to hide waits.

A bounded, read-only audit queries up to two previously completed H3 Motion
Control tasks per existing monitor tick, once per task. It retrieves timing
metadata using the task's existing credential and preserves the completion
timestamp, result, archive and terminal state. It never creates a render. The
difference between observed total duration and reported execution includes
unmeasured queue/allocation/poll/delivery overhead; it is not called queue time.

One model window removes the observed artificial 2.5-second restart. A longer
window can increase peak memory and does not establish faster rendering. Actual
runtime and visual quality must be measured on a non-explicit GPU benchmark.

## What is and is not verified

Local checks cover actual FFmpeg inputs, orientation, photo/guide ratio,
duration/audio alignment, cut boundaries, every supported frame count, native
graph schemas and routing, no generated-image resizer/refiner, per-request
identity isolation, ICC transforms without spatial changes, provider timing,
unchanged historical completion times, provider payload, explicit validation
rejection and existing queue/History regressions. No paid inference or Vanta
browser login is performed.

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
