# RunningHub Pool claim and balance investigation

Date: 17 November 2026 (Asia/Jakarta)
Investigation: RH-POOL-CLAIM-BALANCE-20261117
Status: candidate prepared; GitHub CI and deployment pending
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

## Candidate checkpoint

- Web-session status can make one additional read-only points-summary lookup when the first response is rejected, unavailable or incomplete. Import still uses one lookup. Complete zero balances are retained as zero; neither a reward amount nor balanceUnit is substituted for a missing balancePoint.
- Status records bounded summary-read metadata and allowlisted field presence. Maintenance logs contain response metadata and presence flags, not numeric balances, credentials, prompts or media.
- Incomplete cached ledgers are reconciled on the next maintenance invocation rather than blindly reused. The two-hour scheduling and account isolation remain.
- The pool distinguishes verified available funds, confirmed zero, and an unverified ledger. Its counter now says accounts with a balance, while valid sessions remain eligible to ask RunningHub for final funding approval.
- A confirmed claim with an unverified ledger is labeled as such rather than presented as a verified balance increase.
- Structured provider funding refusals are logged as pre-task rejections. Account/machine selection, the validation/Save/single-create sequence and replay guards are unchanged.
- Regression fixtures cover post-claim reconciliation, persistent partial responses, outages, claim-once behavior, no inferred balances, no inference calls, renderer labels and counter behavior. The existing browser expectation is updated for the precise counter label.
- Five pure funding-classification examples ran in the hosted JavaScript runtime. No local Node or full-suite result is claimed; GitHub CI must validate the candidate before merge/deployment.

Actual provider acceptance after a claim is not established by these changes. The original refusal remains a funding rejection, not a render failure. Final results, release identifiers and fresh read-only provider evidence will be appended here.


## First release and remaining representation check

PR117 merged as 2c1d70633bb311304f8c96bd62b6766745c17554; deployment b31c7ed8-65e6-4934-80b1-6d450b158787 reached SUCCESS on 17 November 2026 at 07:53:11 WIB. All six PR and main checks passed. The same service, volume and source scope were preserved.

A read-only maintenance check still found incomplete numeric point balances on three sessions after two lookups. The provider returned code0, confirmed the daily claim, and included the balancePoint field. Field presence alone does not identify whether the value is null, a supported number or a numeric representation rejected by the parser. No real paid task was submitted to test this.

Follow-up hypothesis: the native client converts balancePoint with Number(), while the current parser only accepts a plain decimal string. Decimal exponent strings are valid numeric representations and need dedicated coverage. Extend only decimal numeric syntax, retain nonnegative/finite validation, and add a value-encoding tag without logging amounts or arbitrary provider strings. Then inspect the fresh encoding evidence before assigning the actual cause.

This is not a currency conversion or a fallback from a reward amount/accounting unit. Do not turn null or missing points into zero or into the claimed amount. No generator or account/machine routing change is planned.
