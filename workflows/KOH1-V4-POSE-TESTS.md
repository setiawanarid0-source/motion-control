# KOH 1 V4 Pose-Only: acceptance criteria

Based on V3 Mask, with two added processing nodes and zero changes to R15, Current, or saved V3.

## V4 actual graph
- Driver video frames: 33 → 89 → 492 (DWPreprocessor with body, hands and face) → 493 (size match) → 418.pose_video.
- SAM3 animation tracking: 33 → 89 → 85 → 104 → 418.pose_video_mask.
- Character reference and SAM3 reference mask: 30 → 308 → 447 → 418.reference_image; 447 → 91 → 104 → 418.reference_image_mask.
- Text camera constraint: 3 / negative: 4. Output: 401 → 489 (1080×1920) → 490, 30 FPS from input video info.
- Risks: ComfyUI runtime MUST expose DWPreprocessor and its model files (yolox_l.onnx, dw-ll_ucoco_384_bs5.torchscript.pt). Graph validation cannot prove RunningHub cloud node availability.
- 2D skeleton doesn't contain 3D occlusion depth or enforce a hard background lock. The static camera constraint is still a model instruction, not pixel-level compositing.

## Checks
- Run `npm run check` for graph/linkage/UI JS syntax verification.
- Upload image reference and BOTH prior driving videos separately in website; use V4 Pose workflow only.
- Verify RunningHub creates a task with no unsupported-node/model error before spending on extended runs.
- Compare first, middle, last frames on camera drift, new props, clothes/face, timing/limbs, and output 30 FPS 1080x1920.
- Do NOT mark end-to-end as passed until BOTH driving-video outputs are manually inspected.
- If DWPreprocessor is unavailable in RunningHub, retain V3 and do not silently fall back to RGB driving.
