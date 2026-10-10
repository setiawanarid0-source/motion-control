# R15 v2: camera/body-jitter input fixes (2026-10-10)

Evidence-based diagnosis from four user-supplied videos:
- Turning: driving \`153246.mp4\` (30 FPS, 435 frames), generated \`1000069491.mp4\` (35 FPS, 505 frames). Original background approximately fixed. Generated background diverges while subject turns; therefore subject rotation is being conflated with camera movement.
- Selfie: driving \`1000067003.mp4\` (30 FPS, 243 frames), generated \`1000069488.mp4\` (35 FPS, 281 frames). Entire generated subject exhibits undesirable jitter/shape changes compared with input.
- The actual VideoHelperSuite VHS_LoadVideo \`force_rate=35\` **duplicates/drops frames** for input FPS other than 35. This causes repeated motion pose conditioning and is a plausible contributor to unnatural generated motion, but does not prove causation for all observed jitter.
- R15 experimental post-output camera correction used whole-frame 2D warp, which can visibly move the subject. This is now disabled by default, while measurement-only QA remains active.

Conservative R15-only modifications:
1. Before paid generation, condition only non-35 FPS driving videos to true constant 35 FPS using DIS optical flow. Avoid duplicate frame sampling while preserving original timing and the original audio track. Interpolating occluded moving body regions may introduce interpolation artifacts. Fail **before RunningHub task submission** if processing/validation fails. Standard 35 FPS inputs pass through unchanged.
2. Keep RunningHub \`VHS_LoadVideo.force_rate=35\` so it consumes the prepared 35 FPS video without duplicating 30 FPS poses. SAM3 mask and pose share this same input and timebase.
3. Camera prompt distinguishes body rotation from camera pan and preserves the source camera's genuine jitter. Only *extra* model-generated jitter is discouraged.
4. Disable output whole-body image warping. Only measure output camera and report. Restoring camera behavior 1:1 will require reliable body/background masks or a verified camera-controllable generative model—not a hard-coded 2D whole-frame transform.
5. Existing R15 baseline graph remains in \`workflows/r15-api.json\` as backup. Current, R4 SAM3 Diagnostic, and R4 Full Controlled are unchanged.

Offline validation: selfie 243 source frames => 284 FPS35, turn 435 => 508 FPS35; tests on synthetic 30 FPS video verify output rate and count. No new paid RunningHub generations. This **does not prove** the generated results no longer jitter or camera tracks 1:1; user-facing validation on both scenarios is still essential.

Operational note: preprocessing at 30->35 may add 15-40 seconds for short 8-15s videos depending on input resolution and Railway CPU load. It is a CPU preprocessing task, not RunningHub GPU generation. Timeouts fail without creating a paid task.
