# MotionFly R4 Full Controlled Test — WEBSITE EXPERIMENT

The public UI still takes **two** inputs: reference image and driving video.
The fourth test card reuses **the latest successful SAM3 Diagnostic task from the same browser History**.
The server retrieves both RunningHub outputs of nodes 393 and 394, uploads them as internal assets to the selected RunningHub account, and supplies them to mask loaders 501 and 500. Node 33 receives the user's already compensated video. All three videos use forced 35 FPS; driving/mask frame cap is 337.

## Limits
- This reuses **RAW SAM3 masks**, not the previously refined offline masks. It is NOT the finished R4 automatic mask-refinement solution.
- The user must upload the **same reference image** and **same pre-compensated 35 FPS driving video** as the diagnostic result. Do not claim the server can verify this currently.
- Failed or expired diagnostic outputs block full task submission before paid generation.
- RunningHub charges for the task once the user clicks. No automatic task execution is performed by this commit/deploy.
- The 337 frame number is sample-specific; this is a controlled test, not universal.
- Two original production workflows R15 and Current and existing R4 Diagnostic are unchanged.
- GPU execution and final static-camera result have NOT yet been tested.
