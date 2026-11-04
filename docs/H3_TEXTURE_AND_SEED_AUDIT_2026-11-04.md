# H3 texture review and provider seed transport — 4 November 2026

The owner reports useful motion, expression and character continuity, with unwanted skin/hair/material changes toward the end. The immediate objective is texture stability while preserving the accepted performance, native output and original photo appearance. This audit does not establish that changing seeds fixes the visual defect.

## Reviewed output and limits

The supplied `1000141267.mp4` contains 361 frames at 24 FPS, 1080×1936, and 15.041667 seconds. All frames decoded successfully. Native frame comparisons around the joins and the ending show increasingly patchy skin shading, broader hair highlights and changing fabric detail, most apparent around 12–15 seconds. The original photo and driving video were not available as a byte-matched pair in this request; visual comparisons are within this generated output, not a measured identity or motion comparison against those inputs.

The embedded RunningHub provenance identifies task `2117619542444568578`. Its graph uses sparse attention, final H.264 CRF 16 and three independent native samplers. Exported frame ranges are 0–123, 124–242 and 243–360; joins are 5.166667 and 10.125 seconds. The original photo remains attached to every reference node. Five generated native-canvas frames guide each continuation. There is no resolution switch or post-generation refiner in this graph. These findings do not isolate a single cause of the texture change.

The live source before this repair was `83f4731081fee6b43fb0b86548144439b910025f`, which already has dense attention, CRF 12 and explicit expression instructions (`akatz-native-1080-v4`). Logs show a separate v4 task, `2117645569556312066`, completed with 1042 seconds of provider runtime and 1048.168 observed seconds. Its plan has 346 frames and a different input geometry. That run's output has not been visually reviewed in this audit. It must not be conflated with the attached 361-frame output.

## Confirmed seed mismatch

The plan logged at 2026-11-03 14:06:49 UTC and the attached output have the following discrepancy:

| Sampler | Planned noise seed | Seed in the executed output graph |
| --- | ---: | ---: |
| 1009 | 104757304 | 5574 |
| 1049 | 104757305 | 192 |
| 1089 | 104757306 | 8806 |

[RunningHub's nodeInfoList documentation](https://www.runninghub.ai/runninghub-api-doc-en/doc-8287464) explicitly states that API calls reset seeds unless they are preserved through nodeInfoList. Previously Akatz sent an empty list. Merely placing numeric seeds in workflow JSON therefore did not establish reproducibility. A previous direct `noise_seed` override reached a sampler as a string and failed task `2117100444870602753`; reintroducing that form is unsafe.

Revision `akatz-native-1080-v5` routes each seed through a numeric-literal `MathExpression|pysssss` node's **INT** output and uses `nodeInfoList` only to override its STRING `expression`. No `noise_seed` API override is sent. The expression is constructed exclusively from a validated unsigned 32-bit integer. The installed worker has already executed this exact node class in tasks `2117504677084225537`, `2117504600521400322` and `2117509752015904770`. [Its upstream implementation](https://github.com/pythongosssss/ComfyUI-Custom-Scripts/blob/main/py/math_expression.py) returns `int(result)` on output zero. The new payload still needs output-metadata confirmation on the owner's next generation; local tests are not a live-provider seed attestation.

The LoRAs, native canvas, four-step schedule, three-window budget, five-frame history, input geometry, audio and expression path remain the v4 recipe. Other H3 profiles retain their existing submission contract. Historical v1–v4 progress schemas remain recognizable. No automatic render, replay, cancellation or replacement result is introduced.

## KOH (1) comparison

The current website maps KOH (1) to `workflows/current-api.json`. That graph configures Wan/SCAIL context windows at length 101, overlap 32 and pyramid fusion before its sampler. Akatz instead completes separate native windows and passes five decoded frames forward. The context/continuation distinction is a useful direction for a controlled texture comparison, not proof of an interchangeable model recipe. KOH renders at 640×1120 and resizes its decoded result to 1080×1920; that resize is excluded by the owner's H3 contract and is not copied. The author's H3 Relay recipe also requires nodes previously found unavailable on the target worker; no unsupported Relay substitute is enabled here.

## Validation and next acceptance

Tests exercise all admitted 6–362-frame graphs, the real submission function with fake provider/model boundaries, seed rollover, API string coercion, simulated literal-seed reset, integer expression results, historical progress mapping and actual short/rotated CPU preprocessing. They do not run diffusion or qualify texture.

For the next owner test, compare the executed output graph's seeds with the recorded plan, then inspect the complete video and native crops for skin, hair and garment stability, identity, source performance and runtime. Preserve native 1080, no upscale/downscale/refinement, and the accepted photo/motion roles. No new temporal-overlap or sampler change should be represented as visually qualified by this seed transport repair.
