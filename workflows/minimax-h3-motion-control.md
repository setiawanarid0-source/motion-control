# H3 Motion Control in Vanta

The existing `minimaxH3` route uses the photo for subject/scene appearance and
aligned video frames for performance, expression, timing and camera movement.
The existing uploads, Plus Account Pool, durable queue, History and 72-hour
result retention are unchanged. No extra login, review form or head-swap UI.

## Production v6: photo-derived character appearance

**Visual acceptance failed after the owner's retest on 2 November 2026.**
Task `2117176682029084674` exposes lighting discontinuities at both window
boundaries, a source wrist accessory, changing torso appearance and unstable
fabric shading. The earlier short/full-duration inspection was insufficient to
approve this recipe. Read [the regression audit](H3_VISUAL_REGRESSION_2026-11-02.md)
before using the earlier trial results as evidence of quality. Successful
execution and improved facial consistency do not establish overall acceptance.

## Private native-pose candidate (not promoted)

`native-fun-pose4-caption` uses the official native Fun ControlNet route and its
matching optional four-step turbo with `res_multistep`. Source frames go through
SDPose body/hand/face extraction and drawing before reaching the control branch.
No source RGB enters Add Guide or a native reference-video slot. The current
whole native photo and one photo-derived caption define appearance. Only
previously generated frames can enter Add Guide for continuation; output frames
remain native 1080p with border/overlap trimming, original audio and no refiner.

The two-second clothed screen covers source time 2.25–4.25 s, where the wrist
accessory appears. It and the complete original fifteen-second case have distinct
checksum-locked, permanent once-only admissions. Neither starts on deployment.
Node/graph validation is separate from model execution and visual acceptance.
The ordinary default remains v6 pending actual checks; no success is claimed for
face, body proportions, lighting, texture, camera fidelity or runtime yet.

The provider accepted the exact control-patch name during a diagnostic graph
check but deferred an invalid UNET filename until execution. That unexpected
diagnostic acceptance was immediately cancelled. The inspection guard now uses
only a mandatory invalid ModelPatchLoader input, which was observed to reject
before execution. Do not infer runnable model availability from a generic
loader-name check or treat the cancelled diagnostic as a quality render.

## Existing v6 recipe

The first actual native-pose screen, task `2117225982289334273`, completed
48 native 1080×1936 frames (2.000 s, 24 FPS) in 197 provider seconds. The source
wrist scrunchie was absent in inspected frames, but torso proportions and fabric
shading remained insufficiently faithful. This is a rejected visual screen,
not a reason to promote the new candidate or start its full-duration run.

One separate private `native-fun-pose8-caption` comparison used the same exact
photo, two-second guide and seed with the matched DMD eight-step adapter,
Euler/simple and shifts 12/3. Task `2117229300269015041` completed 48 native
1080×1936 frames in 254 provider seconds. It did not justify promotion: the
source accessory stayed absent, but body/garment fidelity and mouth acting
were insufficient. Neither rejected screen started a full-duration render.

The next private four-step screen adds reference-aware skeleton retargeting
with `BodyRatioMapperProportionTransfer`, after native SDPose and before pose
drawing. It measures body ratios from the actual photo in an analysis branch;
the appearance reference retains its original pixels. The ratio solve covers
the whole source sequence once before window slicing, avoiding a new fit at
each join. Head locking and XY stabilization are disabled to retain movement.
This node's author supplies a RunningHub workflow, but availability and actual
quality in this deployment must still be checked. Ordinary generation is unchanged.
Source: https://github.com/wuwukaka/ComfyUI-BodyRatioMapper

The retarget-only two-second screen, task `2117232095663583234`, finished in
189 provider seconds. It was not promoted: garment detail and facial acting
still need improvement. No full-duration task was started from this screen.

