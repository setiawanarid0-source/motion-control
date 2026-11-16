# Standard and Plus for every active workflow

The owner requested both machine choices on every workflow. The former H3 Plus-only policy is superseded. Changing workflows must preserve the user's machine selection.

| Vanta selection | RunningHub instanceType |
| --- | --- |
| Standard | default |
| Plus | plus |

All six `/api/workflows` entries advertise these supported modes. No entry has a `requiredMode`. The page, server submission and H3 media probe no longer force or require Plus.

## Native consumer-editor submission

Inspected official RunningHub frontend sources:

- https://www.runninghub.ai/_nuxt/u-I_6Zrg.js — workflowSetContentRes before taskCreateRes when editor content changes.
- https://www.runninghub.ai/_nuxt/CDgKBSqe.js — WORKFLOW validation with actual workflowContent and selected instanceType.
- https://www.runninghub.ai/_nuxt/CDxwna7w.js — consumer task endpoints.
- https://www.runninghub.ai/object_info — native ports, output types and widget definitions. The committed port snapshot records its retrieval time and registry SHA256.

The shared web-session transport now:

1. Applies the existing typed input overrides to a separate graph copy.
2. Serializes the actual graph and its connections as editor workflowContent. The executable graph is preserved.
3. Verifies an owned VANTA workspace on the selected account.
4. Calls `/api/user/task/work/valid` with that actual workflow and the selected machine.
5. Calls `/api/workflow/setContent` with the same editor and executable prompt.
6. Marks submission and calls `/task/create` exactly once, with the same prompt and machine.

Submissions to one account are serialized through this sequence so that another request cannot replace the saved graph between Save and create. No OpenAPI fallback, retained instance, machine/account substitution or create retry is added.

Vanta uses a successful preflight response as advisory, including canCreateTask=false. It submits one normal /task/create so RunningHub makes the final coin/point funding decision. This deliberately avoids reproducing the native frontend's early recharge modal as a second Vanta funding gate. It does not prove that the backend will accept the request. No currency selector, balance conversion or invented payment field is sent. An explicit nonzero validation response or failed Save still stops before task creation. A final create refusal is preserved; an ambiguous create acknowledgement is never replayed.

## Recipe and validation boundaries

No inference workflow JSON, model, LoRA, duration plan, dimensions, output FPS, audio or archive recipe is changed. The existing standalone RIFE memory batches remain mode-dependent. H3 retains native 24 FPS without RIFE.

The public registry does not list the existing RIFE batch_size/use_fp16 extensions. Their editor layout is retained from the already reviewed integrated-rife export; this change does not establish new worker support. A registry entry or a CPU test is not a completed render.

Validation covers real UI click handlers, authenticated HTTP workflow metadata, all six production builders on both machines, exact validation/Save/create payload equality, typed links and widgets, long H3/expression variants, pre-submission refusal/Save failure, serialization of concurrent submissions, and unchanged no-replay protections. Provider calls are stubbed; no GPU jobs or credits are used. Live rendering, visual acceptance and Standard GPU memory capacity remain to be tested by the owner.
