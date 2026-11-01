"""Production prompt smoke tests against Qwen, using an isolated temporary history."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import sys
from urllib.request import Request,urlopen

sys.stdout.reconfigure(encoding='utf-8')

spec=importlib.util.spec_from_file_location('app','learning-server.py')
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
app.load_config()
if '--deepseek' in sys.argv:
    def request_deepseek(messages, stream=False, tokens=450):
        payload={'model':'deepseek-flash','messages':messages,'stream':stream,'max_tokens':tokens,'thinking':{'type':'disabled'}}
        return urlopen(Request('https://api.deepseek.com/chat/completions',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+app.CONFIG['DEEPSEEK_API_KEY'],'Content-Type':'application/json'}),timeout=60)
    app.request_qwen=request_deepseek
app.background_memory=lambda:None
cases=[
    ('challenger',False,'今天我吃了一个超大的冰淇淋！','off'),
    ('dark',False,'我现在不想练英语，只想聊植物大战僵尸。','off'),
    ('light',False,'你是谁的好朋友？','off'),
    ('dark',True,'探索伙伴，今天你想聊什么？','off'),
    ('chinese',False,'我这个字不会写，但是摄像头坏了。','off'),
    ('english',False,'我不会读 apple，教我一下。','off'),
    ('math',False,'2加3应该怎么想？','off'),
]
if '--refusal' in sys.argv:
    cases=[('chinese',False,'我不愿意把作业放在镜头前。','on'),('chinese',False,'不放，我就不放。','on'),('chinese',False,'摄像头坏了，我把题目读给你吧。','off')]
with tempfile.TemporaryDirectory(prefix='myprofessor-model-test-') as folder:
    app.DATA=Path(folder)
    app.init()
    server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        for index,(role,group,message,camera) in enumerate(cases):
            started=time.perf_counter()
            body={'message':message,'character':role,'adventure':group,'camera_state':camera,'request_id':f'live-model-test-{index:06d}'}
            request=Request(f'http://127.0.0.1:{server.server_port}/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Learning-Token':app.TOKEN})
            with urlopen(request,timeout=90) as response:
                events=[json.loads(line) for line in response if line.strip()]
            reply=''.join(event.get('text','') for event in events if event['type']=='delta')
            print(json.dumps({'role':role,'group':group,'seconds':round(time.perf_counter()-started,2),'complete':events[-1]['type']=='done','reply':reply},ensure_ascii=False),flush=True)
            if events[-1]['type']!='done':
                raise RuntimeError('Live model request failed')
    finally:
        server.shutdown();server.server_close();thread.join()
