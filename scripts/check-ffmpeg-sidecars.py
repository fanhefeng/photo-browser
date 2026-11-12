#!/usr/bin/env python3
"""Check bundled codec tools using synthetic, non-private video fixtures."""
import json, pathlib, subprocess, sys, tarfile, tempfile
root = pathlib.Path(__file__).resolve().parent.parent
binary = pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="photo-video-check-") as temp:
    folder = pathlib.Path(temp)
    with tarfile.open(root / "tests/fixtures/videos.tar.gz") as archive:
        for item in archive.getmembers():
            if not item.isfile() or pathlib.Path(item.name).name != item.name:
                raise ValueError("Unexpected fixture archive entry")
            with archive.extractfile(item) as source:
                (folder / item.name).write_bytes(source.read())
    results = []
    for video in sorted(folder.iterdir()):
        if video.suffix == ".jpg": continue
        data = json.loads(subprocess.check_output([str(binary / "ffprobe"), "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(video)], timeout=30))
        stream = next(s for s in data["streams"] if s.get("codec_type") == "video")
        expected = (176, 144) if video.suffix == ".3gp" else (320, 240)
        assert (stream["width"], stream["height"]) == expected, video.name
        poster = folder / (video.name + ".jpg")
        for seek in (["-ss", "1"], []):
            result = subprocess.run([str(binary / "ffmpeg"), "-v", "error", "-y", *seek, "-i", str(video), "-frames:v", "1", "-vf", "scale='min(640,iw)':'min(640,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:out_range=full", "-pix_fmt", "yuvj420p", "-q:v", "3", str(poster)], capture_output=True, timeout=30)
            if result.returncode == 0 and poster.exists() and poster.stat().st_size > 0: break
        assert result.returncode == 0 and poster.exists() and poster.read_bytes().startswith(b"\xff\xd8"), (video.name, result.stderr)
        results.append({"file": video.name, "codec": stream["codec_name"], "poster_bytes": poster.stat().st_size})
    assert len(results) == 14
    print(json.dumps(results, indent=2))
