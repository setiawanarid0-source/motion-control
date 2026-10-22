# MiniMax H3 Character Swap v1.1 — VANTA test integration

## Scope
This experiment adds an independent **Character Swap v1.1** pipeline beside R15, Current/KOH, and R4 diagnostic/full-test workflows. It does **not** replace or mutate existing graphs, account selection, task queuing, or History.

Source: `minimax_h3_character_swap_workflow_v1.1.json` uploaded by the user, from Alissonerdx/Minimax-H3-ComfyUI. The original UI-format ComfyUI graph was converted to the **25-node active output subgraph** (API format); Get/Set reroutes and bypassed second-pass nodes were resolved. Only the first-pass result is exported via `VHS_VideoCombine`.

## Inputs and model conditioning
- VANTA Create -> **MiniMax H3 · Character Swap v1.1**
- One reference image and one driving video, as for existing pipelines.
- User enters **no prompt**. A fixed internal `body_swap:` template supplies conditioning. The model still requires this invisible instruction; it is not a literal prompt-free neural inference.
- Each request rewrites `BFSShotPlanner.plan.video`, `global_ref`, and `global_refs` to that task's uploaded RunningHub input filenames.
- Original author's cached scene descriptions, cached auto prompts, source video filename and old turnaround-sheet reference are removed. Prompt generation from the guide is disabled (variable guide videos cannot reuse cached descriptions).
- FPS **24** native MiniMax H3. Frame range: up to frame 360 (about 15 sec). Long video inputs may be truncated; behavior for short clips depends on BFSNodes implementation.
- Initial test **0.3 MP**, **8 steps**, **CFG 1**, **DMD Turbo + Character Swap v1.1**; **no second-pass upscaler**. Output H.264 MP4.
- Set BFSShotJoin crossfade to zero for direct motion timing. This does not guarantee zero jitter, camera drift, or identity drift.

## Provider requirements and limitations
1. This is **not** a new GPU deployment on Railway. Railway hosts the web/backend adapter; **RunningHub** must execute MiniMax H3, the BFSNodes custom package (v1.113+), the v1.1 Character Swap LoRA, Qwen encoders, VAE and DMD Turbo LoRA. The adapter cannot install these in RunningHub.
2. RunningHub `/task/openapi/create` is called with a dynamic API graph via `workflow` and the resolved planner `nodeInfoList`. A dedicated template can be set with `RUNNINGHUB_H3_WORKFLOW_ID`, otherwise the existing RunningHub workflow ID is reused; **that fallback is unverified for a different H3 graph**.
3. Plus (48 GB) is selected automatically for the first tests. Actual H3 VRAM requirements and successful provider execution are unverified; even Plus may be insufficient.
4. Existing account eligibility (100–600 RH) and no-blind-retry-on-ambiguous-create rules are unchanged.
5. Input previews and output history use the existing encrypted task registry. This experiment must not modify or reset the account vault or History.
6. **Native 40 FPS and 1080p are not implemented or claimed.** Do not change to 40 FPS without verifying temporal conditioning and output quality.
7. Alissonerdx's **BFS Character Swap Community License 1.1** permits private and commercial media generation, but forbids offering the LoRA or inference functionality as a hosted API/SaaS/other remote inference service. Do not offer this feature publicly to third parties without additional licensing rights.

## Local static tests
`npm run check` includes `scripts/test-character-swap.mjs` verifying the 25-node graph, references, per-request media substitution, fixed internal instruction and no stale sample data.

**Status:** statically prepared. No inference has been tested by this implementation, and RunningHub dependencies remain unverified. RunningHub may refuse the graph until its H3 environment is configured.
