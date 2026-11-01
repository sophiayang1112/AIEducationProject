"""Run only with a voice sample the user has authorized for cloning."""
import importlib.util
from pathlib import Path
from urllib.error import HTTPError
import learning_voice

spec=importlib.util.spec_from_file_location('learning',Path(__file__).with_name('learning-server.py'))
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.load_config()
try:
    info=learning_voice.enroll(app.CONFIG,app.DATA,app.DATA/'voice-reference.wav')
    print('Voice enrollment saved. Model: '+info['model'],flush=True)
    audio=learning_voice.synthesize(app.CONFIG,app.DATA,'你好，同学！我是你的 AI 学习伙伴。Hello! Let us learn English together!')
    (app.DATA/'voice-preview.wav').write_bytes(audio)
    print('Preview generated: '+str(app.DATA/'voice-preview.wav'),flush=True)
except HTTPError as error:
    raw=error.read().decode(errors='replace').replace(app.CONFIG.get('QWEN_API_KEY',''),'[redacted]')
    print('Voice API HTTP '+str(error.code)+': '+raw[:900],flush=True)
    raise SystemExit(1)
except Exception as error:
    print(type(error).__name__+': '+str(error),flush=True)
    raise SystemExit(1)
