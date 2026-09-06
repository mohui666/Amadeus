"""Local OpenAI-compatible speech endpoint for starrydark's Kurisu Qwen3-TTS model."""
import argparse
import io
import os
import sys
from pathlib import Path
import subprocess
import threading
from contextlib import asynccontextmanager
from typing import Literal

import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from qwen_tts import Qwen3TTSModel

ROOT = Path(__file__).resolve().parents[1]
if sys.platform == 'win32':
    from imageio_ffmpeg import get_ffmpeg_exe
    FFMPEG = get_ffmpeg_exe()
else:
    FFMPEG = os.environ.get('FFMPEG_BINARY', str(ROOT / '.local/voice/bin/ffmpeg'))
inference_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    app.state.tts = Qwen3TTSModel.from_pretrained(
        app.state.model_path, device_map='cuda:0', dtype=torch.bfloat16,
        attn_implementation='sdpa',
    )
    app.state.tts.model.eval()
    yield


app = FastAPI(lifespan=lifespan)
app.state.model_path = os.environ.get('QWEN_MODEL_PATH', str(ROOT / '.local/qwen-tts/models/starrydark-kurisu'))


class SpeechRequest(BaseModel):
    model: str = 'kurisu'
    input: str = Field(min_length=1, max_length=4000)
    voice: str = 'kurisu'
    language: Literal['Auto', 'Chinese', 'Japanese', 'English'] = 'Auto'
    response_format: str = 'wav'
    speed: float = Field(default=1, ge=0.5, le=2)


@app.get('/health')
def health():
    return {'status': 'ok', 'engine': 'qwen3-tts', 'model': 'kurisu', 'checkpoint': app.state.model_path}


@app.post('/v1/audio/speech')
def speech(body: SpeechRequest):
    if body.model != 'kurisu' or body.voice != 'kurisu':
        raise HTTPException(400, '当前加载的模型和声音 ID 都是 kurisu。')
    if body.response_format not in ('wav', 'mp3'):
        raise HTTPException(400, '此本机接口支持 wav 或 mp3。')
    with inference_lock, torch.inference_mode():
        wavs, rate = app.state.tts.generate_custom_voice(
            text=body.input, speaker='kurisu', language=body.language,
            max_new_tokens=1200, non_streaming_mode=True,
        )
    output = io.BytesIO()
    sf.write(output, wavs[0], rate, format='WAV', subtype='PCM_16')
    audio = output.getvalue()
    if body.speed != 1 or body.response_format == 'mp3':
        command = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0']
        if body.speed != 1:
            command += ['-af', f'atempo={body.speed}']
        command += ['-f', body.response_format, 'pipe:1']
        audio = subprocess.run(command, input=audio, capture_output=True, check=True,
                               creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0).stdout
    return Response(audio, media_type='audio/wav' if body.response_format == 'wav' else 'audio/mpeg')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-path', default=app.state.model_path)
    parser.add_argument('--port', type=int, default=19882)
    args = parser.parse_args()
    app.state.model_path = args.model_path
    torch.set_num_threads(4)
    uvicorn.run(app, host='127.0.0.1', port=args.port)
