# One-job 60 FPS output

The website selections `current` (KOH 1), `motionflyHD`, and `minimaxH3Akatz`
(Turbo8) now interpolate their final IMAGE batch with the existing target-FPS
`RIFEInterpolation` recipe before encoding. The standalone RIFE selection,
MiniMax H3 Motion Control, and Akatz v3 retain their existing behavior.

`integrated-rife.js` decorates the submitted graph with one shared RIFE node
760060. Its source FPS comes from the previous final encoder's actual FPS
connection: KOH uses its loaded 40 FPS; MotionFly uses its loaded 24 FPS; Akatz
uses 24 FPS. Target FPS is 60, scale 1, model `flownet.pkl`, batch 2, FP16.
Generation steps, image sizes, crop, reference uploads and source audio are
unchanged. The MP4 preview, backup, and original-video ZIP use the shared
interpolated batch. Akatz's first/middle/last PNGs read that same batch, including
its actual frame count. The editor export also includes the interpolation node.

There is one provider create-task request for each selected generation. This
integration does not load the generated MP4 again, start another RunningHub
workflow, or run a server-side interpolation job. The existing queue/output
retention and delivery paths are preserved.

The public node implementation supports FLOAT source/target rates, including
24→60 and 40→60 rather than a fixed integer multiplier:
https://github.com/GACLove/ComfyUI-VFI/blob/main/nodes.py
The worker-installed revision has not been independently inspected in this
change. The existing owner's RIFE recipe is reused; actual GPU execution,
worker memory use, runtime and visual acceptance remain pending the owner's
next generation. Interpolation adds processing work and may create artifacts;
no runtime or image-quality improvement is claimed by structural tests.

Validation covers graph immutability, one interpolation node, source FPS links,
shared 60 FPS output wiring, unchanged audio/size/generation branches, short and
landscape Akatz inputs, consistent editor links and HTTP export. The actual
six-workflow submission harness checks one task per selection and limits the
integration to the three requested selections. Full application checks and CI
must pass before deployment. Rollback baseline: fe22ce21f92b930fd50d0ca17d25c97196645490.
