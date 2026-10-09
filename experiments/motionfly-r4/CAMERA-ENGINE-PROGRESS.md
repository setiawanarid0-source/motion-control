# MotionFly R4 camera-motion engine — gated experiment

The camera rule is **SOURCE CAMERA STATIC => OUTPUT CAMERA STATIC** and **SOURCE CAMERA MOVING => OUTPUT FOLLOWS THE SOURCE CAMERA'S TRAJECTORY**. Camera behavior is input-dependent, not a permanent tripod prompt. The appearance/environment remains from the reference image, and two user inputs remain the target.

This commit stages a Node.js **camera QA safety policy** and regression tests. Run:
node experiments/motionfly-r4/test-camera-policy.mjs

A separate experimental OpenCV engine with actual background feature tracking, optional SAM3 blue-subject masks, per-frame camera trajectory, and conservative 2D post-render correction was tested offline and packaged as the deliverable \`MotionFly_R4_Camera_Engine_Experimental.zip\` in the ongoing chat. The engine is NOT in production / installed in Railway by this commit. The code here does not execute GPU tasks, modify the production workflow selection, or automatically correct video.

Verified offline:
- 5 synthetic conditions: static camera (moving actor), pan, zoom, rotation, featureless footage.
- A 21.45 px invented output pan was reduced to 0.099 px in a 95-frame synthetic control case, **not on a real RunningHub output**.
- The submitted real source video and R4-generated result did not have reliable enough motion classification for automatic correction; safely abstained.
- SAM3 segmentation mask helped background keyframe tracking but did not resolve residual ambiguity sufficiently.

Next: package OpenCV in a dedicated Railway worker with safe CPU/time/memory limits; analyze each uploaded source and generated result, synchronize the resulting trajectories, and apply post-generation correction only when this policy says candidate and image borders remain safe. Test on multiple real stationary AND deliberately moving driving videos. Do not claim camera lock until the actual output passes. Keep R15 and Current untouched.