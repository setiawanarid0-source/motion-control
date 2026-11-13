"""Read only ZIP directory metadata, using HTTP ranges when supported."""
import io
import json
import shutil
import sys
import tempfile
import urllib.request
import zipfile


class RemoteArchive(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        self.position = 0
        self.full = None
        self.cache = []
        response = urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=-131072"}), timeout=30)
        with response:
            if response.status == 206:
                unit, bounds = response.headers["Content-Range"].split(" ", 1)
                span, total = bounds.split("/")
                start, end = map(int, span.split("-"))
                if unit != "bytes" or end - start + 1 > 131072:
                    raise ValueError("Invalid range")
                data = response.read(131073)
                if len(data) != end - start + 1:
                    raise ValueError("Incomplete range")
                self.length = int(total)
                self.cache.append((start, data))
            elif response.status == 200:
                self.capture_full(response)
            else:
                raise ValueError("Archive unavailable")

    def capture_full(self, response):
        self.full = tempfile.TemporaryFile()
        try:
            maximum = max(0, shutil.disk_usage(tempfile.gettempdir()).free - 64 * 1024 * 1024)
            self.length = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                self.length += len(chunk)
                if self.length > maximum:
                    raise ValueError("Temporary space exhausted")
                self.full.write(chunk)
            self.full.flush()
        except BaseException:
            self.full.close()
            raise

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.length + offset
        if self.position < 0:
            raise ValueError("Invalid seek")
        return self.position

    def read(self, size=-1):
        size = min(self.length - self.position, size if size >= 0 else self.length)
        if size <= 0:
            return b""
        start = self.position
        if self.full:
            self.full.seek(start)
            data = self.full.read(size)
        else:
            data = None
            for cached_start, cached in self.cache:
                if cached_start <= start and start + size <= cached_start + len(cached):
                    data = cached[start - cached_start:start - cached_start + size]
                    break
            if data is None:
                request = urllib.request.Request(self.url, headers={"Range": "bytes=%d-%d" % (start, start + size - 1)})
                with urllib.request.urlopen(request, timeout=30) as response:
                    if response.status == 200:
                        self.capture_full(response)
                        self.full.seek(start)
                        data = self.full.read(size)
                    elif response.status == 206:
                        data = response.read(size + 1)
                        if len(data) != size:
                            raise ValueError("Incomplete directory")
                    else:
                        raise ValueError("Directory unavailable")
        self.position += len(data)
        return data

    def close(self):
        if self.full:
            self.full.close()
        super().close()


def inspect(url):
    with RemoteArchive(url) as source, zipfile.ZipFile(source) as archive:
        files = [item for item in archive.infolist() if not item.is_dir()]
        videos = sum(item.filename.lower().endswith(".mp4") for item in files)
        pngs = sum(item.filename.lower().endswith(".png") for item in files)
        return {"videos": videos, "pngs": pngs, "files": len(files)}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        print(json.dumps(inspect(request["url"])))
    except Exception:
        # Do not print signed provider URLs or remote response text.
        print(json.dumps({"error": "ZIP directory unavailable"}))
        sys.exit(1)
