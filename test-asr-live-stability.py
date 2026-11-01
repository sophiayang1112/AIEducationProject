"""45-second real ASR check with cached synthetic speech, never child microphone audio."""
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
    samples=np.frombuffer(audio.readframes(audio.getnframes()),dtype='<i2').astype(np.float32)
    pcm=np.clip(resample_poly(samples,16000,audio.getframerate()),-32768,32767).astype('<i2').tobytes()
packets=[pcm[i:i+3200].ljust(3200,b'\0') for i in range(0,len(pcm),3200)]+[bytes(3200)]*15
info=app.learning_realtime.handle('start',{},app.CONFIG)
session=app.learning_realtime.SESSIONS[info['session_id']]
started=time.monotonic()
count=0
finals=0
max_send=0
try:
    while time.monotonic()-started<45:
        session.last_audio=time.monotonic()
        before=time.monotonic()
        session.send({'type':'input_audio_buffer.append','audio':base64.b64encode(packets[count%len(packets)]).decode()})
        max_send=max(max_send,time.monotonic()-before)
        count+=1
        while True:
            try:event=session.events.get_nowait()
            except queue.Empty:break
            if event['type']=='final':finals+=1
        if session.closed:raise RuntimeError('ASR closed: '+session.error_code)
        time.sleep(max(0,started+count*.1-time.monotonic()))
    assert finals>0,'No final recognition received'
    print('PASS live ASR: seconds=45 packets=%s final_transcriptions=%s max_send_seconds=%.3f'%(count,finals,max_send))
finally:
    app.learning_realtime.handle('stop',{'session_id':info['session_id']},app.CONFIG)
