import importlib.util
import io
import base64
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen
from urllib.error import HTTPError

spec=importlib.util.spec_from_file_location('learning',Path(__file__).with_name('learning-server.py'))
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
real_model_request=app.request_qwen

class ServerTests(unittest.TestCase):
    def test_teacher_refusal_prioritizes_speech_over_camera(self):
        with app.db() as con:
            con.execute("INSERT INTO turns(request_id,user,assistant,status,created_at,character,kind) VALUES(?,?,?,'complete',?,'chinese','observation')",('refusal-context-01','automatic observation','请把作业本放在镜头前。',app.now()))
        captured=[]
        original=app.request_qwen
        app.request_qwen=lambda messages,**kwargs:(captured.append(messages) or original(messages,**kwargs))
        body={'message':'我不愿意放。','character':'chinese','request_id':'refusal-test-0001','camera_state':'on','image':'data:image/jpeg;base64,'+base64.b64encode(b'\xff\xd8\xfftest').decode()}
        request=Request(self.url+'/api/chat',data=json.dumps(body).encode(),headers={'X-Learning-Token':app.TOKEN})
        with urlopen(request) as response:
            self.assertIn('"type": "done"',response.read().decode())
        self.assertIsInstance(captured[0][-1]['content'],str)
        self.assertIn('CURRENT SPOKEN RESPONSE IS A REFUSAL',captured[0][0]['content'])
        self.assertIn('请把作业本放在镜头前',captured[0][0]['content'])

    def test_text_and_camera_use_separate_verified_models(self):
        config={'MYPROFESSOR_TEXT_PROVIDER':'deepseek','DEEPSEEK_API_KEY':'test','QWEN_API_KEY':'test','QWEN_BASE_URL':'https://dashscope.aliyuncs.com/compatible-mode/v1','QWEN_MODEL_NAME':'qwen-vl-max'}
        with patch.dict(app.CONFIG,config),patch.object(app,'urlopen') as opened:
            real_model_request([{'role':'user','content':'hello'}],stream=True)
            request=opened.call_args.args[0]
            body=json.loads(request.data)
            self.assertEqual(request.full_url,'https://api.deepseek.com/chat/completions')
            self.assertEqual(body['model'],'deepseek-flash')
            self.assertEqual(body['thinking'],{'type':'disabled'})
            real_model_request([{'role':'user','content':[{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,test'}}]}],stream=True)
            request=opened.call_args.args[0]
            self.assertTrue(request.full_url.startswith('https://dashscope.aliyuncs.com/'))
            self.assertEqual(json.loads(request.data)['model'],'qwen-vl-max')

    def test_barge_in_does_not_block_new_turn_or_commit_old_reply(self):
        started=threading.Event();release=threading.Event();results=[]
        good=app.request_qwen
        class Slow:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def __iter__(self):
                started.set();release.wait(3)
                yield b'data: {"choices":[{"delta":{"content":"stale"},"finish_reason":"stop"}]}\n'
        app.request_qwen=lambda messages,**kwargs:Slow() if messages[-1]['content']=='old request' else good(messages,**kwargs)
        thread=threading.Thread(target=lambda:results.append(self.post('old request','cancel-request-00001')))
        thread.start()
        try:
            self.assertTrue(started.wait(2))
            req=Request(self.url+'/api/cancel',data=json.dumps({'request_id':'cancel-request-00001'}).encode(),headers={'X-Learning-Token':app.TOKEN})
            with urlopen(req) as response:self.assertTrue(json.load(response)['cancelled'])
            self.assertEqual(self.post('new request','cancel-request-00002')[-1]['type'],'done')
        finally:
            release.set();thread.join(4)
        self.assertFalse(thread.is_alive())
        with app.db() as con:
            old=con.execute('SELECT status,assistant FROM turns WHERE request_id=?',('cancel-request-00001',)).fetchone()
            self.assertEqual(old['status'],'failed')
            self.assertNotIn('stale',old['assistant'])

    def test_homework_time_and_local_unverified_record(self):
        for hour,expected in [(5,False),(6,True),(10,True),(11,False)]:
            at=app.datetime(2026,9,14,hour,tzinfo=app.timezone.utc)
            self.assertEqual(app.tutor_context('你好',at)['after_school_window'],expected)
        for text,expected in [('写好了',True),('我作业写完了',True),('还没写好了呢',False),('作业没有完成',False)]:
            self.assertEqual(app.tutor_context(text)['homework_reported_complete'],expected)
            self.assertFalse(app.tutor_context(text)['verified_complete'])
        self.post('今天作业写好了')
        app.refresh_memory()
        with app.db() as con:
            row=con.execute("SELECT value FROM local_observations WHERE category='homework_completion_report'").fetchone()
            self.assertEqual(row['value'],'今天作业写好了')
            self.assertIn('尚未核验',con.execute('SELECT content FROM memories ORDER BY id DESC LIMIT 1').fetchone()[0])

    @classmethod
    def setUpClass(cls):
        cls.folder=tempfile.TemporaryDirectory()
        app.DATA=Path(cls.folder.name)
        app.init()
        app.CONFIG['QWEN_API_KEY']='test-not-a-real-key'
        cls.memory_hook=app.background_memory
        app.background_memory=lambda:None
        cls.server=app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
        cls.url=f'http://127.0.0.1:{cls.server.server_port}'
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        app.background_memory=cls.memory_hook
        cls.folder.cleanup()

    def setUp(self):
        with app.db() as con:
            con.execute('DELETE FROM turns')
            con.execute('DELETE FROM memories')
            con.execute('DELETE FROM local_observations')
            con.execute('DELETE FROM parent_profile_versions')
            con.execute('DELETE FROM turn_search')
            con.execute('UPDATE story_progress SET spoken_turns=0')
        def qwen(messages,stream=False,tokens=450):
            if not stream:
                return io.BytesIO(json.dumps({'choices':[{'message':{'content':'Likes apples; practice fruit vocabulary.'}}]}).encode())
            return io.BytesIO(b'data: {"choices":[{"delta":{"content":"Hello! "}}]}\n\ndata: {"choices":[{"delta":{"content":"Do you like apples?"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n')
        app.request_qwen=qwen

    def post(self,text='I like apples.',request_id='test-request-00001'):
        request=Request(self.url+'/api/chat',data=json.dumps({'message':text,'request_id':request_id}).encode(),headers={'Content-Type':'application/json','X-Learning-Token':app.TOKEN})
        with urlopen(request) as response:
            raw=response.read().decode()
            return json.loads(raw) if response.headers['Content-Type'].startswith('application/json') else [json.loads(line) for line in raw.splitlines()]

    def test_stream_idempotency_persistence_and_backup(self):
        events=self.post()
        self.assertEqual(events[-1]['type'],'done')
        self.assertTrue(events[-1]['saved'])
        self.assertEqual(self.post()['reply'],'Hello! Do you like apples?')
        app.init()
        with app.db() as con:
            self.assertEqual(con.execute('SELECT count(*) FROM turns').fetchone()[0],1)
            self.assertEqual(con.execute('SELECT status FROM turns').fetchone()[0],'complete')
        self.assertTrue((app.DATA/'backups/latest.sqlite3').exists())

    def test_failed_stream_retry(self):
        good=app.request_qwen
        app.request_qwen=lambda *a,**k:io.BytesIO(b'data: {"choices":[{"delta":{"content":"Partial"}}]}\n')
        events=self.post()
        self.assertEqual(events[-1]['type'],'error')
        with app.db() as con:
            self.assertEqual(con.execute('SELECT status FROM turns').fetchone()[0],'failed')
        app.request_qwen=good
        self.assertEqual(self.post()[-1]['type'],'done')
        with app.db() as con:
            self.assertEqual(con.execute('SELECT count(*) FROM turns').fetchone()[0],1)

    def test_archive_retrieval_and_memory_versions(self):
        self.post()
        app.refresh_memory()
        for i in range(18):
            self.post('Let us count numbers.',f'test-request-{i+2:05d}')
        app.refresh_memory()
        context=app.context_messages('apples',1000)
        self.assertIn('I like apples.',context[0]['content'])
        self.assertIn('last_english_attempt',context[0]['content'])
        with app.db() as con:
            self.assertGreater(con.execute('SELECT count(*) FROM memories').fetchone()[0],1)
        with urlopen(Request(self.url+'/api/export',headers={'X-Learning-Token':app.TOKEN})) as response:
            data=json.load(response)
        self.assertEqual(len(data['turns']),19)
        self.assertNotIn('test-not-a-real-key',json.dumps(data))

    def test_private_paths_and_cross_origin(self):
        for path in ['/learning-server.py','/.env','/learning-assets/original-multiplication.html','/../.env','/learning.sqlite3']:
            with self.assertRaises(HTTPError) as error:
                urlopen(self.url+path)
            self.assertEqual(error.exception.code,404)
        request=Request(self.url+'/api/chat',data=b'{}',headers={'Origin':'https://example.com','X-Learning-Token':app.TOKEN})
        with self.assertRaises(HTTPError) as error:
            urlopen(request)
        self.assertEqual(error.exception.code,403)

    def test_invalid_body_and_concurrent_request(self):
        with self.assertRaises(HTTPError) as error:
            self.post('')
        self.assertEqual(error.exception.code,400)
        app.LOCK.acquire()
        try:
            with self.assertRaises(HTTPError) as error:
                self.post()
            self.assertEqual(error.exception.code,409)
        finally:
            app.LOCK.release()

    def test_camera_frame_context_not_archived(self):
        captured=[]
        good=app.request_qwen
        def model(messages,**kwargs):
            captured.append(messages)
            return good(messages,**kwargs)
        app.request_qwen=model
        image='data:image/jpeg;base64,'+base64.b64encode(b'\xff\xd8\xffsample-frame').decode()
        payload={'message':'Look at my work.','image':image,'request_id':'camera-test-request-001'}
        request=Request(self.url+'/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-Learning-Token':app.TOKEN})
        with urlopen(request) as response:
            events=[json.loads(line) for line in response]
        self.assertEqual(events[-1]['type'],'done')
        self.assertEqual(captured[0][-1]['content'][0]['image_url']['url'],image)
        with urlopen(Request(self.url+'/api/export',headers={'X-Learning-Token':app.TOKEN})) as response:
            archive=json.load(response)
        self.assertNotIn(image,json.dumps(archive))
        self.assertEqual(len(archive['turns'][0]['image_hash']),64)

    def test_story_cast_progress_and_retry(self):
        def turn(message,number,kind='child'):
            payload={'message':message,'character':'dark','adventure':True,'kind':kind,'request_id':f'story-request-{number:06d}'}
            request=Request(self.url+'/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-Learning-Token':app.TOKEN})
            with urlopen(request) as response:
                raw=response.read()
                return json.loads(raw) if response.headers['Content-Type'].startswith('application/json') else [json.loads(x) for x in raw.splitlines()][-1]
        self.assertEqual(turn('Start please',0,'start')['character'],'dark')
        for i,actor in enumerate(['dark','challenger','light','dark','challenger','dark'],1):
            event=turn('Practice Hello',i)
            self.assertEqual(event['character'],actor)
            self.assertEqual(turn('Practice Hello',i)['character'],actor)
        with app.db() as con:
            self.assertEqual(con.execute('SELECT spoken_turns FROM story_progress').fetchone()[0],6)

        turn('Please observe',50,'observation')
        with app.db() as con:
            self.assertEqual(con.execute('SELECT spoken_turns FROM story_progress').fetchone()[0],6)

    def test_local_memory_and_minimum_profile_context(self):
        profile={'learner':{'friends':['LocalFriendOnly'],'kindergarten_class':'PrivateClassOnly','interests':['plants']}}
        with app.db() as con:
            con.execute('INSERT INTO parent_profile_versions(content,created_at) VALUES(?,?)',(json.dumps(profile),app.now()))
        self.post('I like apples.')
        def forbidden(*args,**kwargs):
            self.fail('Memory extraction must not call any model API')
        app.request_qwen=forbidden
        app.refresh_memory()
        app.init()
        context=json.dumps(app.context_messages('Hello',100000),ensure_ascii=False)
        self.assertIn('last_english_attempt',context)
        self.assertNotIn('LocalFriendOnly',context)
        self.assertNotIn('PrivateClassOnly',context)
        self.assertIn('LocalFriendOnly',json.dumps(app.context_messages('friends',100000)))
        with urlopen(Request(self.url+'/api/memory',headers={'X-Learning-Token':app.TOKEN})) as response:
            memory=json.load(response)
        self.assertEqual(memory['profile'],profile)
        self.assertEqual(memory['extraction'],'local_rules')
        self.assertIn('I like apples.',memory['notes'])
        for path in ['/api/memory','/api/export','/api/history']:
            with self.assertRaises(HTTPError) as error:
                urlopen(self.url+path)
            self.assertEqual(error.exception.code,403)

    def test_solo_zhou_does_not_include_other_speakers(self):
        captured=[]
        good=app.request_qwen
        def capture(messages,**kwargs):
            captured.append(messages[0]['content'])
            return good(messages,**kwargs)
        app.request_qwen=capture
        payload={'message':'Hello','character':'challenger','adventure':False,'request_id':'solo-challenger-test-00001'}
        request=Request(self.url+'/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-Learning-Token':app.TOKEN})
        with urlopen(request) as response:
            event=json.loads(response.read().splitlines()[-1])
        self.assertEqual(event['character'],'challenger')
        self.assertIn('SOLO FRIEND',captured[0])
        self.assertNotIn('ENSEMBLE MODE',captured[0])
        self.assertNotIn('PRIMARY TEACHER MISSION',captured[0])
        self.assertNotIn('LOCAL HOMEWORK CONTEXT',captured[0])
        self.assertIn('never demand homework',captured[0])
        with app.db() as con:
            self.assertEqual(con.execute('SELECT spoken_turns FROM story_progress').fetchone()[0],0)

    def test_teacher_and_polluted_history_cannot_become_zhou_dialogue(self):
        with app.db() as con:
            for index,(role,stage,reply) in enumerate([
                ('english','','请把英语作业给我检查。'),
                ('challenger','','同学，把作业给我看。'),
                ('challenger','','同学，来个英语挑战吧！'),
                ('dark','challenge','[challenger] 我来挑战你！\n[english] 把作业给我看看。'),
            ]):
                con.execute("INSERT INTO turns(request_id,user,assistant,character,speaker,stage,kind,status,created_at) VALUES(?,?,?,?,?,?,?,'complete',?)",(f'history-role-{index:04d}','我喜欢苹果',reply,role,role,stage,'child',app.now()))
        solo=app.context_messages('继续吧',100,'challenger',False)
        replies=[m['content'] for m in solo if m['role']=='assistant']
        self.assertEqual(replies,['同学，来个英语挑战吧！'])
        self.assertIn('我喜欢苹果',solo[0]['content'])
        group=app.context_messages('继续吧',100,'dark',True)
        self.assertEqual([m['content'] for m in group if m['role']=='assistant'],['[challenger] 我来挑战你！'])
        teacher=app.context_messages('继续吧',100,'english',False)
        self.assertEqual([m['content'] for m in teacher if m['role']=='assistant'],['请把英语作业给我检查。'])
        with app.db() as con:
            self.assertEqual(con.execute('SELECT count(*) FROM turns').fetchone()[0],4)

    def test_teacher_identity_and_ensemble_prompt(self):
        captured=[]
        good=app.request_qwen
        def capture(messages,**kwargs):
            captured.append(messages[0]['content'])
            return good(messages,**kwargs)
        app.request_qwen=capture
        for role in ('chinese','english','math','dark'):
            payload={'message':'Hello','character':role,'adventure':True,'request_id':'identity-test-'+role+'-001'}
            request=Request(self.url+'/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-Learning-Token':app.TOKEN})
            with urlopen(request) as response:
                self.assertEqual(json.loads(response.read().splitlines()[-1])['type'],'done')
        for content in captured[:3]:
            self.assertIn('SOLO TEACHER',content)
            self.assertIn('PRIMARY TEACHER MISSION',content)
            self.assertIn('TIME-AWARE HOMEWORK ROUTINE',content)
            self.assertIn('camera_state',content)
            self.assertIn('camera is broken',content)
            self.assertIn('Stop camera reminders',content)
            self.assertNotIn('ENSEMBLE MODE',content)
        self.assertIn('ENSEMBLE MODE',captured[3])
        self.assertIn('No guest teacher this turn',captured[3])
        self.assertIn('normally only ONE responds',captured[3])
        self.assertIn('NEVER the math teacher',captured[3])

if __name__=='__main__':
    unittest.main()
