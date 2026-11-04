# RIFE: surface a confirmed paid-credit refusal

4 November 2026. This fixes submission error reporting, not provider billing
eligibility or RIFE model output.

## Observed incident

Production logs at 15:11:36 UTC / 22:11:36 WIB show RIFE preflight accepting
the reported short video at 40 FPS. Its measured motion rate is also 40 FPS,
with no cadence repair or detected duplicates. Processing reaches input upload
and task creation, then RunningHub returns a paid-RH-credit refusal for a
consumer API key. The queue subsequently logs acceptance as unconfirmed.

The specific cause is not a minimum two-second duration restriction. Vanta's
create handler recognized only the older `NOT_ENOUGH_BALANCE` response. The
new paid-credit refusal became a generic Error after the submission marker
was set; the durable worker then replaced its reason with an uncertainty
message. That is the misleading status in the supplied screenshot.

## Change

- Recognize the exact observed structured paid-credit refusal, normalizing
  whitespace only. Require no top-level or nested task ID and no explicit
  success code. Arbitrary prose, thrown transport errors and contradictory
  replies remain unconfirmed.
- Return `RUNNINGHUB_PAID_BALANCE_REQUIRED` with a fixed Indonesian explanation
  of the paid/free-credit distinction. Stop after this refusal; do not silently
  try every account or repeat a potentially billable create.
- Preserve the typed reason through the durable queue, authenticated public
  job response, refresh and Live Task rendering. The heading becomes
  **Kredit RH berbayar diperlukan** for new confirmed rejections.
- Add the observed credit limitation to the RIFE notice and refresh the browser
  asset version so mobile clients receive the new error handler.
- Keep genuine acknowledgement loss and old uncertain records unconfirmed.
  The old response body was not retained, so do not fabricate a receipt or
  automatically reclassify/retry historical jobs from the generic message.

Account balance thresholds, account retirement, account ordering, existing
tasks, result retention, RIFE's graph/FPS/geometry/orientation and H3 v8's
generation recipe are unchanged. No accounts or keys are deleted or replaced.
An account's displayed balance/readiness is not evidence that its credit
category is accepted by this API key. This change cannot make provider-rejected
free credits spendable and does not purchase credits or change API-key type.

## Verification

The actual createTask, background worker and Live Task error function are
executed with mocked provider responses. Cases cover the observed refusal,
nested message fields, whitespace differences, response IDs at either level,
contradictory success, generic balance errors and thrown transport errors.
The real RIFE payload retains 40 FPS input, 60 FPS output and no paid retained
instance. A definitive billing refusal performs one create attempt even when
the automatic pool contains multiple accounts. Unknown acceptance never
silently retries.

A real synthetic two-second/40-FPS input contains 80 encoded frames. FFprobe
and adaptive preparation accept its original file without conversion,
resolution change or mutation. Durable queue tests verify that the billing
code survives storage and the public view. Existing RIFE rotation/cadence and
complete application checks remain part of CI.

No new RunningHub task, model/media upload, schema probe, account-status scan
or paid comparison is performed for this repair. The original interpolation
output is not claimed successful: the provider's paid-credit requirement must
be satisfied separately before the owner can run that task through this key.

Primary API context: [RunningHub account status](https://www.runninghub.ai/runninghub-api-doc-en/api-425761030)
documents `remainCoins` and `apiType`; [key types](https://www.runninghub.ai/runninghub-api-doc-en/)
documents consumer and enterprise keys. The incident's exact billing refusal
is evidenced by production logs, not inferred from a balance alone.