The subsequent private `native-fun-retarget4-visual` screen removes generated
appearance descriptions and explicitly binds appearance to native `<Picture 1>`.
It draws body, hands, face and mouth at the model canvas resolution, rather
than enlarging an analysis-sized landmark raster. Saved raw/mapped/photo pose
previews allow checking that retargeting actually changes the skeleton. Motion
analysis loads at half canvas dimensions; the native photo/output stay intact.
For longer clips its generated continuation is 22 frames and is discarded only
as overlap, exporting every requested frame once. Full-duration continuity and
actual visual quality remain unvalidated; this is not the ordinary default.

The detailed visual screen `2117235194000134145` completed 48 native
1080×1936 frames in 168 provider seconds. The saved raw/mapped skeletons differ,
confirming that retargeting ran on this fixture. It remains rejected: facial
acting is weak and an invented prolonged blink appears in the short output.
The native photo-only prompt and pose path have not validated full-duration
lighting, material fidelity or the speed target. No full-duration task was started.

The private `native-fun-retarget4-face-performance` candidate supplies a
tightly bounded, tracked facial crop in native Ref2VA's video slot. Pose still
controls the body, while the current photo alone defines complete appearance.
It omits low-confidence facial dots from the pose raster to avoid conflicting
facial controls. This is a test of expression transfer, not a guarantee that
face appearance cannot leak. Before any full run, inspect every crop frame for
accessories, verify exact count/FPS, and check generated facial identity and
acting. `CropByBBoxes` can skip missing detections; this private candidate must
not silently shift the facial sequence when detections are missing.

Its short screen `2117265248348364802` completed in 213 provider seconds,
303.132 seconds from accepted submission to ready. Both render and facial crop
contain exactly 48 frames at 24 FPS (1080×1936 and 256×256 respectively). All 48
crop frames were inspected: no wrist scrunchie or outfit entered the crop.
Mouth acting improves and the invented prolonged blink is absent, while the
initial expression timing is still approximate. This supports a full-duration
trial for the owner's lighting/body/material regression, not a claim of perfect
expression timing. Full trial `2117267691572387841` is pending visual review.
Its photo is the supplied native 1143×2048 asset, not the unavailable native
1536×2752 upload from the reported run. Do not present this timing as a measured
result for that larger upload or upscale a preview to impersonate its original.

The separate `native-fun-retarget4-face-guard` candidate asserts that tracked
cropping returns the original source frame count and 256×256 pixels before any
sampling dependency can execute. A dropped detection or full-RGB fallback stops
the task; it never silently shifts the facial timeline. The subsequent 256×256
identity pass changes no valid crop geometry. This is a rejection guard, not a
replacement algorithm for missing detections. CPU tests against the upstream
MathExpression evaluator exercise exact admission and both rejection paths;
provider availability and a changed-reference GPU screen remain pending.

The changed-reference screen uses an unscaled native first frame of the previous
fully clothed pink-haired outdoor fixture, with the **current gym motion**. It
tests actual independent hair/outfit/scene binding rather than reusing a driver
whose scene already matches the reference. The photo is 1080×1842, SHA-256
`d28ac156ed7f71730a9b98acbd917b3a90b8ac8b1ec2b2d81606b0bd758711b8`.

**Both later trials remain rejected.** Full task `2117267691572387841`
completed 361 native 1080×1936 frames in 1407 provider seconds and 1616.450 s
overall (26m56.450s). Ceiling jumps remain at all three joins: -3.2283,
-2.9576 and -1.7025 gray levels at frames 107, 192 and 277. Longer continuation
did not enforce a continuous exposure; material/necklace detail also drifts.
The reference-change task `2117272674728497153` completes in 198 provider seconds
and retains pink hair, the main outfit and outdoor background, but removes the
reference's black gloves. Its actual GetImageSize/MathExpression execution and
48-frame facial crop verify helper availability and the frame-count guard.
The preceding invalid-loader probe was capacity-rejected (421 / TASK_QUEUE_MAXED)
on the inspection account; it was not an accepted render and was not retried.

