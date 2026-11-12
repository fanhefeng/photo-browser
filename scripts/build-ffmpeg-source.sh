#!/usr/bin/env bash
# Build only from pinned source archives. No third-party precompiled codec binaries.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${FFMPEG_WORK_DIR:-$ROOT/.ffmpeg-build}"
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || { echo "Requires an Apple Silicon macOS builder" >&2; exit 1; }
mkdir -p "$WORK/sources" "$WORK/sidecars"
export MACOSX_DEPLOYMENT_TARGET=11.0
fetch() {
  local file="$1" url="$2" sha="$3"
  if [[ ! -f "$WORK/sources/$file" && -f "$ROOT/sources/$file" ]]; then cp "$ROOT/sources/$file" "$WORK/sources/$file"; fi
  if [[ ! -f "$WORK/sources/$file" ]]; then curl -fL --retry 3 --max-time 180 "$url" -o "$WORK/sources/$file"; fi
  printf '%s  %s\n' "$sha" "$WORK/sources/$file" | shasum -a 256 -c -
}
fetch ffmpeg-9.0.2.tar.xz https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz 8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
fetch dav1d-1.5.4.tar.xz https://download.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz 686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5
fetch pkgconf-2.5.1.tar.xz https://distfiles.ariadne.space/pkgconf/pkgconf-2.5.1.tar.xz cd05c9589b9f86ecf044c10a2269822bc9eb001eced2582cfffd658b0a50c243
cd "$WORK"
for archive in sources/*.tar.xz; do tar -xf "$archive"; done
python3 -m venv tools
# Build tools only, not included in the application's runtime.
tools/bin/python -m pip install --only-binary=:all: meson==1.9.1 ninja==1.13.0
export PATH="$WORK/tools/bin:$PATH"
(cd pkgconf-2.5.1 && ./configure --prefix="$WORK/tools-native" --disable-shared && make -j4 && make install)
meson setup dav1d-build dav1d-1.5.4 --prefix="$WORK/prefix" --default-library=static --buildtype=release -Denable_tools=false -Denable_tests=false -Dc_args=-mmacosx-version-min=11.0 --wipe
ninja -C dav1d-build install
cd ffmpeg-9.0.2
PKG_CONFIG_PATH="$WORK/prefix/lib/pkgconfig" ./configure \
  --prefix="$WORK/output" --pkg-config="$WORK/tools-native/bin/pkgconf" --pkg-config-flags=--static \
  --disable-autodetect --disable-network --disable-doc --disable-debug --disable-ffplay \
  --disable-shared --enable-static --enable-libdav1d --enable-zlib \
  --enable-videotoolbox --enable-audiotoolbox \
  --extra-cflags=-mmacosx-version-min=11.0 --extra-ldflags=-mmacosx-version-min=11.0
make -j"${BUILD_JOBS:-4}"
make install
cd "$WORK"
for tool in ffmpeg ffprobe; do
  cp "output/bin/$tool" "sidecars/$tool-aarch64-apple-darwin"
  # Fail if any non-system runtime dependency sneaked into the app.
  otool -L "output/bin/$tool" | tail -n +2 | awk '{ print $1 }' | while read -r lib; do
    case "$lib" in /usr/lib/*|/System/Library/*) ;; *) echo "Unexpected runtime dependency: $lib" >&2; exit 1;; esac
  done
  "output/bin/$tool" -version > "$tool-version.txt" 2>&1
  "output/bin/$tool" -L > "$tool-license.txt" 2>&1
done
grep -q 'GNU Lesser General Public' ffmpeg-license.txt
grep -q 'version 2.1' ffmpeg-license.txt
# Offer the full exact sources (including dav1d and build-tool source), plus build instructions.
mkdir -p source-distribution/scripts source-distribution/sources
cp sources/*.tar.xz source-distribution/sources/
cp "$ROOT/scripts/build-ffmpeg-source.sh" source-distribution/scripts/
cp "$ROOT/THIRD_PARTY_NOTICES.md" source-distribution/
cp -R "$ROOT/licenses" source-distribution/
cp ffmpeg-version.txt ffprobe-version.txt ffmpeg-license.txt ffprobe-license.txt source-distribution/
cp ffmpeg-9.0.2/ffbuild/config.log source-distribution/ffmpeg-config.log
printf 'Built on: '; sw_vers
{ sw_vers; clang --version; shasum -a 256 sources/*.tar.xz; } > source-distribution/BUILD-INFO.txt
tar -czf photo-browser-ffmpeg-sources.tar.gz -C source-distribution .
echo "Sidecars: $WORK/sidecars; corresponding sources: $WORK/photo-browser-ffmpeg-sources.tar.gz"
