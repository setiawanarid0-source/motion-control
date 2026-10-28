# VANTA AI Agent integration — release checklist

New VANTA path: /ai-agent.html. Owner password required, VANTA device ID never accepted as authentication. Browser-to-agent calls always go through VANTA backend; the private Railway service never receives a public domain.

## VANTA service variables
- VANTA_AGENT_OWNER_KEY: random 20+ character secret, stored only in Railway Variables
- AGENT_INTERNAL_TOKEN: same 32+ character secret as the agent service
- VANTA_AGENT_PRIVATE_URL: http://vanta-ai-agent.railway.internal:3001

## Railway requirements
- Keep two services inside the same Railway project and environment, but separate GitHub repos and data stores.
- New agent service mounts /data for persistent checkpoints, has no public domain, and has its own encrypted-backup S3 bucket.
- No models selected and no paid or autonomous execution enabled.

## Blocker discovered 2026-10-26
Railway GitHub App has not been granted access to the newly created PRIVATE repository: setiawanarid0-source/vanta-ai-agent. Do NOT make the repository public.

Owner action: GitHub Settings > Applications > Installed GitHub Apps > Railway > Configure > Repository access > select vanta-ai-agent.

## Gates
1. GitHub CI checks for backend and VANTA pass.
2. Attach GitHub source to staged Railway service and deploy with unique secret and private network.
3. Confirm /healthz and protected Owner API, persistent volume restart, and encrypted offsite backup.
4. Test read-only Chromium navigation only for approved tasks.
5. Merge VANTA PR after safe smoke test of Create, Gallery, History and Account Pool.
6. Integrate Worker and Supervisor model adapters only once the above stages are accepted.


## Hermes readiness bridge — 28 October 2026

VANTA Owner dashboard calls `GET /api/agent/bridge/v1/hermes/status` (no query parameters). The existing VANTA Owner session protects the route. The VANTA backend injects the private `AGENT_INTERNAL_TOKEN` to reach the separate `vanta-ai-agent` backend's `GET /v1/hermes/status` endpoint. **The browser never receives the Hermes API key or the Agent token.**

The bridge allowlist intentionally exposes **only** this Hermes status route. `POST /v1/hermes/status` is rejected (405); query strings on status are rejected (400); Hermes native run/tools/skills endpoints remain blocked (404). The dashboard reports *installed, API disabled* when the native API is off, and must never report model execution as ready just because the Railway container is running. Status lookup failures do not interrupt Create, History, Gallery, Pools, or Owner task lists.

The official `vanta-hermes-agent` image remains on a private Railway service, started through `/init /opt/hermes/docker/main-wrapper.sh gateway run`. This step does **not** enable native Hermes execution, models, skill writes, or payments. Before the separate future execution-bridge stage, verify the native configuration under `/opt/data`, fix the duplicated `API_SERVER_KEY` source, install sandboxed terminal and permission-restricted toolsets, and test Owner approval for each task. See `vanta-ai-agent/docs/HERMES_RAILWAY_OPERATIONS.md`.

This document is a deployment checklist, not a claim of autonomous two-brain readiness.
