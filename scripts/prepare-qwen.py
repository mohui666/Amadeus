#!/usr/bin/env python3
"""Prepare fixed-reference, 24 kHz single-speaker Qwen3-TTS training data."""

import argparse
import json
from pathlib import Path
import time


def read_jsonl(path):
    with path.open(encoding="utf-8") as source:
        return [json.loads(line) for line in source if line.strip()]


def main():
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-jsonl", type=Path, default=project / ".local/kurisu-dataset/train.natural.jsonl")
    parser.add_argument("--holdout-jsonl", type=Path, default=project / ".local/kurisu-dataset/holdout.checked.jsonl")
    parser.add_argument("--reference-audio", type=Path, required=True, help="One clean training-side reference, reused for every sample")
    parser.add_argument("--tokenizer-path", type=Path, default=project / ".local/qwen-tts/models/base/speech_tokenizer")
    parser.add_argument("--output-dir", type=Path, default=project / ".local/qwen-tts/data")
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()

    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSTokenizer

    started = time.monotonic()
    output = args.output_dir.resolve()
    audio_dir = output / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    def write_mono24(source, destination):
        audio, rate = sf.read(str(source), dtype="float32", always_2d=True)
        audio = audio.mean(axis=1)
        if rate != 24000:
            audio = librosa.resample(audio, orig_sr=rate, target_sr=24000)
        if not len(audio) or not np.isfinite(audio).all():
            raise ValueError(f"Invalid training waveform: {source}")
        sf.write(str(destination), audio, 24000, subtype="PCM_16")
        return len(audio) / 24000

    reference = output / "reference.wav"
    reference_seconds = write_mono24(args.reference_audio.resolve(), reference)
    tokenizer = Qwen3TTSTokenizer.from_pretrained(str(args.tokenizer_path.resolve()), device_map=args.device)
    metrics = {"sample_rate": 24000, "channels": 1, "tokenizer_batch_size": 1,
               "reference_source": str(args.reference_audio.resolve()), "reference_audio": str(reference),
               "reference_seconds": reference_seconds, "splits": {}}
    for split, source in [("train", args.train_jsonl), ("holdout", args.holdout_jsonl)]:
        entries = read_jsonl(source)
        total_seconds, total_frames = 0.0, 0
        manifest = output / f"{split}-with-codes.jsonl"
        with manifest.open("w", encoding="utf-8") as prepared:
            for index, entry in enumerate(entries):
                destination = audio_dir / f"{split}-{index:04d}.wav"
                seconds = write_mono24(Path(entry["audio"]), destination)
                with torch.inference_mode():
                    codes = tokenizer.encode(str(destination)).audio_codes[0].cpu().tolist()
                item = {"audio": str(destination), "text": entry["text"], "ref_audio": str(reference),
                        "language": "Auto", "audio_codes": codes}
                prepared.write(json.dumps(item, ensure_ascii=False) + "\n")
                total_seconds += seconds
                total_frames += len(codes)
                if (index + 1) % 10 == 0 or index + 1 == len(entries):
                    print(f"{split}: {index + 1}/{len(entries)} clips encoded", flush=True)
        metrics["splits"][split] = {"samples": len(entries), "seconds": round(total_seconds, 3),
                                    "audio_frames": total_frames, "jsonl": str(manifest)}
    metrics["seconds_elapsed"] = round(time.monotonic() - started, 2)
    (output / "preparation-metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
