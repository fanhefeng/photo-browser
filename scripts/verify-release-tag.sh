#!/usr/bin/env bash
# Never attach assets from another commit to an existing release tag.
set -euo pipefail
TAG="${1:?tag required}"
EXPECTED="${2:?expected commit required}"
REQUIRED="${3:-optional}"
EXPECTED_SHA=$(git rev-parse --verify "${EXPECTED}^{commit}")
if TAG_SHA=$(git rev-parse --verify --quiet "refs/tags/${TAG}^{commit}"); then
  if [[ "$TAG_SHA" != "$EXPECTED_SHA" ]]; then
    echo "::error::Release tag $TAG points to $TAG_SHA, not build commit $EXPECTED_SHA. Refusing to replace assets; bump the version or rerun the exact tagged commit." >&2
    exit 1
  fi
elif [[ "$REQUIRED" == required ]]; then
  echo "::error::Release tag $TAG does not exist; refusing publication." >&2
  exit 1
fi
