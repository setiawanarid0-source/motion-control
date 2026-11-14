# Adaptive Akatz duration

Akatz Turbo8 used to reject videos above 362 frames, while its shared media
reader also had a 60-second ceiling. Its graph contained three continuation
blocks. The main Akatz web selection now removes both duration ceilings and
builds as many bounded windows as the actual prepared video requires.

Videos up to 362 frames retain the existing template-derived graph. Longer
videos repeat the reviewed third continuation block with a fixed 124-frame
model window and five aligned raw latent context frames. All nonfinal windows
are full; only the last can be padded. Each segment exports its new frames
once, trims history/padding, and joins them in order through a balanced tree.
The first three seeds and all sampling/model/image settings are preserved.
New windows receive deterministic typed seeds without changing earlier windows.

Long-video guide loaders read bounded 24 FPS slices from the prepared source.
The global audio track and per-window audio offsets follow the full duration.
The Akatz-only rollback removes the RIFE overlay. Its shared MP4/ZIP and three
PNG outputs read the native 24 FPS batch again. Adaptive duration remains;
KOH and MotionFly keep their existing one-job 60 FPS interpolation.

Turbo8 alone opts out of the shared duration ceiling and prepared-guide size
ceiling, retains the existing driver encoding quality, uses a preparation
timeout scaled to source duration, and skips the unused scene-heuristic pass.
Input upload limits, Plus requirements and media-integrity validation remain.
This removes an application duration cap; worker memory, service upload limits
and job timeouts still constrain a real render. No unlimited-runtime or visual
quality claim follows from graph validation. Other H3 profiles keep their
existing limits and behavior.

The editor download compiles for the selected video's frame count and photo
dimensions. Without a selection it uses a 360-frame preset. A shared
WidgetToString reads the filename from loader 1000 for all continuation/audio
loaders, so a manual upload does not require editing many filenames. Changing
the source duration requires another export; Vanta generation always plans
directly from its verified uploaded media.

Checks cover all existing short-duration template cases plus long and boundary
cases, symbolic complete-frame ordering, raw latent relay, audio/silent cases,
one shared RIFE node, PNG indices from its actual output batch, editor links and
HTTP/download parameters, a one-submit long-video transport case, and real
61-second FFmpeg media preparation. These checks do not run GPU inference.
Rollback baseline: 6963ec0aff2bb069cab8053feaac19557cca7f32.
