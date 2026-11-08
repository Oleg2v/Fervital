#!/usr/bin/env bash
# Encode captured rack frames into the 6-second fallback video + poster.
#   1. npm run dev  (port 3000)
#   2. node scripts/video/capture-frames.mjs /tmp/frames-portrait 720 1280 180 high
#      node scripts/video/capture-frames.mjs /tmp/frames-landscape 1280 720 180 high
#   3. bash scripts/video/encode.sh /tmp/frames-portrait portrait
#      bash scripts/video/encode.sh /tmp/frames-landscape landscape
set -euo pipefail
FRAMES=${1:?frames dir}
NAME=${2:?portrait|landscape}
OUT=$(dirname "$0")/../../public/video
mkdir -p "$OUT"
ffmpeg -y -loglevel error -framerate 30 -i "$FRAMES/f%04d.png" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -profile:v high -movflags +faststart -an \
  "$OUT/rack-pull-$NAME.mp4"
ffmpeg -y -loglevel error -i "$FRAMES/f0110.png" -q:v 3 "$OUT/rack-pull-$NAME.jpg"
ls -la "$OUT"
