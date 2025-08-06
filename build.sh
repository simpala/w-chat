#!/bin/bash
set -e
echo "--- Installing Wails ---"
go install github.com/wailsapp/wails/v2/cmd/wails
echo "--- Building application ---"
~/go/bin/wails build -tags webkit2_41
echo "--- Build complete ---"
