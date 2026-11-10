# VANTA Motion Studio — Dual Workflow

Private RunningHub motion-control web app with two selectable pipelines:

1. **R15 Baseline** — recovered pre-R16 API graph, 30 FPS, 6 steps, CFG 1.5.
2. **Current Workflow** — existing SCAIL-2 Preserve V7 graph previously used by VANTA Motion Studio.

Both use the same input node contract:

- Reference Image → node `30`, field `image`
- Video Reference → node `33`, field `video`
- Final output → node `490`

The backend sends the selected graph through authenticated RunningHub HTTP requests using the account's access token. No browser process is required during generation.

## Security

RunningHub access tokens are validated server-side and stored in an AES-256-GCM encrypted vault. The browser never receives stored credentials back. Refresh tokens are used when supplied. Owner login protects the account pool and generation endpoints. Set a persistent `APP_MASTER_KEY` environment variable in production.

At startup, migration removes former RunningHub API keys from the global/device vaults, task credentials, retired-account escrow, and stale credential files. Completed history and archived media remain available for their existing three-day lifetime. Old credential cookies are expired and cannot restore removed keys. KIE.AI credentials are separate.

## Run

```bash
npm install
APP_MASTER_KEY="replace-with-long-random-secret" npm start
```

Open `http://localhost:3000`.

## First-time setup

Open **Account Pool**:

1. Copy the token exporter from RunningHub Pool and run it on RunningHub while logged in.
2. Paste the exported JSON into **Access token / JSON RunningHub** and connect the account. Existing export JSON remains supported. A raw access token can also verify an account; the exported JSON supplies upload identity and refresh credentials when needed.
3. Return to Create, choose the workflow, upload references, then generate.

## Deployment note

This application proxies large video uploads, so it is designed for a persistent Node runtime (Railway/Replit/etc.) rather than small-body serverless functions.
