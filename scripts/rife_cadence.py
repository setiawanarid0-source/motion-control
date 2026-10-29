#!/usr/bin/env python3
"""Detect repeated motion frames in pseudo-60fps clips and build unique motion anchors.

The source video is never overwritten. The measured (not fixed) anchor rate is
used by RIFE to reconstruct genuine 60fps movement on RunningHub.
"""
import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np


def fail(reason, **extra):
    print(json.dumps({"status": "not_repairable", "reason": reason, **extra}), flush=True)
    return 2



def frame_transform(frame, rotation):
    if rotation == 180:
        return cv2.rotate(frame, cv2.ROTATE_180)
    if rotation == 90:
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    if rotation == 270:
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


def detect_display_rotation(path):
    """Match OpenCV's decoded pixels to FFmpeg's display-correct first frame.

    Camera MP4/MOV files often store a display rotation matrix separately from
    raw pixels. Different OpenCV backends may apply this implicitly or ignore
    it. The canonical reference below uses FFmpeg's normal autorotation.
    Never blindly rotate an already-upright source.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError("Video tidak dapat dibaca untuk memeriksa orientasi.")
    ok, first = cap.read()
    cap.release()
    if not ok:
        raise ValueError("Frame pertama tidak tersedia untuk pemeriksaan orientasi.")
    try:
        raw = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
             "-i", path, "-frames:v", "1", "-vf", "scale=192:-2",
             "-f", "image2pipe", "-vcodec", "png", "pipe:1"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=30, check=True).stdout
        reference = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    except Exception as exc:
        raise ValueError("Tidak dapat memverifikasi orientasi video asli.") from exc
    if reference is None:
        raise ValueError("Referensi orientasi video tidak tersedia.")
    ref_h, ref_w = reference.shape[:2]
    ref_ratio = ref_w / ref_h
    scores = []
    for angle in (0, 90, 180, 270):
        candidate = frame_transform(first, angle)
        h, w = candidate.shape[:2]
        if abs((w / h) / ref_ratio - 1) > .06:
            continue
        sample = cv2.resize(candidate, (ref_w, ref_h), interpolation=cv2.INTER_AREA)
        diff = float(np.mean(np.abs(sample.astype(np.int16) -
                                    reference.astype(np.int16))))
        scores.append((diff, angle))
    if not scores:
        raise ValueError("Orientasi atau aspek rasio sumber tidak dapat dipastikan.")
    scores.sort()
    best, rotation = scores[0]
    if best > 22:
        raise ValueError("Orientasi sumber berbeda dari decoder; proses dihentikan sebelum biaya RunningHub.")
    if rotation != 0 and len(scores) > 1:
        second = scores[1][0]
        if second - best < max(3.0, best * .35):
            raise ValueError("Orientasi video ambigu; tidak aman melakukan rotasi otomatis.")
    return rotation


def analyze(path, advertised_fps, rotation):
    video = cv2.VideoCapture(path)
    if not video.isOpened():
        raise ValueError("Video tidak dapat dianalisis OpenCV.")
    width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if rotation in (90, 270):
        width, height = height, width
    frame_count_hint = int(video.get(cv2.CAP_PROP_FRAME_COUNT))
    if width < 16 or height < 16:
        raise ValueError("Dimensi video tidak valid.")
    if frame_count_hint > 18000:
        raise ValueError("Analisis adaptif dibatasi pada 5 menit video 60 FPS untuk menjaga CPU VANTA.")
    kept = []
    prev = None
    n = 0
    active = 0
    duplicates = 0
    max_hold = 0
    hold = 0
    while True:
        ok, frame = video.read()
        if not ok:
            break
        frame = frame_transform(frame, rotation)
        gray = cv2.cvtColor(cv2.resize(frame, (96, 54), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
        gray = gray.astype(np.int16)
        delta = float(np.mean(np.abs(gray-prev))) if prev is not None else 99.0
        duplicate = prev is not None and delta <= 0.90
        if duplicate:
            duplicates += 1
            hold += 1
            max_hold = max(max_hold, hold)
        else:
            kept.append(n)
            if prev is not None and delta >= 1.15:
                active += 1
            hold = 0
        prev = gray
        n += 1
        if n > 18000:
            raise ValueError("Video terlalu panjang untuk analisis adaptif yang aman.")
    video.release()
    if n < 30 or not kept:
        raise ValueError("Durasi/frame video tidak cukup untuk analisis adaptif.")
    duration = n / advertised_fps
    unique_fps = len(kept) / duration
    ratio = duplicates / n
    gaps = np.diff(kept)
    irregular = int(np.count_nonzero(gaps > 5))
    analysis = {"sourceFps": advertised_fps, "effectiveFps": round(unique_fps, 6),
                "duplicateRatio": round(ratio, 4), "sourceFrames": n,
                "anchorFrames": len(kept), "duration": round(duration, 6),
                "activeTransitions": active, "maximumDuplicateRun": max_hold,
                "irregularGaps": irregular, "width": width, "height": height}
    if ratio < 0.20 or active < max(8, len(kept) * 0.10):
        return "healthy", kept, analysis
    if unique_fps < 8 or unique_fps >= advertised_fps * .92:
        return "unreliable", kept, analysis
    if max_hold > 12 or irregular > max(2, len(gaps)*0.025):
        return "irregular", kept, analysis
    if len(gaps) > 15 and np.count_nonzero(gaps <= 4) / len(gaps) < .95:
        return "irregular", kept, analysis
    return "repair", kept, analysis


def write_anchors(source, output, indices, fps, width, height, rotation):
    if not (8 <= fps <= 60):
        raise ValueError("FPS gerakan efektif tidak valid.")
    cap = cv2.VideoCapture(source)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
               "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}",
               "-r", f"{fps:.9f}", "-i", "pipe:0", "-i", source,
               "-map", "0:v:0", "-map", "1:a?", "-map_metadata", "-1",
               "-map_chapters", "-1", "-c:v", "libx264", "-preset", "veryfast",
               "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
               "-movflags", "+faststart", "-shortest", output]
    proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE)
    next_idx = iter(indices)
    target = next(next_idx, None)
    frame_idx = 0
    try:
        while target is not None:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("Frame video sumber berakhir sebelum semua anchor tersedia.")
            if frame_idx == target:
                corrected = frame_transform(frame, rotation)
                if corrected.shape[:2] != (height, width):
                    raise RuntimeError('Ukuran frame tidak cocok dengan orientasi sumber.')
                proc.stdin.write(corrected.tobytes())
                target = next(next_idx, None)
            frame_idx += 1
        proc.stdin.close()
        error = proc.stderr.read().decode("utf-8", "replace")[-800:]
        status = proc.wait(timeout=180)
        if status != 0 or not os.path.isfile(output) or os.path.getsize(output) < 1000:
            raise RuntimeError("FFmpeg tidak dapat membuat video anchor: " + error[-350:])
    except Exception:
        proc.kill()
        proc.wait()
        raise
    finally:
        cap.release()
        proc.stderr.close()


def main():
    args = argparse.ArgumentParser()
    args.add_argument("source")
    args.add_argument("output")
    args.add_argument("--fps", type=float, required=True)
    opts = args.parse_args()
    if not (59.5 <= opts.fps <= 60.001):
        raise ValueError("Analisis adaptif hanya untuk video berlabel 60 FPS.")
    rotation = detect_display_rotation(opts.source)
    status, indices, metrics = analyze(opts.source, opts.fps, rotation)
    metrics['rotationCorrection'] = rotation
    if status != "repair":
        reason = ({"healthy": "Tidak ditemukan pola duplikasi frame yang dapat diperbaiki RIFE.",
                  "irregular": "Pola frame tertahan terlalu tidak teratur; rekonstruksi dengan FPS tunggal berisiko mengubah timing gerakan.",
                  "unreliable": "FPS gerakan efektif tidak dapat ditentukan dengan cukup yakin."})[status]
        return fail(reason, metrics=metrics)
    write_anchors(opts.source, opts.output, indices, metrics["effectiveFps"],
                  metrics["width"], metrics["height"], rotation)
    print(json.dumps({"status": "prepared", "metrics": metrics, "output": opts.output}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"status":"error", "reason":str(error)[:500]}),flush=True)
        sys.exit(1)
