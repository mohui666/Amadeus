#!/usr/bin/env bash
set -euo pipefail
amadeus_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export HF_HUB_OFFLINE=1
export HF_HUB_DISABLE_XET=1
export OMP_NUM_THREADS=4
export PATH="$amadeus_dir/.local/voice/bin:$amadeus_dir/.local/qwen-tts/venv/bin:$PATH"
exec "$amadeus_dir/.local/qwen-tts/venv/bin/python" -u "$amadeus_dir/scripts/qwen-api.py" "$@"
