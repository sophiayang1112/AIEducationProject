import base64
import json
import queue
import unittest
from unittest.mock import patch
import learning_realtime as rt

class FakeSocket:
    def __init__(self):self.events=queue.Queue();self.sent=[];self.closed=False
    def settimeout(self,value):pass
    def send(self,raw):
        event=json.loads(raw);self.sent.append(event)
        if event['type']=='session.update':self.events.put(json.dumps({'type':'session.updated'}))
    def recv(self):
        try:return self.events.get(timeout=.1)
        except queue.Empty:raise rt.websocket.WebSocketTimeoutException()
    def close(self):self.closed=True;self.events.put('')

class RealtimeTests(unittest.TestCase):
    def test_start_retries_transient_connection_once(self):
        sock=FakeSocket()
        config={'QWEN_BASE_URL':'https://dashscope.aliyuncs.com/compatible-mode/v1','QWEN_API_KEY':'test'}
        with patch.object(rt.websocket,'create_connection',side_effect=[rt.websocket.WebSocketConnectionClosedException(),sock]) as connect:
            result=rt.handle('start',{},config)
            try:self.assertEqual(connect.call_count,2)
            finally:rt.handle('stop',{'session_id':result['session_id']},config)

    def test_audio_session_lifecycle_and_validation(self):
        sock=FakeSocket()
        config={'QWEN_BASE_URL':'https://dashscope.aliyuncs.com/compatible-mode/v1','QWEN_API_KEY':'test'}
        with patch.object(rt.websocket,'create_connection',return_value=sock) as connect:
            result=rt.handle('start',{},config);key=result['session_id']
            try:
                self.assertIn('wss://dashscope.aliyuncs.com/',connect.call_args.args[0])
                self.assertEqual(sock.sent[0]['session']['turn_detection']['silence_duration_ms'],450)
                self.assertTrue(rt.handle('audio',{'session_id':key,'audio':base64.b64encode(bytes(3200)).decode()},config)['accepted'])
                with self.assertRaises(ValueError):rt.handle('audio',{'session_id':key,'audio':'AA=='},config)
                sock.events.put(json.dumps({'type':'conversation.item.input_audio_transcription.completed','transcript':'Hello','emotion':'happy'}))
                output=rt.handle('poll',{'session_id':key},config)
                self.assertEqual(output['events'][0]['text'],'Hello')
                self.assertNotIn('emotion',output['events'][0])
            finally:rt.handle('stop',{'session_id':key},config)
            self.assertTrue(sock.closed)
            self.assertNotIn(key,rt.SESSIONS)

if __name__=='__main__':unittest.main()
