#!/usr/bin/env python3
# Training sequence construction follows QwenLM/Qwen3-TTS (Apache-2.0).
# Local changes: projected 0.6B text embeddings, aligned CE, frozen-base LoRA,
# held-out selection, and merged single-speaker export. Upstream is unchanged.
"""Train Qwen3-TTS 0.6B LoRA and export the best held-out checkpoint."""

import argparse
import importlib.util
import json
import math
from pathlib import Path
import shutil
import time


def read_jsonl(path):
    with path.open(encoding="utf-8") as source:
        return [json.loads(line) for line in source if line.strip()]


def audio_targets(batch):
    """Position t predicts codec frame t+1, including the main stream's EOS."""
    return batch["codec_0_labels"][:, 1:], batch["codec_mask"][:, 1:], batch["codec_ids"][batch["codec_mask"]]


def forward_losses(base, batch, speaker_embedding, torch):
    talker = base.talker
    text = talker.text_projection(talker.model.text_embedding(batch["input_ids"][:, :, 0]))
    text = text * batch["text_embedding_mask"]
    audio = talker.model.codec_embedding(batch["input_ids"][:, :, 1]) * batch["codec_embedding_mask"]
    # The unmodified upstream collator uses Auto language and speaker position 6.
    audio[:, 6, :] = speaker_embedding
    embeds = text + audio
    for codebook in range(1, talker.config.num_code_groups):
        embeds = embeds + talker.code_predictor.get_input_embeddings()[codebook - 1](
            batch["codec_ids"][:, :, codebook]
        ) * batch["codec_mask"].unsqueeze(-1)

    mask = batch["attention_mask"][:, :-1]
    positions, _ = talker.get_rope_index(mask)
    hidden = talker.model(inputs_embeds=embeds[:, :-1], attention_mask=mask, position_ids=positions,
                          use_cache=False, output_hidden_states=False).last_hidden_state
    labels, predicted_frames, frame_codes = audio_targets(batch)
    main_logits = talker.codec_head(hidden)
    # Targets are already shifted; Transformers' default causal loss would shift again.
    main_loss = torch.nn.functional.cross_entropy(main_logits.float().reshape(-1, main_logits.shape[-1]),
                                                 labels.reshape(-1), ignore_index=-100)

    # Generation predicts codec1..15 from the preceding Talker hidden and current codec0..14.
    sub_inputs = [hidden[predicted_frames].unsqueeze(1), talker.model.codec_embedding(frame_codes[:, :1])]
    for codebook in range(1, talker.config.num_code_groups - 1):
        sub_inputs.append(talker.code_predictor.get_input_embeddings()[codebook - 1](frame_codes[:, codebook:codebook + 1]))
    predictor = talker.code_predictor
    sub_hidden = predictor.model(inputs_embeds=predictor.small_to_mtp_projection(torch.cat(sub_inputs, dim=1)),
                                 use_cache=False, output_hidden_states=False).last_hidden_state
    sub_logits = torch.stack([head(sub_hidden[:, index + 1]) for index, head in enumerate(predictor.lm_head)], dim=1)
    sub_labels = frame_codes[:, 1:]
    sub_loss = torch.nn.functional.cross_entropy(sub_logits.float().reshape(-1, sub_logits.shape[-1]), sub_labels.reshape(-1))
    return main_loss, sub_loss, int((labels != -100).sum()), sub_labels.numel()


