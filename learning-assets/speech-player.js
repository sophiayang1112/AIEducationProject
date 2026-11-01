'use strict';
class CompanionSpeechPlayer {
  constructor(){this.context=null;this.operation=null;this.pending=[];this.loading=0;}
  unlock(){
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(!AudioContext)return;
    if(!this.context)this.context=new AudioContext();
    this.context.resume().catch(()=>{});
  }
  stop(){
    const op=this.operation;
    if(!op)return;
    this.operation=null;
    op.controller.abort();
    for(const node of op.nodes){node.onended=null;try{node.stop();}catch{}node.disconnect();}
    op.nodes.clear();
    op.reject(new DOMException('Stopped','AbortError'));
  }
  prepare(text,character,token){
    const controller=new AbortController();
    let resolve,reject;
    const audio=new Promise((yes,no)=>{resolve=yes;reject=no;});audio.catch(()=>{});
    const job={text,character,token,controller,resolve,reject,audio,chunks:[],complete:false,notify:null};
    this.pending.push(job);this.pump();
    return job;
  }
  pump(){
    while(this.loading<2&&this.pending.length){
      const job=this.pending.shift();
      if(job.controller.signal.aborted){job.reject(new DOMException('Stopped','AbortError'));continue;}
      this.loading++;
      this.load(job).then(job.resolve,job.reject).finally(()=>{this.loading--;this.pump();});
    }
  }
  async load(job){
    const {text,character,token,controller}=job;
    const timeout=setTimeout(()=>controller.abort(),130000);
    try{
      const response=await fetch('/api/speech-stream',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Learning-Token':token},body:JSON.stringify({text,character,streaming:true})});
      if(!response.ok)throw Error('声音服务暂时忙碌');
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=false,size=0;
      const chunks=[];
      const packet=line=>{
        if(!line.trim())return;
        const item=JSON.parse(line);
        if(item.type==='error')throw Error(item.error);
        if(item.type==='done'){complete=true;return;}
        if(item.type!=='audio')return;
        const bytes=Uint8Array.from(atob(item.data),c=>c.charCodeAt(0));size+=bytes.length;
        if(!bytes.length||bytes.length%2||item.sample_rate!==24000||size>8*1024*1024)throw Error('声音格式错误');
        chunks.push(bytes);
        const samples=new Float32Array(bytes.length/2),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(i*2,true)/32768;
        job.chunks.push(samples);job.notify?.();
      };
      while(true){
        const part=await reader.read();buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});
        const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(packet);
        if(part.done){packet(buffer);break;}
      }
      if(!complete||!size)throw Error('声音未完整生成');
      job.complete=true;job.notify?.();
      const samples=new Float32Array(size/2);let offset=0;
      for(const bytes of chunks){
        const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        for(let i=0;i<bytes.length/2;i++)samples[offset++]=view.getInt16(i*2,true)/32768;
      }
      return samples;
    }catch(error){controller.abort();throw error;}
    finally{clearTimeout(timeout);}
  }
  async play(text,character,token,onStart,prepared=null){
    this.stop();this.unlock();
    if(!this.context||this.context.state!=='running')throw Error('请点击页面开启声音');
    const ctx=this.context;
    prepared=prepared||this.prepare(text,character,token);
    const op={controller:prepared.controller,nodes:new Set()};
    const drained=new Promise((resolve,reject)=>{op.resolve=resolve;op.reject=reject;});
    drained.catch(()=>{});
    this.operation=op;
    try{
      let consumed=0,nextAt=ctx.currentTime,started=false;
      const schedule=()=>{
        if(this.operation!==op)return;
        const chunks=prepared.chunks.slice(consumed),length=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
        if(!started&&!prepared.complete&&length<7200)return;
        if(length){
          const audio=ctx.createBuffer(1,length,24000),samples=audio.getChannelData(0);let offset=0;
          for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}
          consumed=prepared.chunks.length;
          const node=ctx.createBufferSource();node.buffer=audio;node.connect(ctx.destination);op.nodes.add(node);
          node.onended=()=>{op.nodes.delete(node);node.disconnect();if(prepared.complete&&consumed===prepared.chunks.length&&!op.nodes.size)op.resolve();};
          const at=Math.max(nextAt,ctx.currentTime+.02);nextAt=at+audio.duration;node.start(at);
          if(!started){started=true;onStart();}
        }
        if(prepared.complete&&started&&!op.nodes.size)op.resolve();
      };
      prepared.notify=schedule;schedule();
      await Promise.race([prepared.audio,drained]);
      if(this.operation!==op)throw new DOMException('Stopped','AbortError');
      await prepared.audio;await drained;
      if(this.operation===op)this.operation=null;
    }catch(error){if(this.operation===op)this.stop();throw error;}finally{prepared.notify=null;}
  }
}
window.CompanionSpeechPlayer=CompanionSpeechPlayer;
