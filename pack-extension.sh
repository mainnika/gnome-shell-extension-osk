#!/usr/bin/env sh
set -eu

gnome-extensions pack --force \
  --extra-source=physicalLayouts.json \
  --extra-source=keycodes.tar.xz \
  --extra-source=ui \
  --out-dir "${1:-.}" \
  gjsosk@vishram1123.com
