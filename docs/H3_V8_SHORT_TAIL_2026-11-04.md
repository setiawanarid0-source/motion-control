# H3 v8: shorter final segments, unchanged five-frame history

4 November 2026. Owner-test candidate; visual improvement is not established.

## Problem and decision

The accepted v6 output (task `2117928878505025537`, 361 frames at 24 fps)
has a small residual texture change near 14 seconds, inside its final window.
That time is not a v6 join. V7 increased final history to 22 frames and peak
window size to 141; the owner rejected it. Do not repeat or promote v7.

V8 tests a different temporal intervention: shorten the newly generated tail
rather than carry more completed output into a longer final window. For inputs
above 333 frames, retain v6's first two windows and split the remaining output
after 68 new frames. The first tail window is 73 real frames including its
five-frame head; the last window needs at most 56 model frames. Every new
window receives the original photo and its matching source-video/audio slice.

This is a hypothesis about variation within the last long segment. The
attachment does not establish that segment length is the unique cause.
An extra join and another raw-history handoff can themselves introduce a seam
or accumulate appearance drift. Complete visual review remains required.

## Exact 361-frame timeline

| Window | Delivered indices, inclusive | Source load, inclusive | Model frames | History |
| --- | --- | --- | --- | --- |
| 1 | 0–123 | 0–123 | 124 | 0 |
| 2 | 124–242 | 119–242 | 124 | 5 |
| 3 | 243–310 | 238–310 | 73 | 5 |
| 4 | 311–360 | 306–360, then one grid pad | 56 | 5 |

The additional join is at 311/24 = 12.958333 seconds. Frame 336 at 14 seconds
is now 25 delivered frames into the last segment, rather than 93 into v6's
last segment. A 346-frame input delivers 124/119/68/35 frames with the same
real 73-frame predecessor; its final window has 16 grid-pad frames, just as
the v6 final window did. No synthetic future motion or discarded real time
is added. Every source time is exported exactly once.

## Scope and cost limits

- All inputs of 6–333 frames retain byte-identical v6 generation graphs.
- For 334–362 frames, all graph inputs for the first 243 delivered frames
  remain byte-identical to v6. This is graph equivalence, not a claim that
  separate provider renders reproduce the same pixels or noise.
- Five-frame raw AV continuation remains unchanged. The 73-frame predecessor
  is an exact native `17n+5` run containing no repeated grid padding. Its
  five-frame latent tail starts at phase zero, like the 124-frame predecessor.
- Models, pinned assets, prompt, dense attention, matched four-step recipe,
  original reference geometry, source soundtrack and CRF 12 remain unchanged.
- Peak target/reference window remains 124, not v7's 141. For 361 frames,
  aggregate model frames rise from 372 to 377. Sampling stages rise from
  three to four; total scheduler steps rise from 12 to 16. Steps and aggregate
  frames alone do not predict billed time, memory or cost.
- V6 already took 1588 provider seconds on the retained baseline. V8 has no
  measured GPU time or cost. Neither the 25-minute target nor successful
  completion within the provider's 40-minute limit is claimed.
- No resize, upscale, refinement, matching, sharpening, new adapter, first-frame
  photo pose pin, unsupported context-fusion node or paired render is added.
- Old v6/v7 task traces remain recognizable. Revision `akatz-native-1080-v8`
  and the UI's **Versi uji v8** identify the owner-test path explicitly.

## Validation

The frozen contract in `scripts/fixtures/h3-v6-short-tail-baseline.json` was
computed from the deployed v6 engine at commit
`d6817a9510690bc408705d83d041389c1368b699` before modifying it. Its aggregate
hashes cover 656 complete unaffected graphs and 58 affected early-window
subgraphs, across both audio modes. All 714 graph cases check exact source
coverage, real aligned raw tails, dependencies, trace classes, original photo
and audio links, native canvas/crop, frame count, no forbidden processing,
and the four-stage/16-step upper bound. Mocked provider-boundary checks verify
one user-initiated submission, and a missing saved schema proof still stops
before uploads. Existing execution-trace tests pass.

The upstream raw-tail helper was also exercised on 81 native grid/history
combinations, including 73-frame predecessors. This verifies slicing and
phase, not model inference or visual quality. No RunningHub generation,
schema-create request, model upload or paid comparison is initiated here.
The owner runs generation tests.

For acceptance, use the same clothed reference pair as the accepted v6 test,
retain native output, and review the entire timeline, particularly the new
12.958-second join and 13–15-second texture. Check identity, expression,
camera, outfit, audio timing, actual runtime and cost. Do not declare the
texture issue solved from CPU tests, CI or deployment health.

## Primary contracts

- [Core H3 reference/guide nodes](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
  define the native frame grid and image/video/audio reference roles.
- [Motion Context raw-tail implementation](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context/blob/1b22a326edc92e40f65c3ae86cccd062b20f6025/nodes.py)
  slices five-frame history directly from sampler AV latents on a phase-zero
  boundary. V8 does not change this installed typed contract.
- [Rejected v7 and restored baseline](H3_REGRESSION_ROLLBACK_2026-11-04.md).
