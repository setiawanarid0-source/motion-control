# Akatz v8: RunningHub editor output and ZIP

The owner resumed from Akatz V1.5 Native v8, with five original AV latent
history frames and the shorter final segments. V7's 22-frame history remains
rejected. V8's 14–15-second texture, runtime and cost remain unqualified until
the owner evaluates a new render. This change does not alter the API inference
builder or promote another sampling recipe.

The Create page now offers **Unduh workflow RunningHub + ZIP** under Akatz.
Its authenticated GET endpoint builds a native editor JSON from the current
v8 graph, using only local receipts for the two pinned model uploads. It never
uploads a model, submits a task or calls a provider. Missing receipts return a
readable error; the client never saves that error as a workflow file.

The editor preset is explicitly 15 seconds / 360 frames / 24 FPS, with a
1080×1920 photo and original source audio. Upload the photo at node 30 and the
video at 1000; copy the uploaded video's filename into node 200. Actual STRING
connections now route that filename into all eleven later video/audio input
consumers. The previous detached tuples in filename widgets were not wires.

Node 493 supplies the one visible final MP4 preview; node 490 retains the
saved backup with its preview hidden. `VHS_SelectFilename` at 494 selects the
last completed file, including muxed audio when present, for native
`CompressImages` at 496. The latter uses the same MP4 path input and PNG image
branch default as the owner's working KOH/RIFE ZIP nodes. ZIP adds no further
video encoder or inference. Both MP4 branches retain CRF12 and 24 FPS.

Native editor node/socket definitions are kept separately from values, with
no account keys, user media, model receipt handles or session data committed.
The editor export round-trips every original inference input to the dynamic
v8 API graph. Existing frozen v6/v8 inference contracts remain untouched.

CPU/HTTP checks cover every socket/backlink, the eleven actual filename
connections, final-video selection, all original graph values, audio, ZIP,
hidden backup, read-only receipt lookup, response headers, missing receipts,
and the authenticated production route placement. They do not establish GPU
success, waveform/content quality, absence of watermark in a new H3 output,
or an improvement in the remaining end-of-video texture variation.
