"""Local speech recognition using the installed Whisper model on CPU."""
import io
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import av
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

ROOT = Path(__file__).resolve().parents[1]
inference_lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    app.state.asr = WhisperModel(
        'base', device='cpu', compute_type='int8', cpu_threads=4,
        download_root=str(ROOT / '.local/voice/asr-models'), local_files_only=True,
    )
    yield


app = FastAPI(lifespan=lifespan)


@app.get('/health')
def health():
    return {'status': 'ok', 'engine': 'faster-whisper', 'model': 'base', 'device': 'cpu'}


@app.post('/v1/audio/transcriptions')
def transcribe(file: UploadFile = File(...), model: str = Form('base'), language: str = Form('zh')):
    if model != 'base':
        raise HTTPException(400, '当前电脑加载的识别模型为 base。')
    if language not in ('zh', 'ja', 'en'):
        raise HTTPException(400, '当前支持中文、日文和英文识别。')
    with inference_lock:
        try:
            segments, _ = app.state.asr.transcribe(
                io.BytesIO(file.file.read()), language=language, beam_size=5,
                vad_filter=True, condition_on_previous_text=False,
            )
            text = ''.join(segment.text for segment in segments).strip()
        except av.error.FFmpegError as error:
            raise HTTPException(400, '无法解码录音，请重新录制。') from error
    if not text:
        raise HTTPException(422, '没有听清，请靠近麦克风再说一次。')
    return {'text': text}


if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=19883)
