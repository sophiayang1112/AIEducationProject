'use strict';
(() => {
  const el=id=>document.getElementById(id);
  let token='',busy=false,oldest=null,historyLoaded=false,retry=null,recognition=null,recording=false,voiceReady=false,voiceAudio=null,voiceUrl='',readVersion=0,live=false,cameraStream=null,listenTimer=null,observeTimer=null,lastActivity=Date.now(),cameraVersion=0;
  const avatar=(state,text)=>window.dispatchEvent(new CustomEvent('professor-state',{detail:{state,text}}));
  let lastVoiceText='',cheerAfterVoice=false,voiceMap={},welcomeRestored=false;
  const speechPlayer=new window.CompanionSpeechPlayer();
  let narration=null;
  let realtimeAvailable=false,realtimeMic=null,turnVersion=0,activeTurn=null,speechEndedAt=0,reconnectAttempts=0;
  const latency=[];
  let reconnectWindow=0;
  window.myprofessorLatency=latency;
  function interruptTurn(){
    turnVersion++;
    if(activeTurn){activeTurn.controller.abort();fetch('/api/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Learning-Token':token},body:JSON.stringify({request_id:activeTurn.id})}).catch(()=>{});activeTurn=null;}
    stopReading();failedClips=[];retry=null;el('retryVoice').hidden=true;el('retryChat').hidden=true;setBusy(false);
  }
  function onRealtime(event){
    if(!live)return;
    if(event.type==='speech_start'){interruptTurn();lastActivity=Date.now();setStatus('正在听你说话…');}
    if(event.type==='speech_end')speechEndedAt=performance.now();
    if(event.type==='partial'){el('chatInput').value=event.text;lastActivity=Date.now();}
    if(event.type==='final'&&event.text.trim()){interruptTurn();send(event.text.trim());}
    if(event.type==='error'){
      if(Date.now()-reconnectWindow>60000){reconnectWindow=Date.now();reconnectAttempts=0;}
      if(event.code!=='microphone_ended'&&reconnectAttempts++<3){reconnectMicrophone();return;}
      endLive();stopReading();setStatus(event.code==='microphone_ended'?event.error:'收音连接连续失败，请检查网络后重新开始互动。');
    }
  }
  async function reconnectMicrophone(){
    realtimeMic?.stop();interruptTurn();speechEndedAt=0;
    const mic=new window.RealtimeMicrophone(token,onRealtime);realtimeMic=mic;
    setStatus('收音连接中断，正在重新连接…');
    try{await mic.start();if(live&&realtimeMic===mic)setStatus('已重新连接，请把刚才那句话再说一次。');else mic.stop();}
    catch{if(live&&realtimeMic===mic){endLive();setStatus('收音重连失败，请重新开始互动。');}}
  }
  let failedClips=[];
  let cameraReminder=null;
  let cameraProblemReported=false;
  let cameraObservationPaused=false;
  const cameraState=()=>cameraStream?.getVideoTracks().some(track=>track.readyState==='live'&&!track.muted)?'on':'off';
  function remindCamera(){
    const role=el('avatarWorld').dataset.character;
    if(cameraProblemReported||cameraObservationPaused||!['chinese','english','math'].includes(role)||el('adventureMode').checked||el('chatPanel').hidden)return;
    cameraReminder=role;
    flushCameraReminder();
  }
  function flushCameraReminder(){
    if(busy||!cameraReminder)return;
    const role=cameraReminder;cameraReminder=null;
    if(cameraProblemReported||cameraObservationPaused||role!==el('avatarWorld').dataset.character||el('adventureMode').checked||el('chatPanel').hidden||cameraState()==='on')return;
    if(recording)recognition.stop();
    read('同学，摄像头关着，我现在看不到作业。请打开摄像头，把题目放近一点；也可以把题目读给我听。',false,role);
  }
  document.addEventListener('pointerdown',()=>speechPlayer.unlock());
  const setStatus=text=>{el('chatStatus').textContent=text;if(text.startsWith('正在听'))avatar('listening');else if(text==='正在回答…')avatar('thinking');};
  const scroll=()=>{el('chatMessages').scrollTop=el('chatMessages').scrollHeight;};
  function bubble(text,role){const div=document.createElement('div');div.className='chat-bubble '+role;div.textContent=text;el('chatMessages').append(div);return div;}
  function setBusy(value){busy=value;el('groupScene').disabled=value;el('adventureMode').disabled=value;el('chatSend').disabled=value||!token;el('chatInput').disabled=value;el('microphone').disabled=value||!recognition||!token;el('startLive').disabled=(!recognition&&!realtimeAvailable)||!token;el('captureFrame').disabled=value||!token;document.querySelectorAll('[data-prompt]').forEach(b=>b.disabled=value||!token);document.querySelectorAll('[data-character-choice]').forEach(b=>b.disabled=value);document.querySelectorAll('[data-cast]').forEach(figure=>figure.setAttribute('aria-disabled',String(value)));}
  async function health(){const response=await fetch('/api/health',{cache:'no-store'});if(!response.ok)throw Error('服务连接失败');const data=await response.json();token=data.token;voiceMap=data.voices||{dark:!!data.voice_ready};voiceReady=!!voiceMap[el('avatarWorld').dataset.character];el('voiceLabel').textContent=voiceReady?'角色专属自然音色 · AI 合成，非真人通话':'自然声音尚未配置';el('chatConnection').textContent=data.ready?'AI 学习伙伴在线':'等待家长配置 Qwen';if(!data.ready)token='';el('memoryCount').textContent=`本机已保存 ${data.turns} 轮对话${data.memory_pending?' · 正在本地整理':''}`;if(!welcomeRestored&&data.turns>0){el('avatarCaption').textContent=data.resume_phrase?`同学，欢迎回来！上次练过「${data.resume_phrase}」，今天我们接着来。`:'同学，欢迎回来！我们接着上次的冒险，一点点来。';welcomeRestored=true;}setBusy(busy);return data;}
  async function loadHistory(older=false){const response=await fetch('/api/history'+(older&&oldest?'?before='+oldest:''),{headers:{'X-Learning-Token':token}});if(!response.ok)throw Error('聊天记录暂时无法读取');const data=await response.json();const box=el('chatMessages'),height=box.scrollHeight;const fragment=document.createDocumentFragment();for(const turn of data.turns){for(const [text,role] of [[turn.user,'child'],[turn.assistant,'buddy']]){const div=document.createElement('div');div.className='chat-bubble '+role;div.textContent=text;fragment.append(div);}}if(data.turns.length){if(older)box.prepend(fragment);else box.replaceChildren(fragment);oldest=data.turns[0].id;}el('olderMessages').hidden=!data.has_more;if(older)box.scrollTop=box.scrollHeight-height;else scroll();historyLoaded=true;}
  async function read(text,force=false,character=el('avatarWorld').dataset.character,queued=false,prepared=null,timing=null){
    stopReading(!queued);lastVoiceText=text;el('retryVoice').hidden=true;
    if(recording&&!realtimeMic){el('chatInput').value='';recognition.stop();recording=false;}
    if(!sound||(!force&&!el('autoRead').checked)){resumeListening();return;}
    const version=readVersion;
    if(!voiceReady){setStatus('自然声音尚未连接，请稍后重试。');el('retryVoice').hidden=false;endLive();return;}
    el('stopReading').hidden=false;avatar('thinking');setStatus('正在准备自然声音…');
    try{
      await speechPlayer.play(text,character,token,()=>{if(version===readVersion){if(timing&&!timing.firstAudio)timing.firstAudio=performance.now();window.dispatchEvent(new CustomEvent('professor-speaker',{detail:{character}}));avatar('speaking',text);setStatus('伙伴正在说话…');}},prepared);
      if(version!==readVersion)return;
      stopReading(false);avatar(cheerAfterVoice?'cheering':'idle');cheerAfterVoice=false;lastActivity=Date.now();resumeListening();
    }catch{if(version!==readVersion)return;stopReading(!queued);avatar('idle');setStatus('这句声音没播出，可以重试声音。');el('retryVoice').hidden=false;if(!queued)resumeListening();return false;}
  }
  window.professorSpeak=text=>read(text,true);
  function spokenLine(line,batch){
    let visible='';
    for(const part of line.split(/(<\/?(?:think|analysis|reasoning)\b[^>]*>)/i)){
      if(/^<(?:think|analysis|reasoning)\b[^>]*>$/i.test(part)){batch.reasoningDepth++;continue;}
      if(/^<\/(?:think|analysis|reasoning)\s*>$/i.test(part)){batch.reasoningDepth=Math.max(0,batch.reasoningDepth-1);continue;}
      if(!batch.reasoningDepth)visible+=part;
    }
    return visible.trim();
  }
  function dialogueOnly(text,character){
    if(/^(?:思考(?:过程)?|分析(?:过程)?|内心独白|观察|场景|旁白|动作|thinking|analysis|observation|stage direction)\s*[:：]/i.test(text))return '';
    if(character==='english'){
      text=text.replace(/\*+/g,'').replace(/\/[^/\n]*[\u0250-\u02ff][^/\n]*\//g,'');
      const phoneticHint=/谐音|音译|中文发音|中文读法|[音读发][^。！？\n]{0,20}[“「][\u4e00-\u9fff]|试试说[^。！？\n]*[“「][\u4e00-\u9fff]|像在叫|像中文/.test(text);
      if(phoneticHint){
        const word=text.match(/^\s*([A-Za-z]+)\b/);
        return word?word[1]+'.':'';
      }
    }
    return text.replace(/[（(][^（）()\n]*(?:思考|心想|观察|看到|看着|看见|微笑|点头|摇头|叉腰|眨眼|旁白|smiles?|nods?|thinking|looks? at)[^（）()\n]*[）)]/gi,'').trim();
  }
  function startNarration(defaultCharacter,group=false,timing=null){
    const batch={chain:Promise.resolve(),buffer:'',started:false,prepared:[],reasoningDepth:0,failed:[],allowed:new Set(group?['dark','challenger','light']:[defaultCharacter])};narration=batch;failedClips=[];
    const enqueue=line=>{
      line=spokenLine(line,batch);if(!line)return;
      if(/^\[(dark|light|challenger|chinese|english|math)\]\s*$/.test(line))return;
      const match=line.trim().match(/^\[(dark|light|challenger|chinese|english|math)\]\s*(.+)$/);
      if(group&&(!match||!batch.allowed.has(match[1])))return;
      const character=group&&match?match[1]:defaultCharacter;
      const words=dialogueOnly((match?match[2]:line).trim(),character);if(!words)return;
      if(narration!==batch)return;
      const prepared=sound&&el('autoRead').checked&&voiceMap[character]?speechPlayer.prepare(words,character,token):null;
      if(prepared)batch.prepared.push(prepared);
      batch.chain=batch.chain.then(async()=>{
        if(narration!==batch||el('chatPanel').hidden)return;
        batch.started=true;
        window.dispatchEvent(new CustomEvent('professor-speaker',{detail:{character}}));
        avatar('thinking',words);
        if(await read(words,false,character,true,prepared,timing)===false)batch.failed.push({text:words,character});
      });
    };
    batch.feed=(delta,final=false)=>{
      if(delta&&activeTurn&&!activeTurn.timing.firstText)activeTurn.timing.firstText=performance.now();
      batch.buffer+=delta;
      const lines=batch.buffer.split('\n');batch.buffer=lines.pop();lines.forEach(enqueue);
      if(!/[<(（]/.test(batch.buffer)){
        let end;
        while((end=batch.buffer.search(/[。！？!?]/))>=0){
          const prefix=batch.buffer.match(/^\s*\[(dark|light|challenger|chinese|english|math)\]\s*/)?.[0]||'';
          if(group&&!prefix)break;
          enqueue(batch.buffer.slice(0,end+1));batch.buffer=prefix+batch.buffer.slice(end+1).trimStart();
        }
      }
      if(final){enqueue(batch.buffer);batch.buffer='';batch.chain.then(()=>{if(narration===batch){narration=null;failedClips=batch.failed;el('retryVoice').hidden=!failedClips.length;setStatus(failedClips.length?'部分声音未播出，可以重试声音。':(live?'轮到你啦，我在听。':'伙伴在等你接话。'));resumeListening();}});}
    };
    return batch;
  }
  async function send(message,isRetry=false,imageData=null,kind='child'){if(busy||!token||!message.trim())return;const version=++turnVersion,controller=new AbortController();const timing={sent:performance.now(),speechEnd:speechEndedAt||null};speechEndedAt=0;const teacher=['chinese','english','math'].includes(el('avatarWorld').dataset.character)&&!el('adventureMode').checked;
    if(kind==='child'&&teacher&&/不(?:愿意|想|要|肯)?(?:放|给你看|给你拍|开摄像头)|别(?:看|拍)|只(?:用语音|说|读题)/.test(message)){cameraObservationPaused=true;cameraReminder=null;}
    if(kind==='child'&&/现在(?:给你看|放好了)|帮我看这|我愿意展示/.test(message))cameraObservationPaused=false;
    if(!isRetry&&live&&cameraStream&&!cameraObservationPaused&&el('autoObserve').checked&&!imageData&&(teacher||/帮我看|看看我|你看|看这|这题|作业|镜头|look at|can you see/i.test(message)))imageData=currentFrame();lastActivity=Date.now();setBusy(true);if(recording)recognition.stop();stopReading();el('retryChat').hidden=true;let attempt;
    if(kind==='child'&&/(?:摄像头|镜头|camera).{0,20}(?:坏|故障|没权限|没有权限|打不开|不能用|broken|not working)/i.test(message)){cameraProblemReported=true;cameraReminder=null;}
    if(isRetry){attempt=retry;attempt.reply.classList.remove('error');attempt.reply.textContent='';}else{bubble(message+(imageData?'\n[发送了当前画面]':''),'child');attempt={message,image:imageData,camera_state:cameraState(),live,kind,adventure:el('adventureMode').checked,character:el('adventureMode').checked?'dark':el('avatarWorld').dataset.character,request_id:crypto.randomUUID(),reply:bubble('','buddy')};retry=attempt;}
    activeTurn={id:attempt.request_id,controller,timing};latency.push(timing);if(latency.length>100)latency.shift();
    el('chatInput').value='';attempt.reply.textContent='正在回复…';setStatus('正在回答…');scroll();let text='',done=false;const batch=startNarration(attempt.character,attempt.adventure,timing);
    try{const response=await fetch('/api/chat',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-Learning-Token':token},body:JSON.stringify({message:attempt.message,image:attempt.image,camera_state:attempt.camera_state,character:attempt.character,kind:attempt.kind,adventure:attempt.adventure,request_id:attempt.request_id})});
      if(!response.ok){let data={};try{data=await response.json();}catch{}throw Error(data.error||'连接中断，请重试。');}
      if(response.headers.get('content-type').includes('application/json')){const data=await response.json();text=data.reply;done=!!data.saved;attempt.reply.textContent=text;batch.feed(text);cheerAfterVoice=['victory','celebration'].includes(data.stage);}
      else{const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';const handle=line=>{if(!line.trim())return;const item=JSON.parse(line);if(item.type==='start'&&item.character){window.dispatchEvent(new CustomEvent('professor-speaker',{detail:item}));}else if(item.type==='delta'){text+=item.text;attempt.reply.textContent=text;batch.feed(item.text);if(!batch.started)el('avatarCaption').textContent=text;scroll();}else if(item.type==='done'){done=item.saved;cheerAfterVoice=['victory','celebration'].includes(item.stage);if(!batch.started)setStatus(item.backup?'对话已保存，已自动备份。':'对话已保存，但备份未完成，请家长检查磁盘。');}else if(item.type==='error')throw Error(item.error);};while(true){const part=await reader.read();buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});const lines=buffer.split('\n');buffer=lines.pop();lines.forEach(handle);if(part.done){if(buffer.trim())handle(buffer);break;}}}
      if(version!==turnVersion)return;if(!done)throw Error('回复未完成，请重试。');retry=null;attempt.image=null;attempt.reply.textContent=text;batch.feed('',true);health().catch(()=>{});
    }catch(error){if(version!==turnVersion)return;stopReading();attempt.reply.classList.add('error');attempt.reply.textContent=(text?text+'\n\n':'')+'这次回复尚未确认完成。';setStatus(error.message);el('retryChat').hidden=false;resumeListening();}
    finally{if(version===turnVersion){activeTurn=null;setBusy(false);flushCameraReminder();if(!el('chatDrawer').hidden)el('chatInput').focus({preventScroll:true});scroll();}}
  }
  function showForSubject(){document.body.classList.remove('interaction-open');el('chatPanel').hidden=true;el('practice').hidden=false;el('openInteraction').setAttribute('aria-expanded','false');endLive();stopReading();stopCamera();}
  el('openInteraction').addEventListener('click',()=>{document.body.classList.add('interaction-open');el('chatPanel').hidden=false;el('practice').hidden=true;el('chatDrawer').hidden=true;el('toggleChat').setAttribute('aria-expanded','false');el('openInteraction').setAttribute('aria-expanded','true');if(!historyLoaded&&token)loadHistory().catch(e=>setStatus(e.message));el('exitInteraction').focus();});
  el('exitInteraction').addEventListener('click',()=>{showForSubject();el('openInteraction').focus();});
  window.addEventListener('professor-character-change',event=>{endLive();stopReading();lastVoiceText='';retry=null;el('retryVoice').hidden=true;el('retryChat').hidden=true;voiceReady=!!voiceMap[event.detail.character];setStatus(el('adventureMode').checked?'三位伙伴都在，接着聊吧。':'一对一互动已就绪。');});
  window.addEventListener('professor-speaker',event=>{voiceReady=!!voiceMap[event.detail.character];if(narration&&Array.isArray(event.detail.allowed_speakers))narration.allowed=new Set(event.detail.allowed_speakers);});
  document.querySelectorAll('[data-subject]').forEach(button=>button.addEventListener('click',showForSubject));
  el('chatForm').addEventListener('submit',event=>{event.preventDefault();send(el('chatInput').value.trim());});
  el('chatInput').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();el('chatForm').requestSubmit();}});
  document.querySelectorAll('[data-prompt]').forEach(button=>button.addEventListener('click',()=>send(button.dataset.prompt)));
  el('retryChat').addEventListener('click',()=>{if(retry)send(retry.message,true);});
  el('retryVoice').addEventListener('click',async()=>{
    if(!failedClips.length){if(lastVoiceText)read(lastVoiceText,true);return;}
    const clips=failedClips;failedClips=[];
    for(const clip of clips){if(await read(clip.text,true,clip.character)===false)failedClips.push(clip);}
    el('retryVoice').hidden=!failedClips.length;
  });
  el('olderMessages').addEventListener('click',async()=>{el('olderMessages').disabled=true;try{await loadHistory(true);}catch(e){setStatus(e.message);}finally{el('olderMessages').disabled=false;}});
  el('openMemory').addEventListener('click',async()=>{el('memoryDialog').showModal();try{await health();const response=await fetch('/api/memory',{headers:{'X-Learning-Token':token}});if(!response.ok)throw Error('本地记忆读取失败');const data=await response.json();el('memoryContent').textContent='家长确认档案（仅存本机）\n'+JSON.stringify(data.profile,null,2)+'\n\n本地学习记录\n'+(data.notes||'还没有学习记录。');}catch(e){el('memoryStatus').textContent=e.message;}});el('closeMemory').addEventListener('click',()=>el('memoryDialog').close());
  el('exportMemory').addEventListener('click',async()=>{try{const response=await fetch('/api/export',{headers:{'X-Learning-Token':token}});if(!response.ok)throw Error('导出失败，请稍后重试。');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='myprofessor-learning-memory-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);el('memoryStatus').textContent='已生成完整记忆导出文件，请保存在家长管理的位置。';}catch(e){el('memoryStatus').textContent=e.message;}});
  const stopReading=(cancelQueue=true)=>{readVersion++;if(cancelQueue){if(narration)for(const request of narration.prepared)request.controller.abort();narration=null;}speechPlayer.stop();el('stopReading').hidden=true;avatar('idle');};el('stopReading').addEventListener('click',()=>{stopReading();resumeListening();});el('autoRead').addEventListener('change',()=>{if(!el('autoRead').checked){stopReading();resumeListening();}});el('sound').addEventListener('click',()=>{if(!sound){stopReading();resumeListening();}});
  function resumeListening(){clearTimeout(listenTimer);if(realtimeMic)return;if(live)listenTimer=setTimeout(()=>{if(live&&!busy&&!recording&&!narration&&el('stopReading').hidden)beginListening();},150);}
  function endLive(){cameraReminder=null;live=false;realtimeMic?.stop();realtimeMic=null;interruptTurn();clearTimeout(listenTimer);clearInterval(observeTimer);el('startLive').textContent='开始视频互动';el('chatPanel').classList.remove('live-on');if(recording&&recognition)recognition.stop();stopCamera();}
  function beginListening(){if(!recognition||busy||recording)return;stopReading();recognition.lang=el('voiceLanguage').value;try{el('chatInput').value='';recognition.start();recording=true;el('microphone').classList.add('recording');el('microphone').setAttribute('aria-label','结束语音输入');setStatus(live?'正在听你说话…说完会自动发送。':'正在听…语音识别由浏览器提供。');}catch{endLive();setStatus('麦克风启动失败，请继续打字。');}}
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  el('microphone').addEventListener('click',event=>{if(realtimeMic){event.stopImmediatePropagation();interruptTurn();setStatus('正在听你说话…');}},true);
  if(Recognition){recognition=new Recognition();recognition.interimResults=true;recognition.continuous=false;recognition.onresult=event=>{lastActivity=Date.now();el('chatInput').value=Array.from(event.results).map(r=>r[0].transcript).join('');};recognition.onend=()=>{recording=false;el('microphone').classList.remove('recording');el('microphone').setAttribute('aria-label','开始语音输入');if(live&&!busy){const text=el('chatInput').value.trim();if(text)send(text);else resumeListening();}};recognition.onerror=event=>{if(event.error==='no-speech'&&live)return;endLive();setStatus(event.error==='not-allowed'?'未获得麦克风权限，可以继续打字。':'语音识别暂不可用，可以继续打字。');};el('microphone').addEventListener('click',()=>{if(recording){recognition.stop();return;}beginListening();});}else{el('microphone').disabled=true;el('microphone').title='此浏览器不支持语音输入，请使用打字';el('startLive').title='此浏览器不支持语音识别，可继续打字或展示照片';}
  function lessonPrompt(observe=false){
    const role=el('avatarWorld').dataset.character;
    const teacher=['chinese','english','math'].includes(role)&&!el('adventureMode').checked;
    const lesson=el('adventureMode').checked?'星星伙伴、探索伙伴、阳光伙伴都在，接着和同学自然闲聊，最适合接话的伙伴说一句就好，不强制学习或挑战。':({chinese:'请语文老师监督和辅导我的语文作业，先确认当前任务，指导一步，等我完成。',english:'请英语老师监督和辅导我的英语作业，先确认当前任务，指导一步，等我完成。',math:'请数学老师监督和辅导我的数学作业，先确认当前任务，指导一步，等我完成。',challenger:'探索伙伴，接着和同学自然闲聊。',dark:'星星伙伴，像好朋友一样接着和同学聊天。',light:'阳光伙伴，接着和同学轻松聊天。'}[role]);
    return (observe?'画面仅供理解当前话题，请直接自然接话，不汇报场景、不念思考过程或动作旁白。'+(teacher?'只有当前题目看不清时才请我调整画面。':'不要扮演老师或主动检查学习任务。'):'我们继续吧，不用重复自我介绍。')+lesson;
  }
  el('startLive').addEventListener('click',async()=>{
    if(live){endLive();stopReading();setStatus('互动已结束，对话记忆已保留。');return;}
    live=true;reconnectAttempts=0;el('startLive').textContent='结束互动';el('chatPanel').classList.add('live-on');lastActivity=Date.now();
    if(realtimeAvailable){
      const mic=new window.RealtimeMicrophone(token,onRealtime);realtimeMic=mic;
      setStatus('正在连接实时收音…');
      try{await mic.start();if(!live||realtimeMic!==mic){mic.stop();return;}}
      catch{if(!live)return;endLive();setStatus('实时收音暂不可用，请检查权限后重新开始；仍可手动语音或打字。');return;}
    }
    if(!cameraStream)await openCamera();if(!live)return;
    send(lessonPrompt(),false,null,'start');
    observeTimer=setInterval(()=>{
      if(el('adventureMode').checked||!['chinese','english','math'].includes(el('avatarWorld').dataset.character))return;
      if(!live||!cameraStream||cameraObservationPaused||cameraProblemReported||busy||narration||!el('autoObserve').checked||!el('stopReading').hidden||Date.now()-lastActivity<8000||el('chatInput').value.trim())return;
      const image=currentFrame();if(image)send(lessonPrompt(true),false,image,'observation');
    },8000);
  });
  function stopCamera(){cameraVersion++;if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}el('cameraPreview').srcObject=null;el('cameraPanel').hidden=true;el('cameraToggle').title='打开摄像头';el('cameraToggle').setAttribute('aria-label','打开摄像头');}
  async function openCamera(){const version=++cameraVersion;try{const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480}},audio:false});if(version!==cameraVersion){stream.getTracks().forEach(t=>t.stop());return;}cameraStream=stream;el('cameraPreview').srcObject=stream;el('cameraPanel').hidden=false;await el('cameraPreview').play();if(version!==cameraVersion)return;el('cameraToggle').title='关闭摄像头';el('cameraToggle').setAttribute('aria-label','关闭摄像头');setStatus(live?'视频互动已开启，画面将随对话与定时观察发送给 Qwen。':'摄像头本机预览中，尚未自动发送画面。');}catch{if(version===cameraVersion){stopCamera();setStatus('摄像头未开启，请检查权限，仍可继续对话。');}}}
  el('cameraToggle').addEventListener('click',()=>{if(cameraStream){stopCamera();remindCamera();return;}openCamera();});
  el('cameraPreview').addEventListener('loadedmetadata',()=>{
    cameraProblemReported=false;
    const stream=cameraStream;
    for(const track of stream?.getVideoTracks()||[])track.addEventListener('ended',()=>{
      if(cameraStream!==stream)return;
      stopCamera();remindCamera();
    },{once:true});
  });
  function currentFrame(){const video=el('cameraPreview');if(!video.videoWidth)return null;const canvas=document.createElement('canvas');canvas.width=Math.min(768,video.videoWidth);canvas.height=Math.round(video.videoHeight*canvas.width/video.videoWidth);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.75);}
  el('captureFrame').addEventListener('click',()=>{const image=currentFrame();if(image&&!busy){cameraObservationPaused=false;send(lessonPrompt(true),false,image,'observation');}});
  window.addEventListener('pagehide',()=>{endLive();stopCamera();stopReading();});
  if(location.protocol==='file:'){el('chatConnection').textContent='请通过本机学习服务打开';setStatus('启动「START_MYPROFESSOR.cmd」后，通过它打开的网页聊天。');setBusy(false);}else{health().then(data=>{realtimeAvailable=!!data.realtime_asr;setBusy(busy);return loadHistory();}).catch(()=>{el('chatConnection').textContent='学习服务暂未连接';setStatus('请启动 START_MYPROFESSOR.cmd，然后刷新页面。');});}
  showForSubject();
})();
