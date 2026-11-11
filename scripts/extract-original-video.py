"""Copy the sole MP4 from a workflow ZIP, preserving every byte and checking CRC.

No decode, crop, watermark processing, FPS conversion or re-encoding.
Only a fixed destination is written; archive paths are never used for extraction.
"""
import hashlib
import json
from pathlib import PurePosixPath
import stat
import sys
import zipfile

archive, destination, limit = sys.argv[1:]
limit = int(limit)
with zipfile.ZipFile(archive) as package:
    entries = package.infolist()
    if len(entries) > 1000:
        raise ValueError('Too many ZIP entries')
    videos = [entry for entry in entries if not entry.is_dir() and entry.filename.lower().endswith('.mp4')]
    if len(videos) != 1:
        raise ValueError('ZIP must contain exactly one final MP4')
    entry = videos[0]
    name = PurePosixPath(entry.filename)
    if name.is_absolute() or '..' in name.parts or '\\' in entry.filename or ':' in entry.filename:
        raise ValueError('Unsafe ZIP member path')
    if entry.flag_bits & 1 or stat.S_ISLNK(entry.external_attr >> 16):
        raise ValueError('Encrypted or linked ZIP entry')
    if entry.file_size < 1024 or entry.file_size > limit:
        raise ValueError('Original video exceeds available temporary disk space')
    if entry.file_size > max(1, entry.compress_size) * 1000:
        raise ValueError('Excessive ZIP expansion')
    digest = hashlib.sha256()
    total = 0
    with package.open(entry) as source, open(destination, 'xb') as output:
        first = source.read(32)
        if first[4:8] != b'ftyp':
            raise ValueError('ZIP member is not an MP4')
        chunk = first
        while chunk:
            total += len(chunk)
            if total > limit:
                raise ValueError('Original video exceeds available temporary disk space')
            output.write(chunk)
            digest.update(chunk)
            chunk = source.read(1024 * 1024)
    if total != entry.file_size:
        raise ValueError('Incomplete MP4 extraction')
    print(json.dumps({'member': entry.filename, 'bytes': total, 'sha256': digest.hexdigest()}))
