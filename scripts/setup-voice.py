"""Download official inference weights and prepare Amadeus's local reference voice."""
from pathlib import Path
from zipfile import ZipFile
import json
import os
import tarfile
import subprocess
import urllib.request

import imageio_ffmpeg
import pyopenjtalk
from huggingface_hub import hf_hub_download, snapshot_download

ROOT = Path(__file__).resolve().parents[1]
VOICE = ROOT / '.local' / 'voice'
REPO = VOICE / 'GPT-SoVITS'

snapshot_download(
    'lj1995/GPT-SoVITS',
    local_dir=REPO / 'GPT_SoVITS' / 'pretrained_models',
    allow_patterns=[
        'chinese-hubert-base/*', 'chinese-roberta-wwm-ext-large/*',
        's1v3.ckpt', 'v2Pro/s2Gv2ProPlus.pth',
        'sv/pretrained_eres2netv2w24s4ep4.ckpt',
    ],
    max_workers=4,
)
# This language detector requires an existing directory for a custom cache path.
lang_dir = REPO / 'GPT_SoVITS/pretrained_models/fast_langdetect'
lang_dir.mkdir(exist_ok=True)
lang_model = lang_dir / 'lid.176.bin'
if not lang_model.is_file():
    urllib.request.urlretrieve('https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin', lang_model)

archive = hf_hub_download('XXXXRT/GPT-SoVITS-Pretrained', 'G2PWModel.zip', local_dir=VOICE / 'downloads')
with ZipFile(archive) as z:
    z.extractall(REPO / 'GPT_SoVITS' / 'text')
archive = hf_hub_download('XXXXRT/GPT-SoVITS-Pretrained', 'open_jtalk_dic_utf_8-1.11.tar.gz', local_dir=VOICE / 'downloads')
with tarfile.open(archive) as t:
    t.extractall(Path(pyopenjtalk.__file__).parent, filter='data')
archive = hf_hub_download('XXXXRT/GPT-SoVITS-Pretrained', 'nltk_data.zip', local_dir=VOICE / 'downloads')
with ZipFile(archive) as z:
    z.extractall(VOICE)

# Keep the character's unusual kanji from being read as ordinary words.
dictionary = REPO / 'GPT_SoVITS/text/ja_userdic/userdict.csv'
entries = [
    '牧瀬紅莉栖,1348,1348,0,名詞,固有名詞,人名,一般,*,*,牧瀬紅莉栖,マキセクリス,マキセクリス,0/6,*',
    '紅莉栖,1348,1348,0,名詞,固有名詞,人名,名,*,*,紅莉栖,クリス,クリス,1/3,*',
]
lines = [line for line in dictionary.read_text().splitlines() if not line.startswith(('牧瀬紅莉栖,', '紅莉栖,'))]
dictionary.write_text('\n'.join(lines + entries) + '\n')

(VOICE / 'bin').mkdir(exist_ok=True)
ffmpeg = Path(imageio_ffmpeg.get_ffmpeg_exe())
link = VOICE / 'bin' / 'ffmpeg'
link.unlink(missing_ok=True)
link.symlink_to(ffmpeg)
(VOICE / 'reference').mkdir(exist_ok=True)
reference = VOICE / 'reference' / 'kurisu-ask.wav'
subprocess.run([str(ffmpeg), '-y', '-hide_banner', '-loglevel', 'error', '-i', str(ROOT / 'public/assets/voice/ask_me_whatever.ogg'), '-ar', '32000', '-ac', '1', str(reference)], check=True)

(VOICE / 'tts.yaml').write_text('''custom:
  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large
  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base
  device: cuda
  is_half: true
  t2s_weights_path: GPT_SoVITS/pretrained_models/s1v3.ckpt
  version: v2ProPlus
  vits_weights_path: GPT_SoVITS/pretrained_models/v2Pro/s2Gv2ProPlus.pth
''')
# Reference transcript was verified by local ASR of the original clip.
(VOICE / 'client-config.json').write_text(json.dumps({
    'provider': 'gpt-sovits', 'baseUrl': 'http://127.0.0.1:19880',
    'model': '', 'voice': '', 'apiKey': '', 'speed': 1,
    'referenceAudio': str(reference),
    'promptText': 'どんなことでも聞いてください。可能な範囲でお答えしますから。',
    'promptLang': 'ja', 'textLang': 'ja',
}, ensure_ascii=False, indent=2))
