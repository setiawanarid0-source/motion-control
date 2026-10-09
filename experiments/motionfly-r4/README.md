# MotionFly R4 Full Controlled Lab — STAGED, NOT LIVE

Built on MotionFly's original 35 FPS generation graph, preserving native WanSCAILToVideo, KSampler steps=6 CFG=1 and final 1080×1920, divisor 8. Production R15 and Current workflow files unchanged. Third production slot remains **R4 SAM3 Diagnostic**, not full generator.

## Controlled lab API wiring
- Reference IMAGE node 30 must match previously segmented reference.
- 33: camera-compensated 337-frame driver at 35 FPS; node 89 resizes it and supplies pose_video.
- 501: refined driving BLUE/BLACK semantic mask 337 frames at 35 FPS -> 418.pose_video_mask.
- 500: refined reference BLUE/WHITE semantic mask -> 418.reference_image_mask.
- Existing reference image pathway feeds 418.reference_image.
- 418 -> 331 (6 steps, CFG 1) -> 401 -> 489 (1080 × 1920, divisor 8) -> 490 (35 FPS).
- SAM3 nodes omitted from this full-stage graph because their masks were refined **outside RunningHub**. No unsupported stabilizer node is added.

**Not universal:** 500/501 are extra internal assets. A real two-user-input service requires backend preprocessing/orchestration to create those assets from uploaded reference/video for each job. The camera compensator previously validated fixed, scene-specific ROIs and CANNOT be assumed reliable for arbitrary videos. Do not switch the production workflow selection to this lab API. RunningHub GPU execution has not been tested and camera static behavior is not yet proven.

## Execution blocking issues
1. Automatically derive compensated driver and masks for arbitrary uploads, not hardcoded camera ROIs.
2. Align exact number of decoded video frames at SAM3 mask and motion input. The controlled sample uses 337 each (35 FPS); previous input had 344 and output mask 337.
3. Confirm RunningHub supports separate mask asset filenames and that its VHS loader interprets mask colors correctly.
4. Validate actual GPU video output camera framing relative to reference, face/outfit, motion, and added props before a production switch.

Companion validated UI graph and sample inputs are provided as chat artifacts.
