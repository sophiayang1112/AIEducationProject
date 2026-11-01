const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {performance}=require('node:perf_hooks');
class FakeContext{
  constructor(){this.state='running';this.epoch=performance.now();this.destination={};this.nodes=[];}
  get currentTime(){return (performance.now()-this.epoch)/1000;}
  resume(){return Promise.resolve();}
  createBuffer(channels,length,rate){const data=new Float32Array(length);return {duration:length/rate,getChannelData:()=>data};}
  createBufferSource(){
    const context=this;
    const node={connect(){},disconnect(){},start(at){this.timer=setTimeout(()=>this.onended?.(),Math.max(0,(at-context.currentTime+this.buffer.duration)*1000));},stop(){clearTimeout(this.timer);this.stopped=true;}};
    this.nodes.push(node);return node;
  }
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let channel;
const window={AudioContext:FakeContext};
const fakeFetch=async(url,options)=>new Response(new ReadableStream({start(controller){channel=controller;options.signal.addEventListener('abort',()=>{try{controller.error(new DOMException('Stopped','AbortError'));}catch{}});}}));
vm.runInNewContext(fs.readFileSync('learning-assets/speech-player.js','utf8'),{window,fetch:fakeFetch,AbortController,DOMException,Uint8Array,DataView,TextDecoder,atob,Error,Set,Promise,setTimeout,clearTimeout});
const packet=data=>channel.enqueue(new TextEncoder().encode(JSON.stringify(data)+'\n'));
(async()=>{
  const player=new window.CompanionSpeechPlayer();let started=false,ended=false;
  const play=player.play('Hello','dark','test',()=>started=true).then(()=>ended=true);
  await pause(0);
  const first=Buffer.alloc(4800),second=Buffer.alloc(4800);
  for(let i=0;i<4800;i+=2){first.writeInt16LE(1024,i);second.writeInt16LE(-1024,i);}
  packet({type:'audio',sample_rate:24000,data:first.toString('base64')});
  await pause(180);assert.equal(started,false);assert.equal(ended,false);
  packet({type:'audio',sample_rate:24000,data:second.toString('base64')});
  packet({type:'done'});channel.close();await play;assert.equal(ended,true);
  assert.equal(player.context.nodes.length,1);
  const audio=player.context.nodes[0].buffer;
  assert.equal(audio.duration,.2);
  assert.equal(audio.getChannelData(0)[2399],1024/32768);
  assert.equal(audio.getChannelData(0)[2400],-1024/32768);
  const stopped=player.play('Next','challenger','test',()=>{});
  const rejection=assert.rejects(stopped,{name:'AbortError'});
  await pause(0);player.stop();await rejection;
  assert.equal(player.operation,null);
  let truncatedStarted=false;
  const truncated=player.play('Bad','dark','test',()=>truncatedStarted=true);
  const failed=assert.rejects(truncated,/声音未完整生成/);
  await pause(0);packet({type:'audio',sample_rate:24000,data:first.toString('base64')});channel.close();await failed;
  assert.equal(truncatedStarted,false);
  const active=player.play('Stop','light','test',()=>{});
  const cancelled=assert.rejects(active,{name:'AbortError'});
  await pause(0);packet({type:'audio',sample_rate:24000,data:first.toString('base64')});packet({type:'done'});channel.close();
  await pause(10);player.stop();await cancelled;
  assert.equal(player.context.nodes.at(-1).stopped,true);
  let liveStarted=false;
  const live=player.play('Streaming','challenger','test',()=>liveStarted=true);
  await pause(0);packet({type:'audio',sample_rate:24000,data:Buffer.alloc(19200).toString('base64')});
  await pause(30);assert.equal(liveStarted,true,'must start before done');
  packet({type:'audio',sample_rate:24000,data:Buffer.alloc(4800).toString('base64')});packet({type:'done'});channel.close();await live;
  console.log('PASS: delayed packets form one gap-free utterance; truncated audio is not played; buffering and playback both cancel.');
})().catch(error=>{console.error(error);process.exitCode=1;});
