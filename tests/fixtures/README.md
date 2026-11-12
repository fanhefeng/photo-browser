# Synthetic video regression fixtures

All 14 videos were generated from FFmpeg `testsrc2=size=320x240:rate=8`, with 1.5 seconds of video and no audio. They contain no private/user footage. The test exercises the application's exact ffprobe metadata and JPEG poster flow, including first-frame fallback.

Codec/container cases: H.264 MP4/M4V/MTS/M2TS, HEVC MOV, VP8/VP9 WebM, AV1 MKV, ProRes MOV, MPEG-4 AVI, MPEG-2 MPG, WMV2 WMV, FLV1 FLV and H.263 3GP. H.263 is resized to 176x144; others are 320x240. These synthetic samples do not prove every real-world codec/profile or malformed input works.

Generated with the locally installed Homebrew FFmpeg 9.0.2. Encoder choices: libx264, libx265, libvpx, libvpx-vp9, libsvtav1, prores_ks, mpeg4, mpeg2video, wmv2, flv and h263. No FFmpeg binaries or libraries are included in this fixture archive.
