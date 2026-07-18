#!/usr/bin/env bash
# 원본 img/ 폴더를 웹용 원본·썸네일로 변환하고 manifest.json을 원자적으로 갱신한다.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMG="$ROOT/img"
OUT="$ROOT/assets"
MANIFEST="$ROOT/manifest.json"
SIPS="$(command -v sips || true)"
FFMPEG="$(command -v ffmpeg || true)"
FFPROBE="$(command -v ffprobe || true)"

for tool in "$SIPS" "$FFMPEG" "$FFPROBE"; do
  if [[ -z "$tool" ]]; then
    echo "ERROR: sips, ffmpeg, ffprobe가 모두 필요합니다." >&2
    exit 1
  fi
done

DAY_DIRS=("7월12일(일)" "7월13일(월)" "7월14일(화)" "7월15일(수)")

mkdir -p "$OUT"
json_items=()

add_item() { # file thumb w h day type
  json_items+=("{\"file\":\"$1\",\"thumb\":\"$2\",\"w\":$3,\"h\":$4,\"day\":$5,\"type\":\"$6\"}")
}

get_dims() { # path -> "W H"
  "$SIPS" -g pixelWidth -g pixelHeight "$1" 2>/dev/null \
    | awk '/pixelWidth/{w=$2}/pixelHeight/{h=$2}END{print w, h}'
}

fingerprint() { # source -> relative-path|size|mtime
  local source="$1" size mtime
  size="$(stat -f '%z' "$source" 2>/dev/null || stat -c '%s' "$source")"
  mtime="$(stat -f '%m' "$source" 2>/dev/null || stat -c '%Y' "$source")"
  printf '%s|%s|%s' "${source#"$ROOT"/}" "$size" "$mtime"
}

needs_refresh() { # destination metadata fingerprint
  local destination="$1" metadata="$2" expected="$3"
  [[ -s "$destination" ]] || return 0
  # 기존 프로젝트의 첫 실행은 결과물을 신뢰하고 추적 정보만 생성한다.
  [[ -f "$metadata" ]] || return 1
  [[ "$(<"$metadata")" != "$expected" ]]
}

for i in 0 1 2 3; do
  day=$((i + 1))
  src="$IMG/${DAY_DIRS[$i]}"
  pdir="$OUT/photos/day$day"
  vdir="$OUT/videos/day$day"
  tdir="$OUT/thumbs/day$day"
  cdir="$OUT/.source-map/day$day"
  mkdir -p "$pdir" "$vdir" "$tdir" "$cdir"

  n=0
  while IFS= read -r f; do
    n=$((n + 1))
    base="$(printf '%03d' "$n")"
    dst="$pdir/$base.jpg"
    thumb="$tdir/$base.jpg"
    meta="$cdir/$base.photo"
    fp="$(fingerprint "$f")"
    version="${fp#*|}"; version="${version//|/-}"
    refresh=0
    if needs_refresh "$dst" "$meta" "$fp"; then refresh=1; fi

    if (( refresh )); then
      tmp="$pdir/.${base}.tmp.jpg"
      "$SIPS" -s format jpeg -s formatOptions 78 -Z 1600 "$f" --out "$tmp" >/dev/null
      mv "$tmp" "$dst"
    fi
    if (( refresh )) || [[ ! -s "$thumb" ]]; then
      tmp="$tdir/.${base}.tmp.jpg"
      "$SIPS" -s format jpeg -s formatOptions 76 -Z 640 "$dst" --out "$tmp" >/dev/null
      mv "$tmp" "$thumb"
    fi
    printf '%s' "$fp" > "$meta"

    read -r w h <<< "$(get_dims "$dst")"
    add_item "assets/photos/day$day/$base.jpg?v=$version" "assets/thumbs/day$day/$base.jpg?v=$version" \
      "${w:-1600}" "${h:-1200}" "$day" "photo"
  done < <(find "$src" -maxdepth 1 -type f \( -iname '*.heic' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) | sort)

  m=0
  while IFS= read -r f; do
    m=$((m + 1))
    base="$(printf 'v%02d' "$m")"
    dst="$vdir/$base.mp4"
    thumb="$tdir/$base.jpg"
    meta="$cdir/$base.video"
    fp="$(fingerprint "$f")"
    version="${fp#*|}"; version="${version//|/-}"
    refresh=0
    if needs_refresh "$dst" "$meta" "$fp"; then refresh=1; fi

    if (( refresh )); then
      tmp="$vdir/.${base}.tmp.mp4"
      "$FFMPEG" -nostdin -y -i "$f" -vf "scale='min(1280,iw)':-2" -c:v libx264 -preset fast -crf 26 \
        -c:a aac -b:a 96k -movflags +faststart "$tmp" >/dev/null 2>&1
      mv "$tmp" "$dst"
    fi
    if (( refresh )) || [[ ! -s "$thumb" ]]; then
      tmp="$tdir/.${base}.tmp.jpg"
      "$FFMPEG" -nostdin -y -ss 0.1 -i "$dst" -frames:v 1 -vf "scale='min(640,iw)':-2" \
        -q:v 5 "$tmp" >/dev/null 2>&1
      mv "$tmp" "$thumb"
    fi
    printf '%s' "$fp" > "$meta"

    dims="$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$dst")"
    IFS=x read -r w h _ <<< "$dims"
    add_item "assets/videos/day$day/$base.mp4?v=$version" "assets/thumbs/day$day/$base.jpg?v=$version" \
      "${w:-1280}" "${h:-720}" "$day" "video"
  done < <(find "$src" -maxdepth 1 -type f \( -iname '*.mov' -o -iname '*.mp4' \) | sort)

  echo "day$day: photos=$n videos=$m"
done

manifest_tmp="$(mktemp "$ROOT/.manifest.XXXXXX")"
items_tmp="$(mktemp "$ROOT/.manifest-items.XXXXXX")"
cleanup() {
  [[ -e "$manifest_tmp" ]] && rm -f "$manifest_tmp"
  [[ -e "$items_tmp" ]] && rm -f "$items_tmp"
}
trap cleanup EXIT
printf '%s\n' "${json_items[@]}" > "$items_tmp"
python3 - "$items_tmp" "$manifest_tmp" <<'PY'
import json
import sys

items_path, manifest_path = sys.argv[1:]
with open(items_path, encoding="utf-8") as source:
    items = []
    for line_number, line in enumerate(source, 1):
        if not line.strip():
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise ValueError(f"invalid manifest item {line_number}: {line.rstrip()!r}") from error
manifest = {
    "days": ["Day 1 · 7/12 (일)", "Day 2 · 7/13 (월)", "Day 3 · 7/14 (화)", "Day 4 · 7/15 (수)"],
    "items": items,
}
with open(manifest_path, "w", encoding="utf-8") as destination:
    json.dump(manifest, destination, ensure_ascii=False, separators=(",", ":"))
    destination.write("\n")
PY
mv "$manifest_tmp" "$MANIFEST"
rm -f "$items_tmp"
trap - EXIT
echo "manifest: ${#json_items[@]} items"
echo "DONE"
