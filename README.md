# VANTA Motion Studio — Dual Workflow

Private RunningHub motion-control web app with two selectable pipelines:

1. **R15 Baseline** — recovered pre-R16 API graph, 30 FPS, 6 steps, CFG 1.5.
2. **Current Workflow** — existing SCAIL-2 Preserve V7 graph previously used by VANTA Motion Studio.

Both use the same input node contract:

- Reference Image → node `30`, field `image`
- Video Reference → node `33`, field `video`
- Final output → node `490`

The app sends the selected API-format graph through RunningHub's `workflow` override on `/task/openapi/create`, while retaining one configurable RunningHub template `workflowId`.

## Security

RunningHub API keys are validated server-side, then stored only inside an AES-256-GCM encrypted HttpOnly cookie. The browser never receives stored raw keys back. Set a persistent `APP_MASTER_KEY` environment variable in production.

## Run

```bash
npm install
APP_MASTER_KEY="replace-with-long-random-secret" npm start
```

Open `http://localhost:3000`.

## First-time setup

Open **Account Pool**:

1. Save a RunningHub template Workflow ID.
2. Add one or more RunningHub API keys.
3. Return to Create, choose R15 or Current Workflow, upload image/video, then generate.

## Deployment note

This application proxies large video uploads, so it is designed for a persistent Node runtime (Railway/Replit/etc.) rather than small-body serverless functions.
