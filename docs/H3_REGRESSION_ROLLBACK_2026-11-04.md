# H3 v7 regression withdrawal and v6 restoration

4 November 2026. This is a software rollback, not a new visual-quality repair.

## Decision

The owner reports no improvement and worse quality after v7. Withdraw the
22-frame final-window experiment and restore the previously accepted v6
generation graph. Do not leave v7 active because its CPU/CI checks passed.

Active generation revision returns to `akatz-native-1080-v6`: five-frame raw
AV latent continuation, native windows capped at 124, three four-step samplers,
one output. Original photo/audio, model recipe, geometry and encoding return
to the exact v6 implementation from commit
`05c739c109980f5b805828ca27e23e84ba230d76`.

The only engine-source difference from that snapshot is historical v7 node
classification, so completed/in-flight v7 tasks remain understandable in
History. The UI clearly says **Versi uji v6** and states that residual texture
is not solved. This rollback does not claim to solve the remaining defect.

## Evidence

- Previous accepted baseline: task 2117928878505025537,
  361 frames, 24 fps, 1080 x 1936; SHA-256
  `6a2da3630b349063f1947dc14fb6ec20b14091ffa4e22c52d659a924dc7168ac`.
  Owner accepted the overall result and reported small residual variation near
  the end.
- New feedback attachment: task 2117974334702440449, 346 frames at 24 fps,
  1080 x 1926; SHA-256
  `e49ff8929ed4cdd6551d44d8e46079249c01cbb5b2a912b1eb0eafdcf67c9d6e`.
  Embedded graph confirms v7's 22-frame last context, source loads 0/119/221,
  and three samplers. Thus the changed graph actually ran.
- These renders have different duration and geometry and are not a matched
  causal A/B measurement. The owner's rejection is sufficient to withdraw v7;
  it does not establish a unique mathematical cause.
- No new visual tuning is part of this rollback. Further quality comparisons
  require a matching reference pair and retained provenance.
- The old v7 contracts are kept as historical data at
  `docs/fixtures/h3-v7-rejected-contract.json`. Passing those hashes established
  graph wiring, not visual quality. The active v7 promotion check is removed.

## Validation and limits

The generation implementation is byte-identical to the v6 snapshot after
excluding the trace-mapping function. The existing 714 duration/audio cases and
execution-trace checks pass, including historical v7 mappings. Complete CI and
deployment health are checked before reporting restoration.

No RunningHub schema create, paid generation, model upload, automatic retry or
new visual-processing feature is part of this work. The owner runs generation
tests. No automatic paired comparison is connected. Do not present a rollback
or another passed code check as a finished texture solution.

Related records: H3_V7_TAIL_CONTEXT_2026-11-04.md and
H3_RAW_LATENT_REPAIR_2026-11-04.md.

