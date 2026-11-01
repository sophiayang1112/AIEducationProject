import importlib.util
from pathlib import Path
from urllib.error import HTTPError
import learning_voice

spec=importlib.util.spec_from_file_location('learning',Path(__file__).with_name('learning-server.py'))
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.load_config()
folder=app.DATA/'voices'/'light'
prompt='原创卡通少年伙伴的声音，明亮清脆，中高音，干净有光泽，发音清晰自然，语气自信、聪明、带一点俏皮的挑战感，但不凶恶。不模仿任何具体人物。普通话标准，也能自然清楚地说简单英语，句间有自然停顿，情绪生动，不要播音腔或机器人感。与低沉沙哑的卡通男声形成鲜明区别。'
try:
    info=learning_voice.design(app.CONFIG,folder,prompt,'我是阳光伙伴，探索伙伴的好朋友！同学，准备接受挑战吧。')
    print('Sunny Companion original voice saved.',flush=True)
    audio=learning_voice.synthesize(app.CONFIG,folder,'我是阳光伙伴！Ready for a challenge?')
    (folder/'voice-preview.wav').write_bytes(audio)
    print('Sunny Companion preview saved.',flush=True)
except HTTPError as error:
    print('Voice API HTTP '+str(error.code)+': '+error.read().decode(errors='replace').replace(app.CONFIG.get('QWEN_API_KEY',''),'[redacted]')[:700],flush=True)
    raise SystemExit(1)
