#!/bin/bash
# Build (and bake) every room tile, then pack the .glb files.
#   tools/room-pipeline/build_all.sh [size] [samples] [room ...]
#   final quality: tools/room-pipeline/build_all.sh 1024 48        quick preview: ... 512 12
set -u
cd "$(dirname "$0")/../.."
SIZE=${1:-1024}; SAMPLES=${2:-48}; shift 2 2>/dev/null
ROOMS=${*:-$(python3 -c "import json;print(' '.join(json.load(open('tools/room-pipeline/rooms.json'))['rooms']))")}
mkdir -p tools/room-pipeline/build
for r in $ROOMS; do
  t0=$(date +%s)
  python3 tools/room-pipeline/make_room.py --room "$r" --size "$SIZE" --floorsize "$SIZE" --samples "$SAMPLES" > "tools/room-pipeline/build/$r.log" 2>&1
  if [ -f "assets/models/rooms/$r.glb" ] && grep -q "^exported" "tools/room-pipeline/build/$r.log"; then
    python3 tools/room-pipeline/pack_glb.py "assets/models/rooms/$r.glb" > /dev/null
    echo "$r ok $(( $(date +%s) - t0 ))s"
  else
    echo "$r FAILED (see tools/room-pipeline/build/$r.log)"
  fi
done
