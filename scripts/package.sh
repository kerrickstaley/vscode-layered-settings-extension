#!/usr/bin/env bash
set -euo pipefail

release=0
for arg in "$@"; do
    case "$arg" in
        --release) release=1 ;;
        *) echo "error: unknown argument: $arg" >&2; exit 1 ;;
    esac
done

if [ -n "$(git status --porcelain)" ]; then
    echo "error: uncommitted changes; commit or stash first" >&2
    exit 1
fi

npm run compile

if [ "$release" = 1 ]; then
    npx @vscode/vsce package
else
    base_version=$(node -p "require('./package.json').version")
    sha=$(git rev-parse --short HEAD)
    npx @vscode/vsce package --no-update-package-json "${base_version}-${sha}"
fi
