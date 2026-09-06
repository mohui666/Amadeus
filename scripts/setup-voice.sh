#!/usr/bin/env bash
set -euo pipefail
amadeus_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
voice_dir="$amadeus_dir/.local/voice"
mkdir -p "$voice_dir"
export UV_CACHE_DIR="$voice_dir/cache/uv"
export UV_PYTHON_INSTALL_DIR="$voice_dir/python"
export HF_HOME="$voice_dir/cache/huggingface"
export HF_HUB_DISABLE_XET=1
export HF_HUB_DOWNLOAD_TIMEOUT=60
export UV_HTTP_TIMEOUT=300
export XDG_CACHE_HOME="$voice_dir/cache"
export NLTK_DATA="$voice_dir/nltk_data"
if [ ! -d "$voice_dir/GPT-SoVITS/.git" ]; then
  git clone --depth 1 https://github.com/RVC-Boss/GPT-SoVITS.git "$voice_dir/GPT-SoVITS"
fi
python3 -m venv "$voice_dir/bootstrap"
"$voice_dir/bootstrap/bin/pip" install uv
uv_bin="$voice_dir/bootstrap/bin/uv"
"$uv_bin" python install 3.11
"$uv_bin" venv --python 3.11 "$voice_dir/venv" --allow-existing
"$uv_bin" pip install --python "$voice_dir/venv/bin/python" torch==2.7.0 torchaudio==2.7.0 --index-url https://pypi.org/simple
"$uv_bin" pip install --python "$voice_dir/venv/bin/python" -r "$amadeus_dir/scripts/setup-voice.requirements.txt" torch==2.7.0 torchaudio==2.7.0
"$voice_dir/venv/bin/python" "$amadeus_dir/scripts/setup-voice.py"
printf '本地语音安装完成。启动：bash %s/scripts/start-voice.sh\n' "$amadeus_dir"
