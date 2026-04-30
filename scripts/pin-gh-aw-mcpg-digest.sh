#!/usr/bin/env bash
set -euo pipefail

IMAGE="ghcr.io/github/gh-aw-mcpg:v0.3.0"
DIGEST="sha256:9c2228324fb1f26f39dc9471612e530ae3efc3156dac05efb2e8d212878d454d"
PINNED_IMAGE="${IMAGE}@${DIGEST}"

if [ "$#" -eq 0 ]; then
  set -- .github/workflows/*.lock.yml
fi

for file in "$@"; do
  [ -f "$file" ] || continue
  GH_AW_MCPG_IMAGE="$IMAGE" GH_AW_MCPG_DIGEST="$DIGEST" GH_AW_MCPG_PINNED_IMAGE="$PINNED_IMAGE" perl -0pi -e '
    BEGIN {
      $image = $ENV{"GH_AW_MCPG_IMAGE"};
      $digest = $ENV{"GH_AW_MCPG_DIGEST"};
      $pinned_image = $ENV{"GH_AW_MCPG_PINNED_IMAGE"};
      $image_pattern = quotemeta($image);
      $unpinned_image_pattern = qr/(?<![[:alnum:]_\.\/-])$image_pattern(?!\@sha256|[[:alnum:]_.-])/;
      $unpinned_json_pattern = quotemeta(qq({"image":"$image"}));
      $pinned_json = qq({"image":"$pinned_image","digest":"$digest","pinned_image":"$pinned_image"});
    }
    s#$unpinned_json_pattern#$pinned_json#g;
    s#$unpinned_image_pattern#$pinned_image#g;
    s#[ \t]+$##mg;
    s#\n+\z#\n#;
  ' "$file"
  if ! GH_AW_MCPG_IMAGE="$IMAGE" perl -0ne '
    BEGIN {
      $image_pattern = quotemeta($ENV{"GH_AW_MCPG_IMAGE"});
      $unpinned_image_pattern = qr/(?<![[:alnum:]_\.\/-])$image_pattern(?!\@sha256|[[:alnum:]_.-])/;
    }
    exit(/$unpinned_image_pattern/ ? 1 : 0)
  ' "$file"; then
    echo "Failed to pin $IMAGE in $file" >&2
    exit 1
  fi
  echo "Pinned $PINNED_IMAGE in $file"
done
