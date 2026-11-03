# RIFE reference-storage failure

Submission `61c2697d-17a2-4032-bee9-e2763fccd76b` reached reference staging at 2026-11-03 16:15:45 UTC (23:15:45 WIB). The supplied error shows FFmpeg failing to write its History preview under `/data/history-references` with `No space left on device`. This stage precedes provider task creation. It is not evidence of a RIFE model, FPS, orientation or RunningHub execution failure.

The existing account volume is 256 MiB. Completed outputs already use the private `vanta-motion-results` object bucket, but raw queued inputs and optimized History references still occupied the small volume. A single admitted video can be 100 MiB, so deleting only expired outputs would not solve the shared-input storage problem.

## Repair

- Store new queued input bytes in the existing private bucket under `motion-inputs/v1/queue/`, with size and SHA-256 verified before acknowledging upload. Keep only small durable job records on `/data`. The worker downloads a verified copy to `/tmp` for preprocessing; generation receives the original bytes, not a compressed History preview.
- Encode History previews in `/tmp`, verify their uploads before provider creation, then publish the account-scoped reference pair through a verified manifest after provider acceptance. Server-side copies preserve prepared media without another client upload. Authorization and HTTP byte ranges remain on the existing private endpoints; no public object URL or credentials are exposed.
- Migrate existing unexpired local previews without re-encoding. Remove a local preview directory only after its uploaded objects and published manifest have been verified. A failed migration keeps the local History media available. Original expiry timestamps are preserved.
- Recover raw files left behind by terminal or interrupted submissions; never retry a paid boundary. Incomplete uploads without a state record are cleaned only after four hours; corrupted-state leftovers wait the existing three-day window. Cleanup is confined to owned input filenames and never targets result objects, account credentials or unrelated files. Cleanup bookkeeping does not change displayed failure timestamps.
- Pause queue execution during startup recovery. A 4 KiB synthetic storage check verifies upload, server-side copy, full checksum read and byte-range read; its temporary objects are then removed. This check creates no RunningHub task. If storage is unavailable, new requests receive a clear pre-submit error; a later request can retry storage preparation without a new timer.
- Reuse the existing hourly maintenance callback for expired input/reference media. Completed outputs remain in their separate `motion-results/v1/` namespace with the existing 72-hour retention and five-minute cleanup. Account removal remains independent of completed-output retention.

No volume resize, additional service, GPU render, task cancellation, automatic resubmission of the failed job, frame-rate change, output resizing or interpolation-graph change is part of this repair. The Akatz detail/expression recipe is unchanged.

## Verification

The new mocked-S3 regression test stages four 80 MiB inputs while the simulated vault contains less than 64 KiB of job metadata. It covers actual checksum upload/download code, queue restart and hydration, paid-boundary isolation, terminal-input recovery, legacy migration, copy/verification failure rollback, private reference-route authorization, byte-range playback and expiry isolation from completed result videos. The HTTP integration server explicitly clears production bucket bindings, so test uploads cannot contact the real bucket.

Deployment must reach `SUCCESS`, then report `Media storage readiness` with a successful storage check and migration counts. That runtime log is the evidence for live data movement; local tests alone do not establish how many production files were migrated. Failed migrations remain reported as deferred and keep their local copies.
