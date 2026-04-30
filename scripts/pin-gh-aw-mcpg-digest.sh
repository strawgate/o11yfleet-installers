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
  perl -0pi -e '
    s#\{"image":"ghcr\.io/github/gh-aw-mcpg:v0\.3\.0"\}#{"image":"ghcr.io/github/gh-aw-mcpg:v0.3.0\@sha256:9c2228324fb1f26f39dc9471612e530ae3efc3156dac05efb2e8d212878d454d","digest":"sha256:9c2228324fb1f26f39dc9471612e530ae3efc3156dac05efb2e8d212878d454d","pinned_image":"ghcr.io/github/gh-aw-mcpg:v0.3.0\@sha256:9c2228324fb1f26f39dc9471612e530ae3efc3156dac05efb2e8d212878d454d"}#g;
    s#ghcr\.io/github/gh-aw-mcpg:v0\.3\.0(?!\@sha256)#ghcr.io/github/gh-aw-mcpg:v0.3.0\@sha256:9c2228324fb1f26f39dc9471612e530ae3efc3156dac05efb2e8d212878d454d#g;
    s#[ \t]+$##mg;
    s#\n+\z#\n#;
  ' "$file"
  if perl -0ne 'exit(/ghcr\.io\/github\/gh-aw-mcpg:v0\.3\.0(?!\@sha256)/ ? 1 : 0)' "$file"; then
    :
  else
    echo "Failed to pin $IMAGE in $file" >&2
    exit 1
  fi
  echo "Pinned $PINNED_IMAGE in $file"
done
