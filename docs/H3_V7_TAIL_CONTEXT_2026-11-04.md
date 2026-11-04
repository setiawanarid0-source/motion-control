# H3 v7: longer native history in the final window

**Status: rejected and rolled back to the v6 generation graph after the owner
reported no improvement and worse quality. This file records the historical
v7 experiment, not the active configuration.** See
H3_REGRESSION_ROLLBACK_2026-11-04.md. Historical candidate contracts are retained
in docs/fixtures/h3-v7-rejected-contract.json; they are not visual acceptance.

4 November 2026. The owner will run generation tests. No paid comparison,
model upload, RunningHub task submission or automatic test route is part of
this release.

## Evidence retained

| Output evidence | Executed mechanism | Finding used for this repair |
| --- | --- | --- |
| Task 2117861200645943298; attachment SHA-256 2d3223c239ecafb207b42edbe241305584268861b10781306d34256187bc4715 | Dense attention, CRF12, three four-step samplers, decoded generated image history re-encoded by AddGuide | Texture still deteriorated clearly toward the end; encoder/attention changes alone were insufficient. |
| Task 2117928878505025537; attachment SHA-256 6a2da3630b349063f1947dc14fb6ec20b14091ffa4e22c52d659a924dc7168ac | Actual v6 raw AV latent continuation, no RGB history reconstruction | Owner accepts the overall result; small residual texture variation near 14–15 s. Native crops, embedded graph and matching archived source previews were reviewed. |
| Prepared candidate commit 30d55f366756e7f8cbcb1cc5f6e84840818a1d68 | Final-window history 22 instead of 5, all earlier graph nodes unchanged | Code contract reviewed and checked, not rendered. Frozen graph hashes/segment plans retained before promotion. |
| v7 release | The same final-window candidate promoted to ordinary Akatz generation | Runtime/visual acceptance belongs to the owner's next test; no claim that texture is already visually qualified. |

The 14-second symptom is inside window 3, which starts at 10.125 seconds.
It is not a new sampler join at 14 seconds. Published Motion Context code
preserves the native reference blocks; there was no evidence that the original
photo was dropped. The remaining cause is not uniquely established from the
moving video. The repair tests the stronger real-history conditioning without
changing the accepted global recipe.

The v6 provider runtime was 1588 seconds. v7 is not claimed to meet 25 minutes:
its larger last window does additional work and has not been timed.

## Production change

Revision: `akatz-native-1080-v7`. Existing menu:
**MiniMax H3 · Akatz V1.5 Native**. The selected workflow notice says
**Versi uji v7**, so the owner can identify the deployed version.

Only inputs needing three windows (244–362 frames) receive the longer final
history. Shorter inputs retain the same generation graph as v6.

For a 361-frame source:

| Window | Exported source frames | Source load | Raw context | Native model frames |
| --- | --- | --- | --- | --- |
| 1 | 0–123 | 0–123 | 0 | 124 |
| 2 | 124–242 | 119–242 | 5 | 124 |
| 3 | 243–360 | 221–360, plus one grid pad | 22 | 141 |

The change adds one exact native cycle: 17 pixel frames / 5 latent steps.
The preceding sampler contains 124 real frames; its 22-frame raw tail exactly
matches the third source prefix. The new 22-frame prefix is discarded after
decode, so every original source frame is exported once at the correct time.
Padding is unchanged. The hard source-audio guide starts after the carried
head; its new-frame source timing and final original soundtrack stay intact.

The first two windows, photo/reference conditioning, appearance prompt,
model/LoRA assets and strengths, dense attention, four-step scheduler, seed
mechanism, native output geometry and CRF12 are unchanged. No scaling,
refinement, image matching, sharpening, extra sampler or paired output is added.

Normal generation still has at most three samplers and 12 scheduler steps.
Peak native length rises from 124 to 141; summed model-frame count for this
source rises from 372 to 389. An unchanged step count is not unchanged compute,
memory or runtime. Those measurements and visible quality remain unqualified.

## Checks and release controls

- 714 duration/audio production cases verify exact source coverage, native
  grid, real raw history, original photo/audio, no reconstruction feedback,
  geometry, dependencies, one output and the 12-step sampler limit.
- 22 frozen complete graph hashes and source-time plans from the prepared
  candidate cover duration boundaries and audio states. The v7 graph must
  match these pre-activation contracts; expected hashes were not generated
  from the new production implementation.
- Historical v1–v6 task-progress mappings remain valid and execution-trace
  regression checks pass. The unrelated context-window research stays isolated
  in its earlier draft branch.
- Existing raw-latent schema proof remains required before normal multiwindow
  media/model upload. No new schema probe or inference is invoked by deployment.
- The unused four-sampler comparison from draft PR56 is not imported or shipped
  in this release. Owner testing uses the normal single-output workflow.

Full visual, Plus memory and runtime acceptance must come from an actual owner
test. Keep the observations attached to their task IDs and revision rather than
reinterpreting a passed code check as proof of rendered quality.

Related records: H3_RAW_LATENT_REPAIR_2026-11-04.md and
H3_TEXTURE_WORKFLOW_COMPARISON_2026-11-04.md.

