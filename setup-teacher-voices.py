"""Create distinct original teacher voices without accessing child conversations."""
import importlib.util
from pathlib import Path
import learning_voice

spec=importlib.util.spec_from_file_location('learning',Path(__file__).with_name('learning-server.py'))
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.load_config()
voices=[
    ('chinese','Original adult female Chinese language teacher. Warm mellow lower female register, gentle storytelling cadence, clear standard Mandarin, natural conversational pauses. No imitation of any real person. Not cartoonish or robotic.','你好，我是语文老师。我们把这个字，慢慢读一遍。'),
    ('english','Original adult female bilingual English teacher. Bright clear light female register, friendly lively conversational energy, natural fluent American English and standard Mandarin, short encouraging phrases. Distinct from a mellow storyteller. No imitation of any real person.','Hi! 我是英语老师。跟我说，I like apples. 很好，我们慢慢来。'),
    ('math','Original adult male mathematics teacher. Calm rounded middle-low male register, warm and patient, clear standard Mandarin, natural curious conversational questions, unhurried but not dragged. No imitation of any real person, no robotic narration.','我是数学老师，教数学的数学老师。我们一起数一数，这里有几个？')
]
for role,prompt,preview in voices:
    folder=learning_voice.voice_directory(app.DATA,role)
    learning_voice.design(app.CONFIG,folder,prompt,preview,preferred_name=role)
    raw=learning_voice.synthesize(app.CONFIG,folder,preview)
    (folder/'voice-preview.wav').write_bytes(raw)
    print(role+' original voice ready',flush=True)
