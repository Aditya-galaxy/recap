#!/bin/zsh
# Builds Recap.app into ./build and (optionally) installs it to /Applications.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
APP=build/Recap.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/Recap "$APP/Contents/MacOS/Recap"
cp Resources/Info.plist "$APP/Contents/Info.plist"

if [[ ! -f build/AppIcon.icns ]]; then
  ICONSET=build/AppIcon.iconset
  mkdir -p "$ICONSET"
  swift Resources/make-icon.swift build/icon-1024.png
  for s in 16 32 128 256 512; do
    sips -z $s $s build/icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) build/icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o build/AppIcon.icns
fi
cp build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

# Ad-hoc signature. macOS ties Screen Recording permission to the signature, so after a
# rebuild you may need to re-enable Recap in System Settings.
codesign --force --deep --sign - "$APP"
echo "built $APP"

if [[ "${1:-}" == "--install" ]]; then
  rm -rf /Applications/Recap.app
  cp -R "$APP" /Applications/
  echo "installed /Applications/Recap.app"
fi
