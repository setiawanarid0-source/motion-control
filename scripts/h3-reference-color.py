"""Prepare reference colour for native H3 without resizing or image enhancement."""
import io
import json
import sys
import warnings

from PIL import Image, ImageCms, ImageOps

Image.MAX_IMAGE_PIXELS = 32_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)


def prepare(source_path, output_path):
    with Image.open(source_path) as source:
        if getattr(source, "n_frames", 1) != 1:
            raise ValueError("Gambar referensi H3 harus berupa satu foto, bukan animasi.")
        original_size = source.size
        if source.mode in ("I", "I;16", "I;16B", "F"):
            raise ValueError("Foto HDR/16-bit belum didukung; tidak dilakukan tone mapping otomatis.")
        orientation = source.getexif().get(274, 1)
        profile_bytes = source.info.get("icc_profile")
        image = ImageOps.exif_transpose(source)
        image.load()
        result = {
            "width": image.width, "height": image.height,
            "sourceWidth": original_size[0], "sourceHeight": original_size[1],
            "orientationApplied": orientation in range(2, 9),
            "sourceMode": source.mode, "profilePresent": bool(profile_bytes),
            "profileName": None, "convertedToSrgb": False,
            "resized": False, "outputWritten": False,
        }
        if profile_bytes:
            try:
                profile = ImageCms.ImageCmsProfile(io.BytesIO(profile_bytes))
                profile_name = ImageCms.getProfileName(profile).strip()
                result["profileName"] = "".join(c for c in profile_name if c.isprintable())[:100]
                # Native LoadImage converts to RGB but does not apply embedded ICC.
                # Convert colour coordinates, never geometry, contrast or texture.
                alpha = image.getchannel("A") if image.mode == "RGBA" else None
                cms_input = image.convert("RGB") if alpha is not None else image
                srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))
                image = ImageCms.profileToProfile(cms_input, profile, srgb,
                    renderingIntent=1, outputMode="RGB")
                if alpha is not None:
                    image.putalpha(alpha)
                image.save(output_path, format="PNG", icc_profile=srgb.tobytes())
                result.update(convertedToSrgb=True, outputWritten=True)
            except Exception as exc:
                raise ValueError("Profil warna foto tidak dapat dibaca; warna tidak diubah secara diam-diam.") from exc
        # Untagged RGB/JPEG/PNG stays byte-for-byte original. Native LoadImage
        # performs the same EXIF orientation used above for dimensions.
        return result


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Expected source and destination paths")
        print(json.dumps(prepare(sys.argv[1], sys.argv[2])))
    except Exception as exc:
        message = str(exc) if isinstance(exc, ValueError) else "File gambar H3 tidak dapat dibaca."
        print(json.dumps({"error": message[:180]}))
        sys.exit(1)
