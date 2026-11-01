"""Measure real ASR with existing synthetic audio, without touching learning history."""
import base64
import importlib.util
import queue
import time
import wave
import numpy as np
from scipy.signal import resample_poly

spec=importlib.util.spec_from_file_location('app','learning-server.py')
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.load_config()
files=list((app.DATA/'voices'/'challenger'/'speech-cache').glob('*.wav'))
with wave.open(str(files[-1]),'rb') as audio:
    pcm=np.frombuffer(audio.readframes(audio.getnframes()),dtype='<i2').astype(np.float32)
    rate=audio.getframerate()
pcm=np.clip(resample_poly(pcm,16000,rate),-32768,32767).astype('<i2').tobytes()
session=app.learning_realtime.Session(app.CONFIG)
started=time.perf_counter()
try:
    for offset in range(0,len(pcm),3200):
        session.send({'type':'input_audio_buffer.append','audio':base64.b64encode(pcm[offset:offset+3200]).decode()})
        time.sleep(.1)
    ended=time.perf_counter()
    counts={}
    for _ in range(50):
        session.send({'type':'input_audio_buffer.append','audio':base64.b64encode(bytes(3200)).decode()})
        time.sleep(.1)
        while True:
            try:
                event=session.events.get_nowait()
            except queue.Empty:
                break
            counts[event['type']]=counts.get(event['type'],0)+1
            if event['type']=='final':
                print('asr_final_after_audio_seconds',round(time.perf_counter()-ended,3),'recognized_characters',len(event['text']))
                raise SystemExit(0)
            if event['type']=='error':
                raise RuntimeError('Recognition failed')
    print('event_counts',counts,'closed',session.closed,'error_code',session.error_code)
    raise RuntimeError('No final transcription within test window')
finally:
    session.close()
