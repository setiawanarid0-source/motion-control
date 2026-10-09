# MotionFly R4 SAM3 Diagnostic — website slot 03

Replaces website MotionFly R3 slot, **not** R15 or Current. Uses the same existing key `koh1AntiObject` so website state stays compatible.

- Input 30: reference image.
- Input 33: **preprocessed** camera-compensated 35 FPS driving video. The app does **not** perform camera compensation for arbitrary uploads.
- SAM3 node 85 tracks driver frames via node 89; node 91 tracks reference; node 104 produces aligned colored masks.
- Node 393 saves the driving video mask as MP4, `save_output=true`.
- Node 394 uses ComfyUI built-in `SaveImage` rather than `PreviewImage` so API outputs can include the reference mask file.
- No KSampler/SCAlL-2 generation, no Video Stabilizer Classic, no 6-step GPU sampler.
- Backend intentionally omits nonexistent node 331 seed override for this slot.
- Diagnostic results are NOT final generative video; paid RunningHub execution is still required to prove availability/runtime.

The earlier, broken MotionFly R3 graph remains in repository for regression comparison, but is no longer connected to the website. 
