import hashlib
import importlib.util
from pathlib import Path
import tempfile
from PIL import Image

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('h3_face_focus', root / 'scripts/h3-face-focus.py')
focus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(focus)
model = root / 'models/h3-identity/yunet-2023mar.onnx'
assert hashlib.sha256(model.read_bytes()).hexdigest() == '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'
for box in ([10, 20, 60, 70], [0, 0, 40, 40], [500, 800, 40, 60]):
    crop = focus.crop_for_face(box, 544, 928)
    assert crop['width'] % 32 == crop['height'] % 32 == 0
    assert 0 <= crop['x'] <= 544 - crop['width']
    assert 0 <= crop['y'] <= 928 - crop['height']
assert focus.crop_for_face([1, 2, 10, 20], 544, 928) is None
# Regression shape: a native portrait must not add another 1.4MP reference.
large_box = [320, 720, 400, 560]
bounded = focus.crop_for_face(large_box, 1533, 2734)
assert (bounded['width'], bounded['height']) == (512, 704)
assert bounded['width'] * bounded['height'] == 360448
assert bounded['x'] <= large_box[0] and bounded['y'] <= large_box[1]
assert bounded['x'] + bounded['width'] >= large_box[0] + large_box[2]
assert bounded['y'] + bounded['height'] >= large_box[1] + large_box[3]
assert focus.crop_for_face([100, 100, 1200, 1600], 1533, 2734) is None
for width, height in ((544, 928), (1533, 2734), (2048, 4096)):
    for side in (40, 64, 128, 256, 400, 600, 1000):
        if side > min(width, height):
            continue
        x, y = (width - side) // 2, (height - side) // 2
        crop = focus.crop_for_face([x, y, side, side], width, height)
        if crop:
            assert crop['width'] * crop['height'] <= focus.MAX_FOCUS_PIXELS
            assert crop['x'] <= x and crop['y'] <= y
            assert crop['x'] + crop['width'] >= x + side
            assert crop['y'] + crop['height'] >= y + side
with tempfile.TemporaryDirectory() as tmp:
    filename = Path(tmp) / 'blank.png'
    Image.new('RGB', (544, 928), (127, 127, 127)).save(filename)
    before = filename.read_bytes()
    # Run the actual ONNX forward pass, not the optional-failure wrapper.
    assert focus.detect(filename, str(model)) is None
    assert filename.read_bytes() == before
print('PASS: actual CPU identity detector, native crop geometry and unchanged source bytes')
