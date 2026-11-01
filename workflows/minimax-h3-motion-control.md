# H3 Motion Control in Vanta

The existing `minimaxH3` option animates the uploaded photo using aligned video
frames. The photo supplies the whole appearance and scene; the video supplies
performance, expressions, timing and camera movement. The existing two uploads,
Plus Account Pool, durable queue and History remain the entry points.

## Production graph: motion-transfer-native-1080-v4

Ref2VA INT8 → DMD Ref2VA 8-step → Motion Transfer v1.0 → native Kitchen attention
selection → H3 Sigma Shift 12/3 → Sol-Attn → both scheduler and guider. The
training-only adapter is omitted. Sampling remains CFG 1, Euler/simple, eight
steps with the matching DMD adapter. No unrelated style, character/head swap,
ControlNet, TARA, face-restoration or refinement model is loaded.

Sol-Attn is the native training-free selection, tau 1.0, first two blocks dense,
start 20%, end 100%, minimum 12288 tokens, 256 extra tokens, with
`exact_kv_and_rows` reference conditioning. The sparse patch must come AFTER
Sigma Shift: it captures sigma thresholds from the upstream sampling object.
At shift 12 the first two of eight steps are dense and the remaining six permit
sparse attention. Both scheduler and every guider receive the patched model.
Kitchen can fall back to PyTorch; a valid node does not prove its kernel is active.
The unrelated native proxy is not evidence of the OpenAPI worker GPU or kernel.

Every window receives the same current whole photo as Picture 1 and all aligned
source frames through Add Guide at frame 0. The video is not also supplied as a
native reference video. A bundled, checksum-verified MIT YuNet detector locally
finds one confident face on the CPU. If found, Picture 2 is a grid-sized crop from
the SAME original photo, explicitly bound to the same subject's facial identity.
The crop is not resized and never replaces or edits a generated face. No face or
multiple faces means the whole-photo reference remains without Picture 2.
Detector working images never replace the original H3 reference. No external
face-detection service, cached identity or fixture coordinates are used for users.

The extra face reference has a hard budget of 524288 native pixels. For small
faces it retains the existing 2.5× bounding-box context; larger faces use a
tighter margin down to 1.25× while keeping the entire visible detected face.
If that cannot fit, only the whole original photo is used. Neither photo nor
crop is resized. The Python detector, JS boundary and graph compiler enforce
the budget, so an oversized optional reference cannot reach paid sampling.

Prompt wording and aligned conditioning express the requested appearance and
performance; they do not guarantee exact identity, texture, colour or camera.

## Timeline and native output

- Sampling uses the final output canvas. A 9:16 photo uses 1088×1920, then only
  the four-pixel left/right grid borders are removed for 1080×1920. Landscape
  uses the corresponding vertical border removal. Other photo ratios use a
  1080-pixel short edge, even dimensions and a long edge no greater than 2160.
  There is no output resizer, upscale, refiner, interpolation or face-edit pass.
- Untagged RGB photos remain byte-for-byte unchanged. ICC-tagged photos are
  converted to sRGB with LittleCMS at unchanged dimensions, saved losslessly,
  without overwriting the upload. EXIF orientation is respected. Invalid profiles
  and HDR/16-bit references fail before payment; no silent tone mapping. Right
  and bottom grid padding avoids encoder dimension rounding through resize.
  Reference short edges above 2048 and ratios outside 2:1/1:2 are rejected.
- Only the control video is fitted uniformly into the photo canvas with padding
  and sampled at 24 FPS. There is no stretch, content crop, stabilisation or
  optical-flow interpolation. Its upload remains unchanged. Source audio is
  aligned to the full timeline; silent inputs never load nonexistent audio.
- Supported duration is 0.25–60 seconds. A five-second clip has 120 real frames
  in ONE 124-frame model window. Four repeated padding frames are trimmed.
  The old 106-frame cap caused an unnecessary identity restart at 2.5 seconds.
