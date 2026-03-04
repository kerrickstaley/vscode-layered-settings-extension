#!/usr/bin/env bash
set -euo pipefail

if [ -n "$(git status --porcelain)" ]; then
    echo "error: uncommitted changes; commit or stash first" >&2
    exit 1
fi

base_version=$(node -p "require('./package.json').version")
sha=$(git rev-parse --short HEAD)
version="${base_version}-${sha}"

npm run compile
npx @vscode/vsce package --no-update-package-json "$version"
