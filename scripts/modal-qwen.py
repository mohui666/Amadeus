"""Deploy the current Kurisu Qwen3-TTS voice: modal deploy scripts/modal-qwen.py."""
from pathlib import Path

import modal

APP_NAME = 'amadeus-kurisu-tts'
MODEL_REPO = 'starrydark/Kurisu_Qwen3_TTS'
# Revision already used by the Windows installation.
MODEL_REVISION = 'e70b20c9e08a08d516328b35feb9505972a6038b'
MODEL_PATH = '/models/kurisu'


def download_model():
    from huggingface_hub import snapshot_download

    snapshot_download(
        MODEL_REPO,
        revision=MODEL_REVISION,
        local_dir=MODEL_PATH,
        allow_patterns=['*.json', '*.safetensors', 'merges.txt', 'vocab.json'],
    )


image = (
    modal.Image.debian_slim(python_version='3.11')
    .apt_install('ffmpeg', 'libsndfile1', 'sox')
    .pip_install('torch==2.8.0', index_url='https://download.pytorch.org/whl/cu126')
    .pip_install(
        'qwen-tts==0.1.1', 'transformers==4.57.3', 'accelerate==1.12.0',
        'fastapi==0.119.0', 'uvicorn==0.37.0', 'soundfile==0.14.0',
    )
    .pip_install('torchaudio==2.8.0', index_url='https://download.pytorch.org/whl/cu126')
    .run_function(download_model)
    .env({
        'QWEN_MODEL_PATH': MODEL_PATH,
        'FFMPEG_BINARY': '/usr/bin/ffmpeg',
        'HF_HUB_OFFLINE': '1',
        'OMP_NUM_THREADS': '4',
        'TOKENIZERS_PARALLELISM': 'false',
    })
    .add_local_file(Path(__file__).with_name('qwen-api.py'), '/opt/amadeus/scripts/qwen_api.py', copy=True)
)

app = modal.App(APP_NAME)

with image.imports():
    import torch
    import qwen_tts
    import soundfile
    import fastapi
    import uvicorn


@app.function(
    image=image, gpu='L40S', cpu=2, memory=8192,
    min_containers=0, max_containers=1, scaledown_window=60,
    timeout=300, startup_timeout=600, include_source=False,
    enable_memory_snapshot=True,
)
@modal.asgi_app(requires_proxy_auth=True)
def api():
    import sys
    import torch

    sys.path.insert(0, '/opt/amadeus/scripts')
    from qwen_api import app as web_app

    torch.set_num_threads(4)
    return web_app