- Longer clips use the minimum number of balanced native windows, at most 124
  frames each, with one matching source/generated-frame overlap. Fifteen seconds
  uses three samplers. Scene-change heuristics are diagnostic only: camera roll,
  pans, flashes and actual guide cuts cannot multiply independent render windows.
  Every real guide frame is exported once, with no crossfade, dropped frames or
  padding tails. Long-take seam quality and 15-second runtime remain unmeasured.
- Plus is mandatory. Memory/graph failures are surfaced without changing models,
  lowering resolution, retrying a paid render or retaining an idle GPU.

Colour management fixes tagged-input interpretation, not a generative model's
palette or lighting drift. No histogram matching, LUT, colour grade or denoising
post-pass is applied. H.264/YUV420 export is not lossless RGB copying. Native
canvas sampling also does not prove recovery of details absent in the photo.

## Actual render checks on 2026-11-01

All renders used the same reviewed, fully clothed public five-second fixture,
120 real frames at 24 FPS, native 1080×1842 export from a 1088×1856 canvas,
eight sampling steps and Plus mode. Provider-reported execution, not an estimate:

| Profile | Runtime | Decision |
| --- | --- | --- |
| Adapter omitted, dense attention | 22m21s | Face/accessory drift remained |
| Correctly ordered Sol-Attn, exact reference conditioning and same-photo face crop | 13m38s | Selected production recipe; glasses retained in inspected frames |
| Sol-Attn with reference attention approximated | 10m11s | Rejected for production: glasses disappeared |

The selected test was task `2116821832200179713`. Its sampling node accounted
for about 698.5 seconds of the 818-second provider runtime. Worker hardware was
not independently established and allocations can vary; these single runs do not
guarantee the same speed on another photo. The fixture face is small and synthetic;
retaining glasses is an observed improvement, not proof of identical facial
geometry. Outfit, scene and texture differences remain possible. The general
face-localization helper was exercised with actual OpenCV 4.6 and the same photo;
the selected GPU test used an explicit crop of that fixed fixture.

The matching TARA alternative was rejected by RunningHub for a missing native
node. It is not used in production. The incorrectly ordered sparse comparison
was stopped only after explicit provider cancellation acknowledgment.
One-off benchmark staging and cancellation startup hooks have been removed, so
redeployment cannot repeat those paid tests. The isolated fixture helper remains
available for local regression checks with no credentials or inference calls.

### Fifteen-second DMAD validation (private until measured)

The selected production eight-step recipe remains unchanged during this test.
The separate `guide-dmad4-focus` profile uses the Kijai-converted DMAD four-step
student (`minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors`),
LCM/simple re-noise sampling, CFG 1 and video/audio shifts 12/2, following the
DMAD checkpoint author's sampling contract. This is not a shortened schedule
using the old eight-step DMD adapter. The Motion Transfer task, native canvas,
whole-photo reference and original audio export stay the same. `exact_kv`
keeps every query's reference attention exact, while omitting the extra dense
target-audio query rows for generated audio that Vanta does not export.
Fifteen seconds still uses three native windows, now twelve rather
than twenty-four total sampling steps. Runtime and visual fidelity must be
measured before promotion.

The reviewed reference is a native 1600×2850 crop of NASA/Robert Markowitz's
public-domain 2013 Samantha Cristoforetti portrait. The generated benchmark is
an artificial motion-transfer test, not a recording or endorsement by the
person depicted. Its padded reference contains 4.608 million pixels, compared
with approximately 4.588 million whole-photo-plus-face reference pixels in the
slow production task. Both use the same 1088×1952 model canvas. The fully clothed
public guide is looped to exactly 360 frames/15 seconds. No reference/output
resizing, post-generation interpolation or refiner is used.

Both source files have pinned hashes; the 1.43MB public-domain portrait is bundled
to avoid external image-host failures during deployment preparation. Starting this trial requires the exact
deployment-only `VANTA_H3_LONG_BENCHMARK` opt-in on `/data`; a permanent exclusive
checkpoint prevents another paid submission even after queue retention expires.
No route, owner login or private upload is used. Unknown acceptance, rejection
and download failure cannot auto-retry. Normal requests cannot select the
private profile from a browser body. The opt-in is cleared after staging.

