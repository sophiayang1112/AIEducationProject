'use strict';
(() => {
  const get=id=>document.getElementById(id);
  const cast={dark:{name:'星星伙伴',bond:'同学的好朋友',line:'同学，先和我说一句 Hello！我会一直给你加油。'},light:{name:'阳光伙伴',bond:'探索伙伴的好朋友',line:'探索伙伴派我来挑战！你能说 I like apples 吗？'},challenger:{name:'探索伙伴',bond:'同学的竞争对手',line:'同学，这次我一定要赢你！Ready?'},chinese:{name:'语文老师',bond:'语文老师 · 作业辅导',line:'同学，把语文作业给我看看，我们先做当前这一题。'},english:{name:'英语老师',bond:'英语老师 · 作业辅导',line:'同学，把英语作业给我看看，我们一起完成。'},math:{name:'数学老师',bond:'数学老师 · 作业辅导',line:'同学，把数学作业给我看看，我们先检查这一题。'}};
  const portrait=get('avatarPortrait');let state='idle',blinkTimer,resetTimer;
  get('adventureMode').closest('label').hidden=true;
  function ensemble(){
    const world=get('avatarWorld'),key=world.dataset.character,group=get('adventureMode').checked;
    world.classList.toggle('group-scene',group);
    get('groupScene').setAttribute('aria-pressed',String(group));
    const teacher=['chinese','english','math'].includes(key);
    get('interactionTitle').textContent=group?'伙伴同场':cast[key].name+(teacher?' · 作业答疑':' · 单独聊天');
    get('chatInput').placeholder=group?'和伙伴们说句话…':'想对'+cast[key].name+'说什么？';
    document.querySelector('[for="chatInput"]').textContent=group?'给伙伴们的消息':'给'+cast[key].name+'的消息';
    document.querySelectorAll('[data-character-choice]').forEach(b=>b.setAttribute('aria-pressed',String(!group&&b.dataset.characterChoice===key)));
    const prompts=!group&&teacher?[['开始作业',cast[key].name+'，陪我完成今天的作业。'],['检查这题',cast[key].name+'，请检查这一题，先提示错误点，让我自己改。'],['写好了','我今天的作业写好了，请帮我检查。']]:[['打个招呼','Hello! 我们接着聊吧。'],['聊聊今天','我想和你聊聊今天发生的事情。'],['练句英语','陪我练一句简单英文，给我中文提示。']];
    document.querySelectorAll('[data-prompt]').forEach((button,index)=>{button.textContent=prompts[index][0];button.dataset.prompt=prompts[index][1];});
    for(const figure of document.querySelectorAll('[data-cast]')){
      const actor=figure.dataset.cast;
      figure.hidden=!['dark','challenger','light'].includes(actor)&&actor!==key;
      figure.classList.toggle('active-speaker',actor===key);
    }
  }
  window.addEventListener('professor-speaker',()=>queueMicrotask(ensemble));
  window.addEventListener('professor-character-change',ensemble);
  get('adventureMode').addEventListener('change',ensemble);
  ensemble();
  const atlas=new Image();atlas.onload=()=>portrait.classList.remove('asset-missing');atlas.onerror=()=>portrait.classList.add('asset-missing');atlas.src='learning-assets/character-atlas.png';
  function blink(){clearTimeout(blinkTimer);blinkTimer=setTimeout(()=>{if(!get('chatPanel').hidden&&(['idle','listening'].includes(state)||(state==='thinking'&&get('avatarWorld').dataset.character==='challenger'))&&!matchMedia('(prefers-reduced-motion: reduce)').matches){portrait.classList.add('blink');setTimeout(()=>portrait.classList.remove('blink'),170);}blink();},2800+Math.random()*2700);}
  function changeState(next,text){state=next;get('avatarWorld').dataset.state=state;portrait.removeAttribute('data-extra');portrait.classList.remove('speaking','cheering','listening','blink');if(['speaking','cheering','listening'].includes(state))portrait.classList.add(state);if(text){get('avatarCaption').textContent=text;get('avatarCaption').title=text;}clearTimeout(resetTimer);if(state==='cheering')resetTimer=setTimeout(()=>changeState('idle'),2200);}
  window.addEventListener('professor-state',event=>changeState(event.detail.state,event.detail.text));
  function select(key,manual=false){const character=cast[key];if(!character)return;get('avatarWorld').dataset.character=key;get('characterName').textContent=character.name;get('characterBond').textContent=character.bond;portrait.setAttribute('aria-label',character.name+'的动画头像');if(manual){get('adventureMode').checked=false;changeState('idle',character.line);window.dispatchEvent(new CustomEvent('professor-character-change',{detail:{character:key}}));}ensemble();}
  get('groupScene').addEventListener('click',()=>{get('adventureMode').checked=true;select('dark');changeState('idle','同学，我们三个都在，接着聊吧。');window.dispatchEvent(new CustomEvent('professor-character-change',{detail:{character:'dark'}}));});
  document.querySelectorAll('[data-character-choice]').forEach(button=>button.addEventListener('click',()=>select(button.dataset.characterChoice,true)));
  document.querySelectorAll('[data-cast]').forEach(figure=>{
    const key=figure.dataset.cast;
    figure.setAttribute('role','button');figure.tabIndex=0;
    figure.setAttribute('aria-label','和'+cast[key].name+'一对一互动');figure.title='和'+cast[key].name+'一对一互动';
    figure.addEventListener('click',()=>{if(figure.getAttribute('aria-disabled')!=='true')select(key,true);});
    figure.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();figure.click();}});
  });
  window.addEventListener('professor-speaker',event=>select(event.detail.character));
  get('toggleChat').addEventListener('click',()=>{get('chatDrawer').hidden=!get('chatDrawer').hidden;get('toggleChat').setAttribute('aria-expanded',String(!get('chatDrawer').hidden));if(!get('chatDrawer').hidden)get('chatInput').focus();});
  get('closeChatDrawer').addEventListener('click',()=>{get('chatDrawer').hidden=true;get('toggleChat').setAttribute('aria-expanded','false');get('toggleChat').focus();});
  blink();
  setInterval(()=>{if(get('chatPanel').hidden||state!=='idle'||get('avatarWorld').dataset.character!=='challenger')return;const moods=['smug','wink','ready','happy','surprised','excited'];portrait.dataset.extra=moods[Math.floor(Math.random()*moods.length)];setTimeout(()=>portrait.removeAttribute('data-extra'),1800);},8000);
})();
