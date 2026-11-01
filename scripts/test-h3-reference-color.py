import importlib.util
import tempfile
from pathlib import Path

from PIL import Image, ImageCms

spec = importlib.util.spec_from_file_location("h3_reference_color", Path(__file__).with_name("h3-reference-color.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix="vanta-colour-test-") as folder:
    folder = Path(folder)
    # An ordinary RGB reference must be passed through, not recompressed.
    source = folder / "rgb.png"
    image = Image.new("RGB", (108, 192), (71, 119, 183))
    image.save(source)
    original = source.read_bytes()
    out = folder / "prepared.png"
    info = module.prepare(source, out)
    assert not info["outputWritten"] and not out.exists()
    assert not info["resized"] and source.read_bytes() == original

    # A tagged source uses the ICC transform at unchanged dimensions. LAB
    # provides a clearly different colour-coordinate system without any media
    # or external ICC fixture; merely dropping its profile cannot pass this test.
    lab_profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("LAB"))
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
    lab_image = ImageCms.profileToProfile(image, srgb, lab_profile, outputMode="LAB")
    lab_source = folder / "lab.tif"
    lab_image.save(lab_source, icc_profile=lab_profile.tobytes())
    lab_bytes = lab_source.read_bytes()
    info = module.prepare(lab_source, out)
    assert info["convertedToSrgb"] and info["profilePresent"] and not info["resized"]
    expected = ImageCms.profileToProfile(lab_image, lab_profile, srgb, renderingIntent=1, outputMode="RGB")
    with Image.open(out) as actual:
        assert actual.size == image.size
        assert actual.tobytes() == expected.tobytes()
        assert actual.info.get("icc_profile")
    assert lab_source.read_bytes() == lab_bytes

    # A normal tagged RGB JPEG also gets a lossless, colour-managed PNG,
    # retaining the decoded pixels to within the CMS's quantisation rounding.
    jpeg = folder / "tagged.jpg"
    image.save(jpeg, quality=95, icc_profile=srgb.tobytes())
    with Image.open(jpeg) as decoded:
        expected = ImageCms.profileToProfile(decoded, srgb, srgb, renderingIntent=1, outputMode="RGB")
    info = module.prepare(jpeg, out)
    with Image.open(out) as actual:
        assert actual.tobytes() == expected.tobytes() and actual.size == (108, 192)

    # EXIF geometry must agree with the image the native loader will see.
    rotated = folder / "rotated.jpg"
    exif = Image.Exif(); exif[274] = 6
    Image.new("RGB", (192, 108), (80, 20, 30)).save(rotated, exif=exif)
    info = module.prepare(rotated, out)
    assert (info["width"], info["height"]) == (108, 192)
    assert info["orientationApplied"] and not info["outputWritten"]

    corrupt = folder / "corrupt.png"
    image.save(corrupt, icc_profile=b"not-an-icc-profile")
    try:
        module.prepare(corrupt, out)
    except ValueError as exc:
        assert "Profil warna" in str(exc)
    else:
        raise AssertionError("Invalid colour metadata must fail before paid submission")
    hdr = folder / "16-bit.png"
    Image.new("I;16", (108, 192), 1024).save(hdr)
    try:
        module.prepare(hdr, out)
    except ValueError as exc:
        assert "tone mapping" in str(exc)
    else:
        raise AssertionError("Do not silently tone-map high-bit-depth photos")

print("PASS: unmodified RGB references, ICC conversion without resize/enhancement, EXIF geometry, invalid profiles and unsupported tone mapping")
