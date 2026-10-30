#!/bin/bash
set -u

if ! command -v buf >/dev/null 2>&1; then
  echo "Warning: 'buf' CLI not found. Skipping proto linting (install @bufbuild/buf or 'brew install buf')."
else
  buf lint

  if ! buf format -w --exit-code; then
    echo Proto files were formatted
  fi
fi

if grep -rn "rpc .*[A-Z][A-Z].*[(]" --include="*.proto"; then
  # See https://github.com/cline/cline/pull/7054
  echo Error: Proto RPC names cannot contain repeated capital letters
  exit 1
fi

