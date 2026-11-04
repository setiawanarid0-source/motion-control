# H3 context compatibility result — 4 November 2026

## Observed result

At **14:12:22 WIB** (07:12:22 UTC), the actual RunningHub Plus validator
used by Vanta rejected the new core context node:

```json
{
  "status": "unsupported",
  "validationType": "missing_node_type",
  "missingNodes": ["MiniMaxH3ContextWindows"],
  "taskCreated": false
}
```

The fixed unregistered-node negative control first returned
`missing_node_type` for the expected sentinel, with no task ID. The real
registration check then returned the missing H3 context node. This is
provider evidence of the current worker's registration, not an inference
from local ComfyUI code or passing CI.

Scope: Vanta's existing workflow template `2101170393796079617`,
RunningHub `plus`, checked using an eligible account already in the
owner's pool. This does not assert that every RunningHub runtime or model
API lacks the feature. The signature/GPU checks were not attempted after
the missing-node response.

## Account preflight

The retained credential for owner task `2117861200645943298` returned
`USER_BANNED` from the read-only account-status check. The inspection
therefore used a live eligible pool credential. No credential values,
balances or raw provider payloads are included in this report. The reason
for the provider's account ban is not established.

The initial v1 inspection had stopped at an unconfirmed negative control
and created no task. Its response did not retain enough detail to classify
that earlier failure. The v2 preflight establishes the source credential's
current status; it must not be represented as a retained error body from v1.

## Release decision

- Candidate [PR #51](https://github.com/setiawanarid0-source/motion-control/pull/51)
  stays draft and blocked. Do not select or merge it as a runnable replacement
  on the inspected worker.
- The current production generation recipe remains unchanged. Texture
  acceptance remains failed; there is no verified texture fix.
- No paid generation, model upload, sampler execution, automatic retry,
  account removal or archived-task credential rewrite was performed.
- A compatible runtime or separately verified alternative is required before
  a visual trial. Do not ask the owner to rerun unchanged v5 as a remedy.

## Deployed inspection

[PR #52](https://github.com/setiawanarid0-source/motion-control/pull/52)
introduced the owner-only, expiring, fixed, once-only inspection.
[PR #53](https://github.com/setiawanarid0-source/motion-control/pull/53)
added read-only account preflight, eligible-key selection and sanitized
provider categories. Branch CI and Railway pre-deployment checks passed.

Railway deployment `c260727d-2831-4fe6-a3ec-28520df8bf14`, commit
`01a146c327eacb87b17a2af28147ae83bbb0da5d`, was observed `SUCCESS`
before the browser inspection. The report is durably checkpointed and
repeat page visits cannot repeat the provider checks. The inspection
route expires at 14:00 WIB on 5 November 2026.
