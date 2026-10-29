#!/usr/bin/env python3
"""Regression-only test: verify that output has same visual orientation as source."""
import json
import subprocess
import sys

import cv2
import numpy as np


def first(path):
    png = subprocess.check_output([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-i", path, "-frames:v", "1", "-vf", "scale=192:-2",
        "-f", "image2pipe", "-vcodec", "png", "pipe:1"
    ], timeout=30)
    img = cv2.imdecode(np.frombuffer(png, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Cannot read source/display frame")
    return img


before, after = first(sys.argv[1]), first(sys.argv[2])
if before.shape != after.shape:
    raise ValueError(f"Incorrect frame orientation: {before.shape} vs {after.shape}")
direct = float(np.mean(np.abs(before.astype(np.int16)-after.astype(np.int16))))
reversed_180 = cv2.rotate(after, cv2.ROTATE_180)
turned = float(np.mean(np.abs(before.astype(np.int16)-reversed_180.astype(np.int16))))
print(json.dumps({"direct": direct, "turned": turned, "size": before.shape[:2]}))
if direct > 23 or direct + 15 >= turned:
    raise ValueError("Output is not aligned with original display orientation")
