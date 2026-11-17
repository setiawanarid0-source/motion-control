# RunningHub Pool claim and balance investigation

Date: 17 November 2026 (Asia/Jakarta)
Investigation: RH-POOL-CLAIM-BALANCE-20261117
Status: investigation; no implementation or generation fix claimed
Base: 270f944d39b785f0973051490d0f8478815fa424

## Before changes

The reported pool showed a confirmed daily claim while the points balance remained unknown, yet labeled the account ready. A MotionFly Standard submission was refused before a task ID was returned. These are separate facts: a daily reward receipt does not establish the current spendable balance or the required workflow reserve.

Confirmed from source:
- Daily claims already require a fresh welfare-summary grant confirmation; a success acknowledgement alone is insufficient.
- The points-summary reader silently discards unavailable replies. A missing points number can coexist with a verified session and a ready label.
- Web-session eligibility deliberately delegates funding to RunningHub. Do not restore the legacy 100-RH gate, fabricate balances from a reward amount, invent a currency selector, or silently change the selected account/machine.
- The native validation/Save/single-create sequence must remain; ambiguous or accepted submissions must never be replayed.

Planned scope: trace post-claim balance reads, preserve unknown values, distinguish connected sessions from confirmed available funds, and add bounded diagnostics for the actual provider rejection. Prefer a bounded read-only balance reconciliation over another claim or generation. Keep refresh scheduling at two hours and isolate account failures.

Validation will use neutral provider fixtures and GitHub CI. The local executor is unavailable; no local test pass is claimed. No live inference is authorized by this investigation.

## Results

Pending. Record the actual diff, tests, deployment, and limits here before completion. Do not equate UI consistency, CI or deployment with acceptance of a real paid submission.