A bounded once-only metadata audit classifies failed H3 tasks as runtime limit,
cancelled, memory exhaustion or unclassified, using their retained credentials
without exporting them. It never changes terminal timestamps, submits or
cancels a render. This distinguishes a provider time limit from a user stop;
ending around forty minutes alone is not proof of either cause.

## Verification and observations

`npm run check` covers actual FFmpeg orientation/audio/timing, all supported
frame lengths, minimum window count, native output routing, default HTTP/queue
profile selection, same-photo identity bounds/checksum, no output resize/refine,
ICC handling, explicit graph rejection and existing queue/History regressions.
No owner login or browser session is needed for these technical checks.

The server records canvas/output dimensions, profile, sampler count, frame windows,
reference colour metadata and optional face coordinates, never pixels or keys.
A read-only observer captures actual native-node/progress timings without binary
previews, private URLs, prompts or raw errors. Polling remains authoritative;
missing progress cannot restart or fail a paid task. Provider `taskCostTime` is
kept separate from total History elapsed time, which includes waiting/delivery.
Previously completed task timings can be read without changing their timestamps,
archives or terminal states. Result retention and account retirement are unchanged.

The five requested visual goals, identity across all inputs and 15-second render
speed are not proven by these tests. Visual review must assess the actual output.

### Production input regression found after the fixture checks

A later five-second native-portrait task on v3 took 1243 provider seconds
(20m43s); its sampler alone took about 1115 seconds (18m35s). The request used
the intended profile and one 124-frame model window, not an older deployment.
Its 1533×2734 original photo also produced a 1024×1408 extra face crop: 1441792
additional native pixels, about 47 times the fixture crop. Native reference
tokens participate in every sampling step. Therefore small-fixture runtime is
not a representative acceptance result for that larger input, and limiting
only output resolution/frame count was insufficient.

V4 bounds this redundant extra reference without changing the whole photo,
output size, number of steps or exact reference attention. A 400×560 detected
face on a 1533×2734 portrait now produces a 512×704 crop (360448 pixels), rather
than 1024×1408. This is a checked input-cost reduction, not a measured GPU speed
claim; no new runtime or facial-fidelity guarantee follows from the unit test.
The primary `ref_image_size=max` reference is intentionally retained at native
dimensions. It can still dominate cost. Existing accepted tasks are untouched.

The earlier head/hair implementation used a different Character Swap task model,
lower-resolution generation and source compositing; the current pipeline uses
Motion Transfer. Its facial behavior cannot be assumed identical. Returning to
that whole old graph would reintroduce resizing/compositing and would not satisfy
the present full-photo/native-output contract. Facial regression remains
unresolved without a controlled comparison; the budget fix does not claim it.

## Primary sources

- [Motion Transfer recipes](https://github.com/alisson-anjos/Henge/blob/17034b701ba37f5768f30a56e64c974488788b92/docs/motion-transfer.md)
- [Native Guide Latents workflow](https://huggingface.co/Alissonerdx/Minimax-H3-ComfyUI/blob/main/workflows/minimax_h3_motion_transfer_workflow_native_nodes_v1.0.json)
- [Native H3 schemas](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [Native sparse attention](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_sparse_attention.py)
- [Sigma threshold semantics](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/model_sampling.py)
- [VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)
- [Bundled YuNet source and license](../models/h3-identity/README.md)
- [DMAD sampling and checkpoint documentation](https://github.com/Yzmblog/DMAD/blob/main/README.md)
- [Henge supported turbo filenames](https://github.com/alisson-anjos/Henge/blob/main/config/model-repos.example.json)
- [NASA public-domain portrait and original file](https://commons.wikimedia.org/wiki/File:Samantha_Cristoforetti_official_portrait.jpg)
