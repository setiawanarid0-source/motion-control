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

This document is a deployment checklist, not a claim of autonomous two-brain readiness.
