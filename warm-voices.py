"""Prepare fixed character greetings in the private local speech cache."""
import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen

GREETINGS = {
    'dark': '同学，先和我说一句 Hello！我会一直给你加油。',
    'light': '探索伙伴派我来挑战！你能说 I like apples 吗？',
    'challenger': '同学，这次我一定要赢你！Ready?',
    'chinese': '同学，把语文作业给我看看，我们先做当前这一题。',
    'english': '同学，把英语作业给我看看，我们一起完成。',
    'math': '同学，把数学作业给我看看，我们先检查这一题。',
}

def main():
    base='http://127.0.0.1:8765'
    with urlopen(base+'/api/health',timeout=5) as response:
        health=json.load(response)
    failed=[]
    lines=list(GREETINGS.items())
    friends=json.loads((Path(__file__).parent/'learning-assets'/'voice-phrases.json').read_text(encoding='utf-8'))
    lines.extend((role,text) for role,phrases in friends.items() for text in phrases)
    for role in ('chinese','english','math'):
        lines.extend((role,text) for text in (
            '同学，摄像头关着，我现在看不到作业。请打开摄像头，把题目放近一点；也可以把题目读给我听。',
            '同学，今天布置的作业写好了吗？',
            '同学，把写好的作业放到摄像头前，我们检查这一题。',
            '同学，这一题看不清，请把作业放近一点，光线调亮一些。',
            '同学，摄像头坏了没关系，把题目读给我听，我们一起做。',
        ))
    def prepare(item):
        character,text=item
        started=time.monotonic()
        try:
            request=Request(base+'/api/speech-stream',data=json.dumps({'text':text,'character':character}).encode(),headers={'Content-Type':'application/json','X-Learning-Token':health['token']})
            with urlopen(request,timeout=150) as response:
                packets=[json.loads(line) for line in response if line.strip()]
            if not packets or packets[-1]['type']!='done':
                raise RuntimeError('Synthesis did not complete')
            print(f'{character}: cached, {time.monotonic()-started:.2f}s',flush=True)
        except Exception as error:
            print(f'{character}: {type(error).__name__}',flush=True)
            return item
    with ThreadPoolExecutor(max_workers=2) as pool:
        failed=[item for item in pool.map(prepare,lines) if item]
        if failed:
            failed=[item for item in pool.map(prepare,failed) if item]
    if failed:
        raise SystemExit('Not cached: '+', '.join(role for role,text in failed))
    print(f'Complete: {len(lines)} cached phrases.',flush=True)

if __name__=='__main__':
    main()
