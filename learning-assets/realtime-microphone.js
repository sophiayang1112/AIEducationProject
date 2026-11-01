'use strict';
class RealtimeMicrophone{
  constructor(token,onEvent){this.token=token;this.onEvent=onEvent;this.stopped=false;this.queue=[];this.uploading=false;this.controller=new AbortController();}
  async api(action,body={}){
    const controller=new AbortController(),abort=()=>controller.abort();
    this.controller.signal.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(abort,action==='start'?22000:8000);
    try{
      const response=await fetch('/api/asr/'+action,{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Learning-Token':this.token},body:JSON.stringify({session_id:this.id,...body})});
      if(!response.ok)throw Error('http_'+response.status);return await response.json();
    }finally{clearTimeout(timeout);this.controller.signal.removeEventListener('abort',abort);}
  }
  async start(){
    try{
      this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(this.stopped){this.stream.getTracks().forEach(track=>track.stop());return;}
      this.context=new AudioContext({sampleRate:16000});
      if(this.context.sampleRate!==16000)throw Error('设备不支持实时收音采样率');
      await this.context.audioWorklet.addModule('/learning-assets/microphone-worklet.js');
      const session=await this.api('start');this.id=session.session_id;
      if(this.stopped){this.stop();return;}
      this.source=this.context.createMediaStreamSource(this.stream);
      this.node=new AudioWorkletNode(this.context,'microphone-packets');
      this.gain=this.context.createGain();this.gain.gain.value=0;
      this.source.connect(this.node);this.node.connect(this.gain);this.gain.connect(this.context.destination);
      this.node.port.onmessage=event=>{
        if(this.stopped)return;
        if(this.queue.length>=30){this.fail('upload_backlog');return;}
        this.queue.push(new Uint8Array(event.data));this.upload();
      };
      for(const track of this.stream.getAudioTracks())track.addEventListener('ended',()=>this.fail('microphone_ended'),{once:true});
      await this.context.resume();this.poll();
    }catch(error){this.stop();throw error;}
  }
  async upload(){
    if(this.uploading||this.stopped)return;this.uploading=true;
    try{while(this.queue.length&&!this.stopped){
      const packets=this.queue.splice(0,5);let value='';
      for(const packet of packets)for(const byte of packet)value+=String.fromCharCode(byte);
      const result=await this.api('audio',{audio:btoa(value)});
      if(result.closed)throw Error(result.error_code||'upstream_closed');
    }}catch(error){if(!this.stopped)this.fail('upload_'+error.message);}finally{this.uploading=false;}
  }
  async poll(){
    try{while(!this.stopped){const data=await this.api('poll');for(const event of data.events){if(!this.stopped)this.onEvent(event);}if(data.closed){if(!this.stopped)this.fail(data.error_code||'upstream_closed');break;}}}
    catch(error){if(!this.stopped)this.fail('poll_'+error.message);}
  }
  fail(code='unknown'){
    if(this.stopped)return;
    const diagnostics=window.myprofessorAudioDiagnostics||(window.myprofessorAudioDiagnostics=[]);
    diagnostics.push({time:new Date().toISOString(),code,queuedPackets:this.queue.length});if(diagnostics.length>40)diagnostics.shift();
    this.stop();this.onEvent({type:'error',code,error:code==='microphone_ended'?'麦克风已断开，请检查设备后重新开始互动。':'实时收音连接中断，正在尝试恢复。'});
  }
  stop(){
    this.stopped=true;this.controller.abort();this.queue=[];
    this.stream?.getTracks().forEach(track=>track.stop());this.node?.disconnect();this.source?.disconnect();this.gain?.disconnect();this.context?.close().catch(()=>{});
    if(this.id){fetch('/api/asr/stop',{method:'POST',headers:{'Content-Type':'application/json','X-Learning-Token':this.token},body:JSON.stringify({session_id:this.id}),keepalive:true}).catch(()=>{});this.id=null;}
  }
}
window.RealtimeMicrophone=RealtimeMicrophone;
