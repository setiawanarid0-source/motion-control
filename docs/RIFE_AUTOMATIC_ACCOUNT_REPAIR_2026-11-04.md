# RIFE Automatic: continue only after a definite, taskless account refusal

The application stopped an Automatic RIFE submission after the first account
returned the exact provider message `Insufficient paid RH coins...`. This
treated one account's refusal as terminal for the whole pool. The earlier
message-only change did not restore interpolation.

## Evidence and limits

- Retained History contains a successful RIFE Plus task. The RIFE graph,
  `rife-video.js` and `rife-cadence.mjs` have identical contents at that
  success and at the reported failure. The RIFE request construction,
  endpoint, Bearer authentication, FPS and machine mapping are unchanged.
- Read-only checks of the current pool validate the keys and total RH
  balances. The provider returns `remainCoins`, `remainMoney`, `apiType`,
  `currency` and `currentTaskCounts`; it does not provide a paid/free split
  in these observed responses. Do not infer a paid-credit balance or a
  policy change from a total balance.
- The historical failed request did not retain its selected account.
  Today's account ranking cannot establish that historical identity.
- The provider's explicit refusal is observed. Its underlying account
  eligibility decision and any change to free-credit rules remain unverified.

## Resulting behavior

For RIFE with Automatic selected, an exact structured billing refusal with
a finite, nonzero business code and no task ID can continue to the next
eligible account, in the existing balance order. No accepted task exists
for the refused attempt. The first accepted task terminates the loop.

A manual account stays fixed. Other workflows retain their current billing
handling. Timeouts, missing/non-numeric business codes, success-code
contradictions, arbitrary errors, or responses containing any supported task
ID are never eligible for this fallback. An uncertain acknowledgement stops
the whole request, including after an earlier definite refusal.

If every candidate receives the explicit refusal, the application reports
the number refused and that no task was created. It cannot force RunningHub
to admit a refused account. It does not assert that the owner must purchase
credit. The selected account's safe identity is now persisted at submission
and displayed on a failed or uncertain Live Task, without credentials.

The owner-only account audit reads only the documented account-status
endpoint. It does not upload, create, cancel, retire or reroute anything.
It returns only allowlisted numeric balance fields and safe enums; unknown
response values and arbitrary provider error text are excluded.

## Validation

Mocked boundary tests exercise the real create function, account loop,
background worker and UI: first-account refusal followed by acceptance;
all accounts refused; mixed capacity/billing refusals; immediate acceptance;
lost acknowledgement after a refusal; missing/contradictory response codes;
task IDs in error replies; transport timeout; local registry failure after
acceptance; manual account selection; and unchanged non-RIFE handling.
They verify exactly one accepted registration and unchanged Plus/40-to-60
payloads. Durable queue checks preserve safe account identity across restart
and exclude injected key fields. Existing source-FPS, short-clip, cadence,
rotation, resolution and retention checks remain required.

No new RunningHub generation, upload, schema-create probe or paid comparison
is run for qualification. Actual GPU output and whether another account is
admitted remain for the owner's test. CPU/mocked checks do not establish
provider admission or visual output quality.
