"""Ephemeral ASR bridge. Audio and partial transcripts never go to disk."""
import base64
import json
import queue
import secrets
import threading
import time
from urllib.parse import urlparse

try:
    import websocket
except ImportError:
    websocket=None

SESSIONS={}
LOCK=threading.Lock()
STARTING=0

class Session:
    def __init__(self,config):
        self.events=queue.Queue(maxsize=100)
        self.closed=False
        self.error_code=''
        self.last_audio=time.monotonic()
        self.ready=threading.Event()
        self.send_lock=threading.Lock()
        host=urlparse(config['QWEN_BASE_URL']).netloc
        self.socket=websocket.create_connection('wss://'+host+'/api-ws/v1/realtime?model=qwen3-asr-flash-realtime',header=['Authorization: Bearer '+config['QWEN_API_KEY']],timeout=5)
        self.socket.settimeout(1)
        threading.Thread(target=self.receive,daemon=True).start()
        try:
            self.send({'type':'session.update','session':{'input_audio_format':'pcm','sample_rate':16000,'input_audio_transcription':{},'turn_detection':{'type':'server_vad','threshold':.2,'silence_duration_ms':450}}})
            if not self.ready.wait(5) or self.closed:
                raise RuntimeError('Realtime ASR session unavailable: '+self.error_code)
        except Exception:
            self.close()
            raise

    def send(self,event):
        event['event_id']=secrets.token_hex(12)
        with self.send_lock:
            self.socket.send(json.dumps(event))

    def emit(self,event):
        try:
            self.events.put_nowait(event)
        except queue.Full:
            self.close()

    def receive(self):
        try:
            while not self.closed:
                if time.monotonic()-self.last_audio>30:
                    self.error_code='audio_idle_timeout'
                    break
                try:
                    raw=self.socket.recv()
                except websocket.WebSocketTimeoutException:
                    continue
                if not raw:
                    self.error_code=self.error_code or 'upstream_closed'
                    break
                event=json.loads(raw)
                kind=event.get('type','')
                if kind=='session.updated':
                    self.ready.set()
                elif kind=='input_audio_buffer.speech_started':
                    self.emit({'type':'speech_start'})
                elif kind=='input_audio_buffer.speech_stopped':
                    self.emit({'type':'speech_end'})
                elif kind=='conversation.item.input_audio_transcription.text':
                    self.emit({'type':'partial','text':str(event.get('text',''))+str(event.get('stash',''))})
                elif kind=='conversation.item.input_audio_transcription.completed':
                    self.emit({'type':'final','text':str(event.get('transcript',''))[:2000],'id':event.get('item_id','')})
                elif kind in ('error','conversation.item.input_audio_transcription.failed'):
                    self.error_code=str(event.get('error',{}).get('code','provider_error'))[:80]
                    self.emit({'type':'error','error':'实时识别暂不可用，请重新开始互动。'})
                    break
        except Exception as error:
            self.error_code=type(error).__name__
            self.emit({'type':'error','error':'实时收音连接已断开，请重新开始互动。'})
        finally:
            self.close()

    def close(self):
        if self.closed:
            return
        self.closed=True
        if self.error_code:
            print('Realtime ASR closed: '+''.join(c for c in self.error_code if c.isalnum() or c in '._-')[:80],flush=True)
        self.ready.set()
        self.socket.close()
        with self.events.mutex:
            self.events.queue.clear()

def handle(action,body,config):
    global STARTING
    if action=='start':
        if websocket is None:
            raise RuntimeError('Realtime dependency unavailable')
        with LOCK:
            for key,session in list(SESSIONS.items()):
                if session.closed:
                    del SESSIONS[key]
            if len(SESSIONS)+STARTING>=2:
                raise RuntimeError('Too many microphone sessions')
            STARTING+=1
        try:
            for attempt in range(2):
                try:
                    session=Session(config)
                    break
                except (OSError,RuntimeError,websocket.WebSocketException) as error:
                    if attempt or getattr(error,'status_code',None) in (400,401,403):
                        raise
                    time.sleep(.35)
            key=secrets.token_urlsafe(24)
            with LOCK:
                SESSIONS[key]=session
        finally:
            with LOCK:
                STARTING-=1
        return {'session_id':key,'sample_rate':16000,'silence_ms':450}
    with LOCK:
        session=SESSIONS.get(body.get('session_id'))
    if session is None:
        raise ValueError('Unknown microphone session')
    if action=='stop':
        session.close()
        with LOCK:
            SESSIONS.pop(body['session_id'],None)
        return {'stopped':True}
    if action=='audio':
        if session.closed:
            return {'accepted':False,'closed':True,'error_code':session.error_code or 'upstream_closed'}
        raw=base64.b64decode(body.get('audio',''),validate=True)
        if session.closed or not 0<len(raw)<=16000 or len(raw)%2:
            raise ValueError('Invalid microphone packet')
        session.last_audio=time.monotonic()
        session.send({'type':'input_audio_buffer.append','audio':base64.b64encode(raw).decode()})
        return {'accepted':True}
    if action=='poll':
        events=[]
        try:
            events.append(session.events.get(timeout=1))
            while len(events)<30:
                events.append(session.events.get_nowait())
        except queue.Empty:
            pass
        return {'events':events,'closed':session.closed,'error_code':session.error_code}
    raise ValueError('Unknown microphone action')
