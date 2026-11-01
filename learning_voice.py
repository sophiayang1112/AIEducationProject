"""Qwen voice enrollment and private, cached speech synthesis."""
import base64
import hashlib
import json
import os
from pathlib import Path
import threading
import io
import wave
import struct
import time
import tempfile
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from http.client import IncompleteRead, RemoteDisconnected

VOICE_LOCK = threading.Lock()
MODEL = 'qwen3-tts-vc-2026-01-22'

def prune_cache(folder):
    files=sorted(folder.glob('*.wav'),key=lambda p:p.stat().st_mtime,reverse=True)
    total=0
    for index,path in enumerate(files):
        total+=path.stat().st_size
        if index>=1000 or total>256*1024*1024:
            path.unlink(missing_ok=True)

def prepared_speech(config,folder,text):
    # Retry before publishing any PCM, so a failed partial response cannot repeat words.
    for attempt in range(2):
        try:
            return list(synthesize_stream(config,folder,text))
        except HTTPError as error:
            if error.code not in (408,429,500,502,503,504) or attempt:
                raise
        except (TimeoutError,ConnectionError,URLError,IncompleteRead,RemoteDisconnected):
            if attempt:
                raise
        except ValueError as error:
            reason=str(error)
            transient=reason=='Incomplete voice stream' or (reason.startswith('Voice stream failed: ') and any(word in reason.lower() for word in ('internal','throttl','timeout','serviceunavailable','ratelimit','servererror')))
            if not transient or attempt:
                raise
        time.sleep(.6)

def live_speech(config,folder,text):
    for attempt in range(2):
        sent=False
        try:
            for chunk in synthesize_stream(config,folder,text):
                sent=True
                yield chunk
            return
        except (TimeoutError,ConnectionError,URLError,IncompleteRead,RemoteDisconnected) as error:
            if sent or attempt or (isinstance(error,HTTPError) and error.code not in (408,429,500,502,503,504)):
                raise
        except ValueError as error:
            reason=str(error).lower()
            if sent or attempt or not any(word in reason for word in ('incomplete voice','internal','throttl','timeout','serviceunavailable')):
                raise
        time.sleep(.3)

def api(config,path,payload):
    base=urlparse(config['QWEN_BASE_URL'])
    if base.scheme!='https':
        raise ValueError('Qwen requires HTTPS')
    endpoint=f'{base.scheme}://{base.netloc}/api/v1/'+path
    request=Request(endpoint,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+config['QWEN_API_KEY'],'Content-Type':'application/json'})
    with urlopen(request,timeout=90) as response:
        result=json.load(response)
    if result.get('code') and not result.get('output'):
        raise ValueError('Qwen voice service returned '+str(result['code']))
    return result

def voice_info(folder):
    path=Path(folder)/'voice.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None

def voice_directory(folder,character):
    if character in ('challenger','light','chinese','english','math'):
        return Path(folder)/'voices'/character
    return Path(folder)

def design(config,folder,prompt,preview,preferred_name='lightprofessor'):
    folder=Path(folder)
    folder.mkdir(parents=True,exist_ok=True)
    existing=voice_info(folder)
    if existing:
        return existing
    model='qwen3-tts-vd-2026-01-26'
    result=api(config,'services/audio/tts/customization',{'model':'qwen-voice-design','input':{'action':'create','target_model':model,'preferred_name':preferred_name,'voice_prompt':prompt,'preview_text':preview,'language':'zh'},'parameters':{'sample_rate':24000,'response_format':'wav'}})
    info={'voice':result['output']['voice'],'model':model,'label':'原创设计音色 · AI 合成','description':prompt}
    temporary=folder/'voice.tmp.json'
    temporary.write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(temporary,folder/'voice.json')
    preview_audio=result['output'].get('preview_audio',{}).get('data')
    if preview_audio:
        (folder/'voice-design-preview.wav').write_bytes(base64.b64decode(preview_audio))
    return info

def enroll(config,folder,sample):
    folder=Path(folder)
    existing=voice_info(folder)
    if existing:
        return existing
    raw=Path(sample).read_bytes()
    result=api(config,'services/audio/tts/customization',{'model':'qwen-voice-enrollment','input':{'action':'create','target_model':MODEL,'preferred_name':'myprofessorbuddy','audio':{'data':'data:audio/wav;base64,'+base64.b64encode(raw).decode()}}})
    voice=result['output']['voice']
    info={'voice':voice,'model':MODEL,'label':'授权复刻音色 · AI 合成','source_authorization':'User confirmed voice-cloning authorization in this task.','sample':'voice-reference.wav'}
    temporary=folder/'voice.tmp.json'
    temporary.write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(temporary,folder/'voice.json')
    return info

