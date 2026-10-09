#!/usr/bin/env bash
# Encode music tracks for the game: MP3 128 kbps, 44.1 kHz, no tags or cover art.
# Output goes to src/assets/music/<slug>.mp3, which the build picks up (the folder is not in git).
#
#   scripts/music.sh                      # every track in resources/music/
#   scripts/music.sh ~/Downloads/a.wav    # specific files, any format ffmpeg reads
#   BITRATE=96k scripts/music.sh          # other bitrate
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/src/assets/music"
bitrate="${BITRATE:-128k}"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 1; }

if [ $# -eq 0 ]; then
  shopt -s nullglob nocaseglob
  set -- "$root"/resources/music/*.{mp3,wav,flac,ogg,m4a}
  [ $# -gt 0 ] || { echo "no tracks in resources/music/" >&2; exit 1; }
fi

mkdir -p "$out"
for src in "$@"; do
  # "Night Shift.mp3" -> night-shift.mp3
  name="$(basename "${src%.*}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')"
  dst="$out/$name.mp3"
  ffmpeg -hide_banner -loglevel error -y -i "$src" -map 0:a -map_metadata -1 \
    -c:a libmp3lame -b:a "$bitrate" -ar 44100 "$dst"
  echo "$(basename "$src") -> src/assets/music/$name.mp3 ($(du -h "$dst" | cut -f1))"
done