The next private `native-fun-global4-face-attributes` candidate uses the model's
native 362-frame window: the 361 requested frames plus one explicit terminal
padding frame, trimmed after decode. It has one sampler for this full 15-second
fixture, removing independently sampled joins and recursive generated-RGB
continuation from that clip. It keeps the matched native four-step student.
To test runtime feasibility it uses INT8 dense Kitchen attention and Sol sparse
attention from the first step, dense blocks 0/1 and exact conditioning KV. These
are approximate acceleration methods and require fresh visual and GPU checks;
no speed or appearance claim follows from constructing the graph.

A deterministic current-photo inventory names only visible hair, clothes,
coverage, hand coverings/accessories, scene and lighting. It excludes body/beauty
descriptions and is appended to fixed Picture/Video role assignments. Native
photo pixels remain the body/identity reference. The changed-reference screen
must retain its gloves before this candidate can progress. Longer inputs keep
all requested frames in bounded native windows; their joins are not validated
by a successful single-shot 15-second fixture.

The actual full-shot short screens completed on 2 November 2026:

| Fixture | Provider task | Output | Provider execution | Submission to ready |
| --- | --- | --- | --- | --- |
| Current gray shirt, source 2.25–4.25 s | `2117278933011746817` | 1080×1936, 48 frames, 24 FPS | 177 s | 188.541 s |
| Pink hair / white blouse / brown costume / black gloves | `2117278980688408577` | 1080×1842, 48 frames, 24 FPS | 164 s | 176.898 s |

Every output frame was inspected in contact sheets. The gray fixture does not
copy the source wrist scrunchie; the second fixture retains black gloves and
thin metal glasses, including while the gloved hand reaches the mouth. Native
face crops at frames 0 and 47 were checked against the second photo to confirm
the glasses. These screens justify a full-duration trial, not production
promotion or a guarantee of exact 3D body volume, every facial microexpression,
lighting or texture across longer clips. Full task `2117280220814069761` uses
the original 15-second driving asset and the 1143×2048 photo.

That full task finished at native 1080×1936 / 24 FPS / 361 frames. Provider
execution was 972 s; submission to ready was 991.224 s (16m31.224s), including
19.224 s not isolated between queue, allocation, API and delivery. The exact
source photo from the owner's failed 1536×2752 run is unavailable; this timing
belongs to the 1143×2048 fixture only.

**Rejected for promotion.** Independently sampled joins are gone: across all
361 frames the largest adjacent ceiling-ROI change is 0.8316 gray levels,
compared with 8.2128 in the owner's failed result. The ROI starts at 39.9959 and
ends at 46.0103, so gradual illumination drift is not claimed eliminated. Native
inspection of frame 48 / 2 s finds an unrequested silver watch/band on the
left wrist. The photo does not show that accessory. Fine shirt detail is also
re-synthesised. A working full shot and an improved jump metric do not establish
complete appearance fidelity.

All 361 source face crops were inspected: fingers overlap the mouth in some,
but no silver watch is visible in that input. It is therefore not established
that this accessory came from the cropped performance. Reproduce and inspect
the photo inventory before assigning its cause to RGB leakage or pose control.

Private pose/crop exports can be disabled independently of inference. Normal
preflight disables those diagnostic files. The retained inference nodes are
byte-equivalent to the corresponding private candidate; no generated-frame
processing or model change accompanies removal of the diagnostic exports.

A matched eight-step comparison keeps this same whole-photo, pose retargeting,
guarded face sequence, factual inventory, native window and sparse policy. It
uses the already-executed DMD eight-step adapter with Euler/simple and shifts
12/3, with sparse thresholds computed after that shift. This is a comparison
of two matched inference recipes, not a claim that changing only the numeric
step count isolates every effect. Native-size short crops still re-synthesise
the shirt's fine detail, so the eight-step screen checks whether the matched
recipe materially improves that detail before any additional full render.

Eight-step short task `2117283756327129089` completed 48 native 1080×1936
frames in 224 provider seconds. Its native-size shirt detail does not establish
a sufficient material improvement. No full eight-step task follows from this
screen. Both recipes remain private.