def export_custom_voice(base, base_path, output, speaker, embedding, torch):
    from safetensors.torch import save_file

    output.mkdir(parents=True, exist_ok=True)
    for source in base_path.iterdir():
        # Copy the original tokenizer and configs, but not the original top-level model weights.
        if source.name.startswith(".") or source.name.startswith("model") and source.name.endswith((".safetensors", ".safetensors.index.json")):
            continue
        if source.is_dir():
            shutil.copytree(source, output / source.name, dirs_exist_ok=True)
        else:
            shutil.copy2(source, output / source.name)
    base.speaker_encoder = None
    base.config.tts_model_type = "custom_voice"
    base.config.talker_config.spk_id = {speaker: 3000}
    base.config.talker_config.spk_is_dialect = {speaker: False}
    base.config.talker_config.use_cache = True
    base.config.talker_config.code_predictor_config.use_cache = True
    with torch.no_grad():
        weight = base.talker.model.codec_embedding.weight
        weight[3000].copy_(embedding[0].to(device=weight.device, dtype=weight.dtype))
    # Preserve the upstream JSON shape. Its speaker config constructor does not
    # accept the extra model_type field introduced by generic config serialization.
    config = json.loads((base_path / "config.json").read_text(encoding="utf-8"))
    config["tts_model_type"] = "custom_voice"
    config["talker_config"]["spk_id"] = {speaker: 3000}
    config["talker_config"]["spk_is_dialect"] = {speaker: False}
    config["talker_config"]["use_cache"] = True
    config["talker_config"]["code_predictor_config"]["use_cache"] = True
    (output / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    save_file({name: tensor.detach().cpu().contiguous() for name, tensor in base.state_dict().items()},
              str(output / "model.safetensors"))
    (output / "VOICE.md").write_text(
        f"# {speaker}\n\nQwen3-TTS 0.6B single-speaker LoRA, merged from the best held-out epoch.\n"
        f"Use generate_custom_voice(text=..., speaker={speaker!r}, language='Auto').\n"
        "Training preserves the official Auto-language prefix; the training transcripts are Japanese.\n"
        "This 0.6B model does not support instruct-based emotion control.\n", encoding="utf-8")


def main():
    project = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-model", type=Path, default=project / ".local/qwen-tts/models/base")
    parser.add_argument("--upstream-dir", type=Path, default=project / ".local/qwen-tts/Qwen3-TTS")
    parser.add_argument("--train-jsonl", type=Path, default=project / ".local/qwen-tts/data/train-with-codes.jsonl")
    parser.add_argument("--holdout-jsonl", type=Path, default=project / ".local/qwen-tts/data/holdout-with-codes.jsonl")
    parser.add_argument("--output-dir", type=Path, default=project / ".local/qwen-tts/training")
    parser.add_argument("--speaker", default="kurisu")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--gradient-accumulation", type=int, default=4)
    parser.add_argument("--rank", type=int, default=8)
    parser.add_argument("--alpha", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--gradient-checkpointing", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--max-steps", type=int, help="Optional optimizer-update limit for a short actual training smoke run")
    args = parser.parse_args()

    import torch
    from torch.utils.data import DataLoader
    from peft import LoraConfig, get_peft_model, get_peft_model_state_dict, set_peft_model_state_dict
    from qwen_tts import Qwen3TTSModel

    started = time.monotonic()
    torch.manual_seed(42)
    device = torch.device(args.device)
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    best_path = output / "adapter-best"
    train_rows, holdout_rows = read_jsonl(args.train_jsonl), read_jsonl(args.holdout_jsonl)
    if not train_rows or not holdout_rows:
        raise ValueError("Both training and held-out splits must contain audio samples.")
    references = {row["ref_audio"] for row in train_rows + holdout_rows}
    if len(references) != 1:
        raise ValueError("Use one fixed reference audio across the training and held-out splits.")

    spec = importlib.util.spec_from_file_location("qwen_training_dataset", args.upstream_dir / "finetuning/dataset.py")
    dataset_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dataset_module)
    wrapper = Qwen3TTSModel.from_pretrained(str(args.base_model.resolve()), device_map="cpu",
                                           dtype=torch.bfloat16, attn_implementation="sdpa")
    base = wrapper.model
    # Audio codes are precomputed; the codec model must not remain resident during training.
    base.speech_tokenizer = None
    base.requires_grad_(False)
    base.to(device)
    base.talker.config.use_cache = False
    base.talker.code_predictor.config.use_cache = False
    train_data = dataset_module.TTSDataset(train_rows, wrapper.processor, base.config)
    holdout_data = dataset_module.TTSDataset(holdout_rows, wrapper.processor, base.config)
    train_loader = DataLoader(train_data, batch_size=args.batch_size, shuffle=True, collate_fn=train_data.collate_fn)
    holdout_loader = DataLoader(holdout_data, batch_size=args.batch_size, shuffle=False, collate_fn=holdout_data.collate_fn)
    base.speaker_encoder.eval()
    with torch.no_grad():
        reference_mel = train_data[0]["ref_mel"].to(device=device, dtype=torch.bfloat16)
        speaker_embedding = base.speaker_encoder(reference_mel).detach()
    del reference_mel

    model = get_peft_model(base, LoraConfig(r=args.rank, lora_alpha=args.alpha, lora_dropout=0.05, bias="none",
        target_modules=r"talker\.(?:model|code_predictor\.model)\.layers\.\d+\.self_attn\.(?:q_proj|v_proj)"))
    # Enable after adapter injection: this custom wrapper has no top-level text embedding hook.
    # Non-reentrant checkpointing supports frozen input embeddings without PEFT's legacy hook.
    if args.gradient_checkpointing:
        base.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    trainable = [parameter for parameter in model.parameters() if parameter.requires_grad]
    optimizer = torch.optim.AdamW(trainable, lr=args.lr, weight_decay=0.01)
    model.print_trainable_parameters()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    metrics = {"status": "training", "base_model": str(args.base_model.resolve()), "speaker": args.speaker,
               "language_prefix": "Auto", "transcript_language": "Japanese", "dtype": "bfloat16", "attention": "sdpa",
               "rank": args.rank, "alpha": args.alpha, "learning_rate": args.lr, "batch_size": args.batch_size,
               "gradient_accumulation": args.gradient_accumulation, "gradient_checkpointing": args.gradient_checkpointing,
               "train_samples": len(train_rows), "holdout_samples": len(holdout_rows),
               "trainable_parameters": sum(p.numel() for p in trainable), "requested_epochs": args.epochs,
               "max_optimizer_steps": args.max_steps, "epochs": []}

    def run_batch(batch):
        batch = {key: value.to(device) for key, value in batch.items() if key != "ref_mels"}
        with torch.autocast(device_type=device.type, dtype=torch.bfloat16):
            return forward_losses(model.get_base_model(), batch, speaker_embedding, torch)

    def evaluate():
        model.eval()
        sums = [0.0, 0.0, 0, 0]
        with torch.no_grad():
            for batch in holdout_loader:
                main, sub, main_count, sub_count = run_batch(batch)
                sums[0] += float(main) * main_count
                sums[1] += float(sub) * sub_count
                sums[2] += main_count
                sums[3] += sub_count
        result = {"main_ce": sums[0] / sums[2], "sub_ce": sums[1] / sums[3],
                  "loss": sums[0] / sums[2] + 0.3 * sums[1] / sums[3]}
        if not math.isfinite(result["loss"]):
            raise FloatingPointError("Non-finite held-out loss")
        return result

    def write_metrics():
        metrics["seconds_elapsed"] = round(time.monotonic() - started, 2)
        if device.type == "cuda":
            metrics["peak_allocated_mib"] = round(torch.cuda.max_memory_allocated(device) / 1024 ** 2, 1)
            metrics["peak_reserved_mib"] = round(torch.cuda.max_memory_reserved(device) / 1024 ** 2, 1)
        (output / "training-metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    metrics["initial_holdout"] = evaluate()
    print("Initial held-out: " + json.dumps(metrics["initial_holdout"]), flush=True)
    write_metrics()
    best_loss, best_weights, updates = float("inf"), None, 0
    for epoch in range(args.epochs):
        model.train()
        base.speaker_encoder.eval()
        optimizer.zero_grad(set_to_none=True)
        sums = [0.0, 0.0, 0, 0]
        for index, batch in enumerate(train_loader):
            main, sub, main_count, sub_count = run_batch(batch)
            loss = main + 0.3 * sub
            if not torch.isfinite(loss):
                raise FloatingPointError(f"Non-finite training loss in epoch {epoch + 1}, batch {index + 1}")
            group_start = index // args.gradient_accumulation * args.gradient_accumulation
            group_size = min(args.gradient_accumulation, len(train_loader) - group_start)
            (loss / group_size).backward()
            sums[0] += float(main.detach()) * main_count
            sums[1] += float(sub.detach()) * sub_count
            sums[2] += main_count
            sums[3] += sub_count
            if (index + 1) % args.gradient_accumulation == 0 or index + 1 == len(train_loader):
                torch.nn.utils.clip_grad_norm_(trainable, 1.0, error_if_nonfinite=True)
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                updates += 1
                if updates == 1 or updates % 10 == 0:
                    print(f"Epoch {epoch + 1}: update {updates}, loss {float(loss.detach()):.4f}", flush=True)
                if args.max_steps is not None and updates >= args.max_steps:
                    break
        heldout = evaluate()
        record = {"epoch": epoch + 1, "optimizer_steps": updates,
                  "train_main_ce": sums[0] / sums[2], "train_sub_ce": sums[1] / sums[3],
                  "train_loss": sums[0] / sums[2] + 0.3 * sums[1] / sums[3], "holdout": heldout}
        metrics["epochs"].append(record)
        if heldout["loss"] < best_loss:
            best_loss = heldout["loss"]
            metrics["best_epoch"] = epoch + 1
            best_weights = {key: value.detach().cpu().clone() for key, value in get_peft_model_state_dict(model).items()}
            model.save_pretrained(best_path, safe_serialization=True)
        write_metrics()
        print(json.dumps(record, ensure_ascii=False), flush=True)
        if args.max_steps is not None and updates >= args.max_steps:
            break

    metrics["optimizer_steps"] = updates
    metrics["adapter_l1_from_zero_initialization"] = sum(float(t.abs().sum()) for key, t in best_weights.items() if "lora_B" in key)
    set_peft_model_state_dict(model, best_weights)
    del optimizer
    model.to("cpu")
    merged = model.merge_and_unload()
    export_path = output / args.speaker
    export_custom_voice(merged, args.base_model.resolve(), export_path, args.speaker, speaker_embedding.cpu(), torch)
    metrics["status"] = "exported"
    metrics["best_adapter"] = str(best_path)
    metrics["merged_model"] = str(export_path)
    metrics["best_holdout_loss"] = best_loss
    metrics["inference_language"] = "Auto"
    write_metrics()
    print(json.dumps(metrics, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