def synthesize_stream(config,folder,text):
    info=voice_info(folder)
    if not info:
        raise ValueError('Custom voice not configured')
    digest=hashlib.sha256((info['model']+info['voice']+text).encode()).hexdigest()
    cached=Path(folder)/'speech-cache'/(digest+'.wav')
    if cached.exists():
        try:
            with wave.open(io.BytesIO(cached.read_bytes()),'rb') as audio:
                if audio.getnchannels()==1 and audio.getsampwidth()==2 and audio.getframerate()==24000:
                    pcm=audio.readframes(4*1024*1024+1)
                    if pcm and len(pcm)%2==0 and len(pcm)<=8*1024*1024:
                        for offset in range(0,len(pcm),12000):
                            yield pcm[offset:offset+12000]
                        return
        except (OSError,EOFError,wave.Error):
            pass
    base=urlparse(config['QWEN_BASE_URL'])
    if base.scheme!='https':
        raise ValueError('Qwen requires HTTPS')
    endpoint=f'{base.scheme}://{base.netloc}/api/v1/services/aigc/multimodal-generation/generation'
    payload={'model':info['model'],'input':{'text':text,'voice':info['voice'],'language_type':'Auto'}}
    request=Request(endpoint,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+config['QWEN_API_KEY'],'Content-Type':'application/json','X-DashScope-SSE':'enable'})
    size=0
    frames=[]
    ended=False
    first=True
    carry=b''
    started=time.monotonic()
    with urlopen(request,timeout=20) as response:
        for line in response:
            if time.monotonic()-started>45:
                raise TimeoutError('Voice stream exceeded time budget')
            if not line.startswith(b'data:'):
                continue
            data=line[5:].strip()
            if data==b'[DONE]':
                ended=True
                break
            value=json.loads(data)
            if value.get('code') or value.get('error'):
                raise ValueError('Voice stream failed: '+str(value.get('code') or 'provider_error'))
            output=value.get('output',{})
            encoded=output.get('audio',{}).get('data')
            if encoded:
                chunk=base64.b64decode(encoded,validate=True)
                # Custom voices may prefix the first PCM packet with a streaming WAV header.
                if first and chunk.startswith(b'RIFF'):
                    if len(chunk)<44 or chunk[8:12]!=b'WAVE' or chunk[36:40]!=b'data' or struct.unpack_from('<HHI',chunk,20)!=(1,1,24000) or struct.unpack_from('<H',chunk,34)[0]!=16:
                        raise ValueError('Unsupported streaming WAV format')
                    chunk=chunk[44:]
                first=False
                size+=len(chunk)
                if size>8*1024*1024:
                    raise ValueError('Invalid PCM stream')
                chunk=carry+chunk
                cut=len(chunk)-(len(chunk)%2)
                carry=chunk[cut:]
                if cut:
                    frames.append(chunk[:cut])
                    yield chunk[:cut]
            if output.get('finish_reason')=='stop':
                ended=True
    if carry:
        raise ValueError('Invalid PCM stream')
    if not ended or not size:
        raise ValueError('Incomplete voice stream')
    temp=None
    try:
        cached.parent.mkdir(exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=cached.parent,suffix='.tmp',delete=False) as file:
            temp=Path(file.name)
            with wave.open(file,'wb') as audio:
                audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(24000)
                audio.writeframes(b''.join(frames))
        os.replace(temp,cached)
        prune_cache(cached.parent)
    except OSError:
        pass  # Cache failure must not discard an otherwise complete voice response.
    finally:
        if temp:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass


def synthesize(config,folder,text):
    with VOICE_LOCK:
        info=voice_info(folder)
        if not info:
            raise ValueError('Custom voice not configured')
        cache=Path(folder)/'speech-cache'
        cache.mkdir(exist_ok=True)
        digest=hashlib.sha256((info['model']+info['voice']+text).encode()).hexdigest()
        path=cache/(digest+'.wav')
        if path.exists():
            return path.read_bytes()
        result=api(config,'services/aigc/multimodal-generation/generation',{'model':info['model'],'input':{'text':text,'voice':info['voice'],'language_type':'Auto'}})
        url=result['output']['audio']['url']
        parsed=urlparse(url)
        if parsed.scheme not in ('http','https') or not (parsed.hostname or '').endswith(('.aliyuncs.com','.aliyun.com')):
            raise ValueError('Unexpected audio download host')
        url=parsed._replace(scheme='https').geturl()
        with urlopen(url,timeout=60) as response:
            raw=response.read(8*1024*1024+1)
        if len(raw)>8*1024*1024 or raw[:4]!=b'RIFF':
            raise ValueError('Invalid synthesized WAV audio')
        temp=path.with_suffix('.tmp')
        temp.write_bytes(raw)
        os.replace(temp,path)
        # Speech audio is a disposable cache, distinct from permanent learning records.
        prune_cache(cache)
        return raw