The checksum-locked `native-photo-inventory-check` is a separate text-only
diagnostic: it executes only LoadImage, the same caption CLIPLoader and
TextGenerate settings, and SaveText. It has zero video samplers. The private
expiring route can read its own text; ordinary task text and raw provider
payloads never enter the timing log. This reproduces the inventory with the
same input/settings; it does not recover an unrecorded historical output.

Inventory task `2117287686293516290` executed without video samplers and
returned its text both through the private execution callback and SaveText.
It explicitly describes no jewelry on the fingers or wrists, and a thin gold
necklace. This reproduction does not explain the silver wrist accessory and
does not justify blaming the caption. The descriptor incorrectly calls the
partly visible setting an office, so scene categories remain untrusted labels;
the native image, rather than the generated description, is the scene reference.

The next private comparison, `native-fun-global4-warm-photo`, changes only the
sparse start fraction from 0 to 0.2. This restores a dense opening evaluation,
as recommended in the native attention documentation, before the accelerated
evaluations. The base/student, sampler, pose fit, face input, caption, seed and
export are held constant. This is not yet evidence of appearance fidelity or
acceptable full-duration timing. A new 0–3.5 s fixture specifically includes
the early frames where the unrequested watch first appeared; both that fixture
and a changed-photo fixture must be checked before its full-duration admission.

Normal submissions now use `guide-dmad4-character-caption`, the same graph as
the completed short, full-duration and changed-reference trials. Character Swap
v1.1 replaces Motion Transfer v1.0; the existing DMAD four-step student,
LCM/simple sampler, CFG 1, Sigma Shift 12/2 and exact-reference Sol-Attn remain.
The task model is SHA-256/size pinned and provisioned through the official
RunningHub upload path, with per-account durable upload caching.

The current whole native photo supplies appearance. Qwen3.5 9B describes that
photo once; every window consumes that same description and original reference.
No fixed hair/outfit caption, second face crop or first-frame photo resize is
used. Later windows replace the first five guide frames with the matching five
generated overlap frames. Only real frames are exported, once each. Existing
accepted provider graphs are not changed or resubmitted.

### Completed visual continuation checks, 2 November 2026

| Trial | Provider task | Provider time | Submission to ready | Actual output |
| --- | --- | --- | --- | --- |
| Same photo, first five seconds | `2117124302247911425` | 549 s | 568.087 s | 1080×1936, 24 FPS, 120 frames, 5.000 s |
| Same photo, complete source | `2117131431696486402` | 1488 s | 1493.431 s | 1080×1936, 24 FPS, 361 frames, 15.041667 s |
| Distinct public reference and driver | `2117131534394019842` | 481 s | 495.415 s | 1080×1842, 24 FPS, 120 frames, 5.000 s |

The full input's video track is 15.033008 seconds; the output follows the
24 FPS frame grid. The complete measured run took 24m53.431s, within the
25-minute target for this input. This is one measured case, not a speed
guarantee for other inputs, durations or worker allocations.

Inspection includes the beginning, middle, end and both window transitions.
The same gray crew-neck short-sleeved T-shirt, black shorts and dark brown hair
remain visible throughout the complete clothed case. The source crop top,
loose trousers, light hair and wrist scrunchie do not return. Head/mouth/hand
movement continues across the windows. The distinct public reference produces
pink hair, a white blouse, brown skirt and black boots instead of reusing the
first photo's appearance. Its moving-camera result is not a full-duration
camera-fidelity benchmark.

Facial proportions and fabric shading still vary somewhat, especially during
movement. These checks support promoting the improved appearance recipe; they
do not establish pixel-identical faces, texture locking, arbitrary backgrounds,
all camera moves or every supported duration. No generated media, private input,
credential, signed URL or inferred identity is committed to this repository.

## Previous production v5: matched four-step inference

Ref2VA INT8 → DMAD four-step student → Motion Transfer v1.0 → Kitchen attention
selection → H3 Sigma Shift 12/2 → native Sol-Attn → scheduler AND every guider.
Sampling is LCM/simple, CFG 1, four steps. The exact turbo asset is
`minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors`.
The checkpoint author's re-noise sampling contract is used. The old eight-step
DMD adapter is not sampled with an arbitrarily shortened schedule. The
training-only adapter remains omitted.

