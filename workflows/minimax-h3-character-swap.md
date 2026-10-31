# VANTA MiniMax H3 · Face & Hair · 1080p

Updates only the `minimaxH3` Motion Control choice. Other graphs, account
selection, queueing, authentication, History and 72-hour retention are unchanged.

## Media contract

- Reference picture + source video of 0.25–60 seconds.
- Transfer facial identity and hair shape/color/length. The picture's body,
  clothes, pose and background are explicitly excluded from the prompt.
- The compositor uses source frames for the body, clothes and background;
  only the head/hair matte receives H3 pixels. Source/generated head masks are
  combined to remove the old hair silhouette. A source-hand mask protects hands
  crossing the head. Outside the matte, source pixels survive before encoding.
- 1080-pixel short edge, even dimensions, original aspect, 24 FPS, source audio:
  9:16 → 1080×1920; 16:9 → 1920×1080. Other ratios are preserved without cropping.
- **This is 1080p source compositing, not native 1080p H3 inference.** H3 stays at
  about 0.4MP on Standard / 0.7MP on Plus. Its face/hair region is resized during
  paste. Small generated faces do not gain guaranteed native detail from resizing.

## Execution

1. Before a paid task, FFprobe validates the source. FFmpeg creates two temporary
   files from the same 24 FPS timeline: full 1080p source frames with audio, and
   an H3-sized video-only guide. Both frame counts/dimensions are verified.
   Resizing the guide explicitly avoids Director's implicit center crop; the
   resize is inverted during paste. The user upload is never overwritten.
2. Hard-cut detection uses FFmpeg scene threshold 0.4. Each shot is divided into
   at most five-second segments. Every source frame is covered once, including
   short shots. Motion continuity resets at detected cuts and continues within a
   shot. Every segment/shot shares the same uploaded identity picture. Director
   trims H3 alignment and continuity-prefix frames; the output never grows tails.
3. H3 Ref2VA + catalog Akatz Character Swap V1.5 at strength 1.0; 20 steps,
   res_multistep/simple, CFG 1, video/audio shift 12/3. This is the existing LoRA,
   not a new person-specific training or the separate Head Swap LoRA.
4. SAM 3.1 tracks source/generated heads and hair and source hands per segment.
   A small grow/blur softens the edit edge; hands are subtracted afterward.
   ImageBatchMulti joins the masks without caching every growing timeline prefix.
5. MVEx_SubjectUncrop pastes frame by frame with Lanczos into full source frames,
   avoiding a whole-video high-resolution intermediate upscale tensor. VHS node
   490 saves one H.264 MP4 with the source soundtrack. Existing result storage
   handles retention; intermediate masks are not extra History videos.

Three files are uploaded internally: picture, guide, and full source. Each
prepared video stays within the existing 100MB upload limit. Temporary files are
released after success/failure. No retainSeconds / paid idle GPU reservation.

## Dependencies

| Component | Model / node |
| --- | --- |
| UNET | minimax_h3_ref2va_pruned_int8_convrot.safetensors |
| CLIP | qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors |
| VAEs | minimax_h3_video_vae_fp16.safetensors; minimax_h3_audio_vae_fp32.safetensors |
| LoRA | h3_character_swap_v1.5.safetensors |
| SAM | sam3.1_multiplex_fp16.safetensors |
| Director | MiniMaxH3Director |
| Segmentation | SAM3_VideoTrack; SAM3_TrackToMask |
| Compositor | MVEx_SubjectUncrop, MaskVidExperiments |
| Mask join | ImageBatchMulti, ComfyUI-KJNodes |
| Media | VHS_LoadVideo; VHS_VideoCombine |

Director schema checked at 4c6245e518dd8a494f3afc4f3cccd53f22d82d10;
MaskVidExperiments at c32ed8c17e6fe892a174ebf25fe98b1317de97fb. RunningHub manages
installed versions independently. Explicit graph rejection is not retried across
accounts.

## Evidence

- [RunningHub V1.5 + SAM3 + MaskVidExperiments](https://www.runninghub.ai/post/2113278202089521154)
- [Akatz LoRA](https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA)
- [Director](https://github.com/AIMixer/ComfyUI_MiniMaxH3_Director)
- [Framewise compositor](https://github.com/drozbay/MaskVidExperiments/blob/c32ed8c17e6fe892a174ebf25fe98b1317de97fb/nodes_subject_crop.py)
- [Native SAM3](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_sam3.py)
- [Mask batch assembly](https://github.com/kijai/ComfyUI-KJNodes/blob/main/nodes/image_nodes.py)

## Verification limits

Tests exercise real normalization, orientation, frame alignment, hard-cut
recognition, all timeline lengths, shared references, graph links, source audio
and production create-task payloads using a mocked provider. They do not run H3
or SAM3 inference. Paid memory fit and identity fidelity are unverified for this
revision. Plus is recommended, especially for long inputs.

Masks can miss small/occluded faces, long hair or the intended subject in a
multi-person video. Missing masks retain source pixels rather than replacing the
whole frame. Identical references do not guarantee identical generated identity.
Hard-cut detection can miss transitions or split rapid motion. Review rendered
outputs before claiming exact identity, occlusion handling or 1:1 motion.
