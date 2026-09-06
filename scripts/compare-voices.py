#!/usr/bin/env python3
"""Compare Qwen Base/finetuned voices using the six existing GPT-SoVITS prompts.

Run each stage with .local/qwen-tts/venv/bin/python. GPU generation exits before
local Whisper base runs in its existing CPU environment. No model is downloaded.
"""

import argparse
import json
import os
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parents[1]
QWEN = ROOT / '.local/qwen-tts'
REFERENCE = ROOT / '.local/voice/reference/kurisu-ask.wav'
REFERENCE_TEXT = 'どんなことでも聞いてください。可能な範囲でお答えしますから。'
BASELINE = ROOT / '.local/voice/voice-comparison.json'
GENERATION = {
    'language': 'Auto',
    'non_streaming_mode': True,
    'do_sample': True,
    'temperature': 0.9,
    'top_k': 50,
    'top_p': 1.0,
    'repetition_penalty': 1.05,
    'subtalker_dosample': True,
    'subtalker_temperature': 0.9,
    'subtalker_top_k': 50,
    'subtalker_top_p': 1.0,
    'max_new_tokens': 1200,
}


def save_report(path, report):
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def generate(stage, report_path, explicit_chinese=False):
    import numpy as np
    import soundfile as sf
    import torch
    from transformers import set_seed
    from qwen_tts import Qwen3TTSModel

    # Both Qwen stages use Auto because the training sequence uses that prefix.
    # No instruct-based emotion control: the 0.6B model does not support it.
    torch.set_num_threads(4)
    model_path = QWEN / ('models/base' if stage == 'base' else 'training/kurisu')
    started = time.perf_counter()
    model = Qwen3TTSModel.from_pretrained(
        str(model_path), device_map='cuda:0', dtype=torch.bfloat16,
        attn_implementation='sdpa', local_files_only=True,
    )
    model.model.eval()
    torch.cuda.synchronize()
    model_load_seconds = time.perf_counter() - started

    prompt = None
    reference_seconds = 0
    with torch.inference_mode():
        if stage == 'base':
            set_seed(42)
            torch.cuda.synchronize()
            started = time.perf_counter()
            prompt = model.create_voice_clone_prompt(
                ref_audio=str(REFERENCE), ref_text=REFERENCE_TEXT,
                x_vector_only_mode=False,
            )
            torch.cuda.synchronize()
            reference_seconds = time.perf_counter() - started

    generation = {**GENERATION, 'language': 'Chinese'} if explicit_chinese else dict(GENERATION)
    report = {
        'stage': stage,
        'model_path': str(model_path),
        'method': 'generate_voice_clone' if stage == 'base' else 'generate_custom_voice',
        'speaker': None if stage == 'base' else 'kurisu',
        'seed': 42,
        'dtype': 'bfloat16',
        'attention': 'sdpa',
        'device': torch.cuda.get_device_name(0),
        'reference_audio': str(REFERENCE),
        'reference_text': REFERENCE_TEXT,
        'reference_mode': 'ICL audio and text' if stage == 'base' else 'speaker embedding baked into trained model',
        'generation': generation,
        'model_load_seconds': round(model_load_seconds, 3),
        'reference_preparation_seconds': round(reference_seconds, 3),
        'timing_scope': 'Synchronized generate call including waveform decoding; excludes model load, reference preparation, WAV saving, and ASR.',
        'comparison_limits': [
            ('Explicit Chinese diagnostic differs from the training Auto prefix; original Auto samples remain unchanged.'
             if explicit_chinese else 'Both Qwen stages use language=Auto, matching the training prefix.'),
            'Base uses reference-conditioned ICL; finetuned uses its learned kurisu speaker. These are their respective supported inference modes.',
            'GPT-SoVITS original timings include HTTP and WAV saving; they are not identical timing boundaries.',
            'One seed and three short pairs do not establish universal quality or a character similarity percentage.',
            'Raw outputs are preserved without trimming, speed changes, or loudness matching.',
        ],
        'samples': [],
    }
    out = ROOT / 'public/generated-voice'
    out.mkdir(parents=True, exist_ok=True)
    for baseline in json.loads(BASELINE.read_text(encoding='utf-8')):
        if explicit_chinese and baseline['name'] != 'kurisu-zh-chat':
            continue
        case = baseline['name'].removeprefix('kurisu-')
        set_seed(42)
        torch.cuda.synchronize()
        started = time.perf_counter()
        with torch.inference_mode():
            if stage == 'base':
                wavs, rate = model.generate_voice_clone(
                    text=baseline['text'], voice_clone_prompt=prompt, **generation,
                )
            else:
                wavs, rate = model.generate_custom_voice(
                    text=baseline['text'], speaker='kurisu', **generation,
                )
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        audio = np.asarray(wavs[0], dtype=np.float32)
        if not np.isfinite(audio).all():
            raise RuntimeError(f'{stage}/{case} generated non-finite audio samples')
        prefix = 'base' if stage == 'base' else 'fine'
        suffix = '-chinese' if explicit_chinese else ''
        path = out / f'qwen-{prefix}-{case}{suffix}.wav'
        sf.write(path, audio, rate, subtype='PCM_16')
        item = {
            'name': case,
            'language': baseline['language'],
            'text': baseline['text'],
            'file': str(path),
            'seconds': round(len(audio) / rate, 3),
            'sample_rate': int(rate),
            'wall_seconds': round(elapsed, 3),
            'peak': round(float(np.max(np.abs(audio))), 5),
            'rms': round(float(np.sqrt(np.mean(audio.astype(np.float64) ** 2))), 6),
            'gpt_sovits': baseline,
        }
        report['samples'].append(item)
        save_report(report_path, report)
        print(json.dumps({key: value for key, value in item.items() if key != 'gpt_sovits'}, ensure_ascii=False), flush=True)


def transcribe(report_path):
    from faster_whisper import WhisperModel

    asr = WhisperModel('base', device='cpu', compute_type='int8', cpu_threads=4,
                       download_root=str(ROOT / '.local/voice/asr-models'), local_files_only=True)
    report = json.loads(report_path.read_text(encoding='utf-8'))
    report['asr'] = {'model': 'Whisper base', 'device': 'cpu', 'compute_type': 'int8', 'beam_size': 5}
    for item in report['samples']:
        segments, _ = asr.transcribe(item['file'], language=item['language'], beam_size=5, vad_filter=False)
        item['transcript'] = ''.join(segment.text for segment in segments)
        save_report(report_path, report)
        print(json.dumps({'name': item['name'], 'text': item['text'], 'transcript': item['transcript']}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['base', 'finetuned'])
    parser.add_argument('--explicit-chinese', action='store_true', help='Diagnose only zh-chat with language=Chinese; save separate outputs')
    parser.add_argument('--asr-only', action='store_true', help='Transcribe an existing stage report without loading Qwen/GPU')
    args = parser.parse_args()
    suffix = '-chinese' if args.explicit_chinese else ''
    report_path = QWEN / f'comparison-{args.stage}{suffix}.json'
    if args.asr_only:
        transcribe(report_path)
    else:
        generate(args.stage, report_path, args.explicit_chinese)
        # Replacing the process releases its entire CUDA context before CPU ASR.
        asr_python = ROOT / '.local/voice/bootstrap/bin/python'
        asr_args = [str(asr_python), str(Path(__file__).resolve()), args.stage, '--asr-only']
        if args.explicit_chinese:
            asr_args.append('--explicit-chinese')
        os.execv(str(asr_python), asr_args)


if __name__ == '__main__':
    main()
