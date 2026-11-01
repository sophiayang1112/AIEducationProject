import base64
import io
import json
import tempfile
import wave
import unittest
from pathlib import Path
from unittest.mock import patch
import learning_voice as voice


class VoiceStreamTests(unittest.TestCase):
    def test_live_failure_never_replays_published_audio(self):
        def failed(*args):
            yield b'\0\0'
            raise voice.IncompleteRead(b'')
        with patch.object(voice,'synthesize_stream',side_effect=failed) as synth:
            stream=voice.live_speech({},'.','hello')
            self.assertEqual(next(stream),b'\0\0')
            with self.assertRaises(voice.IncompleteRead):
                next(stream)
            self.assertEqual(synth.call_count,1)

    def test_pcm_packets_can_split_a_sample(self):
        packets=[{'output':{'audio':{'data':base64.b64encode(part).decode()}}} for part in (b'\x01',b'\x02\x03',b'\x04')]
        packets[-1]['output']['finish_reason']='stop'
        raw=b''.join(b'data: '+json.dumps(packet).encode()+b'\n' for packet in packets)
        with patch.object(voice,'urlopen',return_value=io.BytesIO(raw)):
            self.assertEqual(b''.join(voice.synthesize_stream(self.config,self.folder.name,'Split')),b'\x01\x02\x03\x04')
    def test_retry_discards_partial_attempt(self):
        def failed(*args):
            yield b'bad'
            raise ValueError('Incomplete voice stream')
        with patch.object(voice,'synthesize_stream',side_effect=[failed(),iter([b'good'])]),patch.object(voice.time,'sleep'):
            self.assertEqual(voice.prepared_speech({},'.','hello'),[b'good'])

    def test_retry_is_bounded_and_does_not_retry_bad_voice(self):
        for error,expected in [(TimeoutError(),2),(voice.IncompleteRead(b''),2),(ValueError('Voice stream failed: InternalError'),2),(ValueError('Voice stream failed: DataInspectionFailed'),1),(ValueError('Custom voice not configured'),1)]:
            with patch.object(voice,'synthesize_stream',side_effect=error) as synth,patch.object(voice.time,'sleep'):
                with self.assertRaises(type(error)):
                    voice.prepared_speech({},'.','hello')
                self.assertEqual(synth.call_count,expected)

    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        Path(self.folder.name,'voice.json').write_text(json.dumps({'model':'clone-test','voice':'test-voice'}))
        self.config={'QWEN_BASE_URL':'https://dashscope.aliyuncs.com/compatible-mode/v1','QWEN_API_KEY':'fake'}

    def test_pcm_is_yielded_before_completion(self):
        first={'output':{'audio':{'data':base64.b64encode(b'\x00\x01'*20).decode()}}}
        last={'output':{'finish_reason':'stop','audio':{}}}
        raw=b'data: '+json.dumps(first).encode()+b'\n\ndata: '+json.dumps(last).encode()+b'\n'
        with patch.object(voice,'urlopen',return_value=io.BytesIO(raw)) as upstream:
            stream=voice.synthesize_stream(self.config,self.folder.name,'Hello')
            self.assertEqual(next(stream),b'\x00\x01'*20)
            self.assertEqual(list(stream),[])
            request=upstream.call_args.args[0]
            self.assertEqual(request.get_header('X-dashscope-sse'),'enable')
            self.assertEqual(json.loads(request.data)['input']['voice'],'test-voice')
        with patch.object(voice,'urlopen') as upstream:
            self.assertEqual(b''.join(voice.synthesize_stream(self.config,self.folder.name,'Hello')),b'\x00\x01'*20)
            upstream.assert_not_called()

    def test_truncated_audio_is_not_success(self):
        packet={'output':{'audio':{'data':base64.b64encode(b'\x00\x01').decode()}}}
        with patch.object(voice,'urlopen',return_value=io.BytesIO(b'data: '+json.dumps(packet).encode()+b'\n')):
            with self.assertRaisesRegex(ValueError,'Incomplete'):
                list(voice.synthesize_stream(self.config,self.folder.name,'Hello'))

    def test_error_and_odd_pcm_rejected(self):
        for packet in [{'code':'QuotaExceeded'},{'output':{'audio':{'data':'AA=='}}}]:
            with self.subTest(packet=packet),patch.object(voice,'urlopen',return_value=io.BytesIO(b'data: '+json.dumps(packet).encode()+b'\n')):
                with self.assertRaises(ValueError):
                    list(voice.synthesize_stream(self.config,self.folder.name,'Hello'))

    def test_wav_header_is_not_played_as_pcm(self):
        output=io.BytesIO()
        with wave.open(output,'wb') as audio:
            audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(24000)
            audio.writeframes(b'\x00\x01'*20)
        packet={'output':{'audio':{'data':base64.b64encode(output.getvalue()).decode()},'finish_reason':'stop'}}
        with patch.object(voice,'urlopen',return_value=io.BytesIO(b'data: '+json.dumps(packet).encode()+b'\n')):
            self.assertEqual(b''.join(voice.synthesize_stream(self.config,self.folder.name,'Hello')),b'\x00\x01'*20)


if __name__=='__main__':
    unittest.main()
