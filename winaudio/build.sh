#!/usr/bin/env bash
# Build F88TiviAudio.exe chạy độc lập (không cần cài .NET) -> winaudio/publish/F88TiviAudio.exe
# Cần: .NET SDK 8 (winget install Microsoft.DotNet.SDK.8 --source winget)
set -e
cd "$(dirname "$0")"
DOTNET="${DOTNET:-dotnet}"; command -v "$DOTNET" >/dev/null || DOTNET="/c/Program Files/dotnet/dotnet.exe"
"$DOTNET" publish -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true \
  -o publish
ls -l publish/F88TiviAudio.exe
