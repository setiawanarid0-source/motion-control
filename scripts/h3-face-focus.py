"""Locate one confident face; report an unscaled crop in original photo pixels.

YuNet's ONNX outputs are decoded directly so OpenCV 4.6 (production) and newer
versions use the same model, rather than version-specific FaceDetectorYN APIs.
The detector's temporary working image is never written or used as a reference.
"""
import json
import math
import sys
import cv2
import numpy as np
from PIL import Image, ImageOps


def crop_for_face(box, width, height):
    x, y, w, h = box
    if w < 32 or h < 32:
        return None
    cw = min(width // 32 * 32, max(64, math.ceil(w * 2.5 / 32) * 32))
    ch = min(height // 32 * 32, max(64, math.ceil(h * 2.5 / 32) * 32))
    return dict(x=max(0, min(width - cw, round(x + w / 2 - cw / 2))),
                y=max(0, min(height - ch, round(y + h / 2 - ch / 2))),
                width=cw, height=ch)


def detect(filename, model_path):
    with Image.open(filename) as raw:
        image = np.asarray(ImageOps.exif_transpose(raw).convert('RGB'))[..., ::-1].copy()
    height, width = image.shape[:2]
    scale = min(1.0, 1280 / max(width, height))
    rw, rh = round(width * scale), round(height * scale)
    working = cv2.resize(image, (rw, rh)) if scale < 1 else image
    working = cv2.copyMakeBorder(working, 0, (-rh) % 32, 0, (-rw) % 32, cv2.BORDER_CONSTANT)
    net = cv2.dnn.readNetFromONNX(model_path)
    net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
    net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
    net.setInput(cv2.dnn.blobFromImage(working))
    names = net.getUnconnectedOutLayersNames()
    values = dict(zip(names, net.forward(names)))
    boxes, scores = [], []
    for stride in (8, 16, 32):
        cls = values['cls_' + str(stride)].reshape(-1)
        obj = values['obj_' + str(stride)].reshape(-1)
        bbox = values['bbox_' + str(stride)].reshape(-1, 4)
        confidence = np.sqrt(np.clip(cls, 0, 1) * np.clip(obj, 0, 1))
        for i in np.flatnonzero(confidence >= .75):
            gy, gx = divmod(int(i), working.shape[1] // stride)
            cx, cy = (gx + bbox[i, 0]) * stride, (gy + bbox[i, 1]) * stride
            bw, bh = np.exp(np.clip(bbox[i, 2:], -10, 10)) * stride
            boxes.append([float((cx - bw / 2) / scale), float((cy - bh / 2) / scale),
                          float(bw / scale), float(bh / scale)])
            scores.append(float(confidence[i]))
    if not boxes:
        return None
    keep = np.asarray(cv2.dnn.NMSBoxes(boxes, scores, .75, .3)).reshape(-1)
    if len(keep) != 1:
        return None  # never silently select a different person in a group
    crop = crop_for_face(boxes[int(keep[0])], width, height)
    return dict(crop, confidence=round(scores[int(keep[0])], 4)) if crop else None


if __name__ == '__main__':
    try:
        print(json.dumps({'face': detect(sys.argv[1], sys.argv[2])}))
    except Exception:
        # Optional identity focus never rewrites the source or blocks a job.
        print(json.dumps({'face': None, 'reason': 'detector_unavailable'}))