Sol-Attn uses tau 1.0, start 20%, end 100%, first two blocks dense, minimum
12288 tokens and 256 extra tokens. The patch is AFTER Sigma Shift, so sigma
thresholds are calculated from the actual H3 schedule. At four steps the first
step is dense and the other three permit sparse attention. Native `exact_kv`
retains every query's exact attention to the packed text/reference keys. The
additional dense target-audio query rows are not requested: generated audio is
not exported; the original soundtrack is copied. Kitchen may fall back to
PyTorch; successful rendering does not establish which kernel or GPU was active.

Every window receives the same current whole photo as Picture 1 and its aligned
source frames through Add Guide at frame 0. The video is not also encoded as a
native reference video. The bundled, checksum-verified MIT YuNet detector can
supply Picture 2, a native-pixel face crop from the SAME current photo. It runs
locally on the CPU, selects exactly one confident face, and skips no/multiple
faces. Detector working images never replace the original H3 reference.

The additional crop has a 524288-native-pixel budget. Context margins range from
2.5× down to 1.25× while keeping the entire visible detected face. If that does
not fit, only the original whole photo is used. No crop is resized. Python and
the JS/graph boundary enforce the limit; user inputs never get fixture coordinates.
No cached identity, external face-detection service, face restoration, mask,
source composite, character/head-swap adapter or refinement pass is used.

## Why the previous fifteen-second pipeline remained slow

V3/v4 still used three sequential eight-step windows: twenty-four sampling steps.
Reducing a redundant face crop did not remove those model evaluations. Actual
approximately fifteen-second requests spent about fourteen minutes per window
and terminated during window three after approximately forty minutes. Their
provider response was code 805; the once-only metadata audit could not classify
the failure. A provider timeout is not inferred solely from elapsed time.

V5 uses three four-step windows: twelve total model steps. The change applies
to NEW submissions. An already accepted provider graph is immutable and is
neither restarted nor automatically rerendered during deployment.

## Completed native fifteen-second benchmark

Task `2116932735218311170` used the selected four-step recipe on Plus:

| Measurement | Actual value |
| --- | --- |
| Full provider workflow execution | 1522 s / 25m22s |
| Submission to ready result in History | 1543.384 s / 25m43.384s |
| Sampler windows | 419.51 s, 428.56 s, 430.69 s |
| Sum of observed sampling | 1278.76 s / 21m18.76s |
| Real output | 360 frames, 24 FPS, exactly 15.000 s |
| Generated canvas / border-cropped export | 1088×1952 / 1080×1924 |
| Output file | 29971274 bytes, H.264 |

The reference is a reviewed, fully clothed native 1600×2850 crop of NASA/Robert
Markowitz's public-domain 2013 portrait. After grid padding it contributes
4.608 million reference pixels, versus approximately 4.588 million whole-photo
plus face-crop pixels in the slow production request. Both use the same model
canvas. The public clothed guide is looped from five to fifteen seconds. The
benchmark is artificial motion transfer, not an actual recording or endorsement
by the person depicted. It is not a rerender of a private explicit upload.

The complete timing is 43.384 seconds ABOVE the 25-minute target. No rounding,
queue subtraction or earlier success timestamp is used to claim that target was
met. Worker allocation was not independently established; this measured fixture
is not a fixed-latency guarantee for every input. The earlier 13m38s five-second
small-reference fixture did not represent large native-portrait inputs.

Broad hair/clothing colour remained visible in inspected frames, but guide-scene
leakage and changing small clothing markings were also visible. Exact facial
geometry, texture, photo-scene preservation and all five motion goals are NOT
established by this speed check. The selected model remains generative. The
looped driver also does not prove fidelity on every continuous fifteen-second
camera move or expression. Visual acceptance remains separate from timing.

## Timeline and spatial contract

