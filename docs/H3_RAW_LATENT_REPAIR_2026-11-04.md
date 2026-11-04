# H3 raw latent continuation repair — 4 November 2026

## Change

Revision `akatz-native-1080-v6` changes the actual Akatz generation graph.
Later windows now consume the previous SamplerCustomAdvanced AV latent through
MiniMaxH3MotionContext. The previous decoded ImageFromBatch -> AddGuide ->
VAE encode feedback path is removed.

This removes the extra video VAE reconstruction between completed windows.
It does not remove all autoregressive dependence: later generation still reads
previous generated latent content. It is a repair to a plausible degradation
mechanism, not a completed visual acceptance test.

Every predecessor now contains 124 real source frames and no padding.
Only the final window may repeat the final source frame to fill the native
17n+5 grid. This matters because the node slices the MODEL latent tail; slicing
a padded predecessor would carry the wrong source moment into the next window.

| Delivered input | New output frames by window | Model input frames | Padding |
| --- | --- | --- | --- |
| 125 | 124, 1 | 124, 22 | final 16 |
| 346 | 124, 119, 103 | 124, 124, 124 | final 16 |
| 361 | 124, 119, 118 | 124, 124, 124 | final 1 |
| 362 | 124, 119, 119 | 124, 124, 124 | none |

The 361-frame source windows load at 0, 119 and 238; their five-frame
context prefixes are discarded, exporting 0–360 exactly once.
Context remains five frames to retain at most three native four-step samplers.
The original photo, source-performance reference, native canvas/crop,
source soundtrack, models/LoRAs, dense attention, scheduler and CRF remain
unchanged. No scaling, refinement, sharpening or seed change was added.

## Provider evidence and gate

On the actual RunningHub Plus workflow validator at
2026-11-04T09:03:59.325Z, MiniMaxH3MotionContext registration and the connected
conditioning/latent schema were recognized. Every probe was rejected on the
deliberately nonexistent LoadImage input. No task ID was created, sampler
included, model uploaded or GPU generation requested. The separate
MiniMaxH3ContextWindows candidate remains unsupported and disabled.

A stricter v2 check additionally connects CLIP to context_latent and requires
the provider to reject that exact field with return_type_mismatch. This
distinguishes an actual optional LATENT input from an ignored unknown field.
The positive check also consumes output 1 as an INT batch index. Both outputs
depend on the invalid image; there is still no sampler.

Multiwindow task submission is blocked BEFORE media/model uploads unless the
persisted owner-only v2 report contains all four expected results, including
the typed-input negative control and positive signature. There is no fallback
to the old RGB feedback and no automatic paid qualification render.

## Validation

- 714 duration/audio graph cases (6–362 frames, audio present/absent): exact
  source timeline, no padded predecessor, raw previous-sampler link, unchanged
  photo/driver/native geometry/audio/model recipe, bounded step count.
- Historical v1–v5 progress-node mappings remain available; v6 maps the new
  Motion Context node without relabelling old running tasks.
- The submission boundary is exercised with fake provider/model receipts.
  Compatibility is checked before uploads; missing proof cannot submit a task.
- CPU-only extraction of the publisher's exact raw tail helpers from nodes.py
  blob `1b22a326edc92e40f65c3ae86cccd062b20f6025`: 81 legal
  clip/context cases retain identical latent values and native temporal phase;
  invalid phase refuses. NumPy models slicing/clone only, not H3 execution.
- Existing context-candidate checks still pass; that unsupported candidate
  remains disconnected from ordinary generation.
- No GPU execution, measured runtime or visual texture acceptance is claimed.
  Complete output still needs review for texture, seams, identity, motion,
  expressions and camera. The runtime node's own layout check may still reject
  an incompatible worker ABI.

## Sources

- [Motion Context publisher source](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context/blob/main/nodes.py):
  raw AV latent slicing and five-frame context contract.
- [Publisher notes](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context):
  avoids the decode/encode round trip; does not claim complete drift removal.
- [Earlier workflow comparison](H3_TEXTURE_WORKFLOW_COMPARISON_2026-11-04.md):
  KOH, Alissonerdx, Akatz, linoyts and multishot differences.

