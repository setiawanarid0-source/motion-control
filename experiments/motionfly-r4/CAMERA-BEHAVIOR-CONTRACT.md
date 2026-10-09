# R4 — Camera behavior should follow each driving video

## User-defined acceptance contract
- STATIC source camera => STATIC generated camera. No model-invented pan, tilt, zoom, roll, shake, subject tracking, or scene drift.
- MOVING source camera => MATCH the camera's motion type, direction, magnitude and timing from the driving video, relative to the original reference frame. Do not freeze all footage.
- Person / clothing / background / lighting / original props from reference image. Person motion and camera *behavior* from driving video; no scene objects copied from driver.
- **Two user-uploaded inputs only**; no clean-background input.
- 35 FPS, target 1080x1920, 6 steps, CFG 1. R15 and Current remain unchanged.

## What this experiment actually implements
- New `motionfly-r4-source-camera-adaptive-api.json` based on original full SCAIL2+SAM3 graph, not the 337-frame fixed-video lab.
- Removes the hard 337-frame cap; connects SAM3 mask to each uploaded driving video and reference, not cached masks from a previous unrelated task.
- Makes positive and negative camera instructions CONDITIONAL on source camera behavior.
- No universal `Video Stabilizer Classic` applied to the driving video.
- *Does not* contain an explicit camera trajectory control interface to SCAIL2, and a prompt alone cannot guarantee pixel-locked camera output.

## Independent camera-trajectory validation (not deployed)
The preprocessor must estimate background motion while excluding or down-weighting the moving person; it must measure translation, rotation and scale. If scene evidence is weak, classify UNKNOWN and prevent automatic claims. An experimental OpenCV detector was tested offline against synthetic STATIC, PAN, ZOOM, ROTATE and FEATURELESS scenes: first four were correctly distinguished, fifth returned UNKNOWN. The real source exhibits small background shifts and therefore binary camera classification can be ambiguous; the intended rule is to transfer the observed source camera trajectory, not assume fixed presets. RunningHub GPU generation is NOT tested.

## Required next implementation
A *backend* camera-motion preflight (per user video, not one hardcoded ROI), with a source-camera trajectory and confidence report, plus an output correction/validation stage that compares generated-background camera motion to the desired source trajectory. Do not silently warp a video when uncertain, and do not launch paid GPU jobs automatically.
A video-input-specific camera compensation step must never flatten intentional camera pans/zooms; if the source camera is effectively static, normalize only unwanted residual drift. Source pose and source segmentation mask must share the same transform.
