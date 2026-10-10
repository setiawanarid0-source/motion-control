# R15 file-first 35 FPS repair

## Defect
The previous interpolation script fed raw frames into FFmpeg over a live stdin pipe while FFmpeg simultaneously opened the uploaded source for audio. The upload path had no extension, but FFmpeg can sniff content. When encoder process exited before all frames were supplied, Python raised \`BrokenPipeError\` and the website showed "Gagal memulai" even though no RunningHub paid task was submitted. The precise cause of early FFmpeg exit on the user's failed upload is not independently known because stderr from FFmpeg was discarded.

## Patch
- OpenCV writes interpolated frames to a fully completed **lossless FFV1 file**.
- After the file is closed, FFmpeg separately encodes H264, carries source audio if present, without \`-shortest\` truncating required video frames.
- FFmpeg error output is captured and exposed on failure; temporary files removed even on failure.
- Use max input width 576 for the R15 motion path (portrait source is resized for conditioning). This reduces Railway CPU cost; generated output remains 1080×1920. The user must be aware this is reduced driving resolution.
- Retain camera motion and input timing, no global stabilizer or post-hoc body warp.
- Validate a **full 8.1-second real selfie** conversion: 243 frames at 30FPS → 284 at 35FPS, no pipe, no missing frames (at 480px trial width).
- Validate full turning video: 435 frames at 30FPS → 508 at 35FPS, output ffprobe confirms full frame count (at 480px trial width).
- Railway deploy test uses synthetic 1.4-second extensionless media to cover actual Multer temporary filename behavior, plus all existing graph and runtime syntax tests.

## Remaining unknown
Not proven to fix generative camera/body jitters. The 576px input limit and use of interpolation itself may alter source fine detail. Future improvements require controlling SCAIL2 temporal consistency; don't claim 1:1 as achieved.
