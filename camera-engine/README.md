# R15 replacement: R4 Camera-Aware (experimental)
The previous R15 graph remains stored in workflows/r15-api.json as a rollback reference. The website's r15 slot points to the 39-node original MotionFly SCAIL2+SAM3 camera-adaptive graph.

- Every R15 video upload is analyzed before any paid RunningHub task is created.
- After the task returns video, a Railway CPU job measures the source/output background camera paths. The browser sees a "checking camera" status during this step.
- Only when source/output camera measurements are reliable AND the estimated 2-D correction is within 8 pixels is conservative correction attempted; verified improvement is required to serve it.
- If confidence is low or correction fails, the original RunningHub output is served with a recorded warning. No claim of a locked camera is made.
- Test on several real videos. 2-D camera correction **cannot** repair 3-D perspective shifts, generated object/identity hallucinations, or make the SCAIL-2 model inherently camera controllable.
- This uses a Dockerfile with system OpenCV/FFmpeg. CPU QA time adds to generation and stores the source file in /data for up to 3 days.
- Output QA is limited to 450 MB, input upload limited by existing server to 100 MB; changes apply ONLY to r15 workflow selection, not Current, R4 Diagnostic, or R4 Full Controlled.
- The service must be deployed with Dockerfile. GitHub commit/build pass is NOT proof of correct RunningHub motion.