- Generated pixels are sampled at the final canvas and are never scaled after
  decoding. A 9:16 photo uses 1088×1920; removing only four-pixel left/right grid
  borders exports 1080×1920. Landscape uses corresponding top/bottom borders.
  Other photo ratios use a 1080 short edge, even dimensions and long edge ≤2160.
  There is no output upscale/downscale, interpolation, refiner or face edit.
- Untagged RGB photos remain byte-for-byte unchanged. ICC-tagged references are
  converted to sRGB with LittleCMS at unchanged dimensions, saved losslessly,
  without overwriting the upload. EXIF orientation is respected. Invalid profiles
  and HDR/16-bit references fail before payment; no silent tone mapping. Right
  and bottom grid padding prevents native dimension rounding through resize.
  Reference short edges >2048 and ratios outside 2:1/1:2 are rejected.
- Only the control video is uniformly fitted/padded to the photo canvas at
  24 FPS. No source-content crop, stretch, stabilisation or flow interpolation.
  Audio stays aligned to the full timeline; silent clips load no missing audio.
- Accepted duration remains 0.25–60 seconds. Each native window has at most 124
  model frames. Five seconds uses one window / 124 model frames, exporting all
  120 real frames. Fifteen seconds uses three windows. Later windows include
  five matching source/generated-frame overlap frames in v6 (one in v5). All model padding and overlap
  frames are trimmed; every real output frame appears once.
- Scene-change heuristics are diagnostic only. Pans, roll, flashes and actual
  cuts in the guide do not create extra independent sampling windows. There is
  no crossfade, hidden truncation, FPS reduction from the existing H3 contract
  or lower-resolution fallback. Native detail absent from the input cannot be
  guaranteed merely by choosing a 1080p canvas.

ICC management prevents tagged-input misinterpretation, not palette/lighting
locking. No LUT, histogram matching, denoising, grading or refinement is applied.
H.264/YUV420 encoding is not lossless RGB copying. A colour difference alone
neither demonstrates resizing nor proves preserved photo appearance.

## Verification and observability

`npm run check` covers actual FFmpeg orientation/audio/timebase, all supported
frame lengths, minimum window count, matched turbo/sampler/shift/step defaults,
HTTP/queue routing, native output graph, identity bounds/checksum, ICC handling,
explicit graph rejection, no duplicate paid retry and existing Vanta regressions.
The actual GPU benchmark additionally verifies provider availability, memory fit
for this canvas/duration and a complete native output file. Other durations and
inputs remain subject to measured acceptance rather than extrapolated promises.

The server records profile, actual sampling recipe, canvas/output dimensions,
window count, frame ranges and bounded reference metadata. A read-only observer
records node/progress timings, without binary previews, private URLs, prompts
or raw errors. Polling remains authoritative. Missing progress cannot fail or
restart a paid task. Provider workflow time is distinct from total History time.
Failed H3 task metadata is queried once to classify runtime limit, cancellation,
memory exhaustion or unclassified failure, without changing terminal timestamps,
credentials, archives or state. No reason is invented from a generic code 805.

The explicit long-trial helper has pinned public asset hashes, a bundled 1.43MB
portrait and a deployment-only opt-in on `/data`. A permanent exclusive checkpoint
prevents another paid run even beyond queue expiry. The opt-in has been cleared.
An earlier preparation failure never entered the provider queue; the corrected
trial is blocked if an earlier durable queue record exists. There is no public
benchmark route or automatic paid fallback.

## Primary sources

- [Motion Transfer recipes](https://github.com/alisson-anjos/Henge/blob/17034b701ba37f5768f30a56e64c974488788b92/docs/motion-transfer.md)
- [DMAD checkpoint and LCM/simple sampling](https://github.com/Yzmblog/DMAD/blob/main/README.md)
- [Henge converted turbo filenames](https://github.com/alisson-anjos/Henge/blob/main/config/model-repos.example.json)
- [Native H3 nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [Native sparse attention](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_sparse_attention.py)
- [Sigma threshold semantics](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy/model_sampling.py)
- [VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)
- [YuNet source and license](../models/h3-identity/README.md)
- [Public portrait attribution](../test-fixtures/h3/README.md)
