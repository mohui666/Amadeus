#!/usr/bin/env bash
set -euo pipefail
amadeus_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
voice_dir="$amadeus_dir/.local/voice"
export HF_HOME="$voice_dir/cache/huggingface"
export XDG_CACHE_HOME="$voice_dir/cache"
export NLTK_DATA="$voice_dir/nltk_data"
export PATH="$voice_dir/bin:$voice_dir/venv/bin:$PATH"
export OMP_NUM_THREADS=4
export language=en_US
cd "$voice_dir/GPT-SoVITS"
exec "$voice_dir/venv/bin/python" -u api_v2.py -a 127.0.0.1 -p 19880 -c "$voice_dir/tts.yaml"
