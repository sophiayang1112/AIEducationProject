const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL==='chromium'?undefined:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  try{
    for(const [name,width,height] of [['desktop',1280,800],['mobile',390,844]]){
      const page=await browser.newPage({viewport:{width,height}}),errors=[],voices=[],requests=[],spoken=[];
      await page.context().grantPermissions(['camera','microphone']);
      await page.addInitScript(()=>{window.SpeechRecognition=class{start(){}stop(){this.onend?.();}};});
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/health',async route=>{const response=await route.fetch();const data=require('./test-browser-fixture.cjs').ready(await response.json());data.realtime_asr=false;await route.fulfill({json:data});});
      await page.route('**/api/chat',route=>{const request=route.request().postDataJSON();requests.push(request);return route.fulfill({contentType:'application/x-ndjson',body:[
        {type:'start',character:request.adventure?'dark':request.character,allowed_speakers:request.adventure?['dark','challenger','light','english']:[request.character]},
        {type:'delta',text:'<thi'},
        {type:'delta',text:'nk>\n看到桌子上有水，需要思考。\n</think>\n'},
        {type:'delta',text:request.adventure?'[dark] 观察：桌子上有水。\n[dark] （微笑）同学，我们一起试试！\n[challenger] （叉腰）伙伴，这次我准备好了！\n[light] 我来出题。\n[english] 跟英语老师说 Hello，好吗？\n':`[${request.character}] 我们看看这一道作业题。\n`},
        {type:'done',saved:true,backup:true,stage:'practice'}
      ].map(x=>JSON.stringify(x)).join('\n')+'\n'});});
      await page.route('**/api/speech-stream',route=>{
        voices.push(route.request().postDataJSON().character);
        spoken.push(route.request().postDataJSON().text);
        return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'audio',sample_rate:24000,data:Buffer.alloc(9600).toString('base64')})+'\n'+JSON.stringify({type:'done'})+'\n'});
      });
      await page.goto((process.env.APP_URL || 'http://127.0.0.1:8765/'));
      await page.waitForFunction(()=>!document.getElementById('chatSend').disabled);
      await page.click('#openInteraction');
      assert.equal(await page.locator('#ensembleStage figure:visible').count(),3);
      await page.click('#toggleChat');await page.fill('#chatInput','Hello');await page.click('#chatSend');
      await page.waitForFunction(()=>document.getElementById('avatarWorld').dataset.character==='english'&&document.getElementById('stopReading').hidden);
      assert.deepEqual(voices,['dark','challenger','light','english']);
      assert.deepEqual(spoken,['同学，我们一起试试！','伙伴，这次我准备好了！','我来出题。','跟英语老师说 Hello，好吗？']);
      assert.equal(await page.locator('#ensembleStage figure:visible').count(),4);
      await page.click('#toggleChat');await page.screenshot({path:'learning-assets/ensemble-'+name+'.png'});
      assert.equal(requests[0].character,'dark');
      const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,figures:[...document.querySelectorAll('#ensembleStage figure:not([hidden])')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom};}),caption:document.getElementById('avatarCaption').getBoundingClientRect().top}));
      assert.equal(layout.overflow,false);
      for(const figure of layout.figures){assert.ok(figure.x>=0&&figure.right<=width);}
      assert.equal(await page.locator('#avatarCaption').isVisible(),false);
      await page.locator('[data-cast=challenger]').click();
      assert.equal(await page.locator('#adventureMode').isChecked(),false);
      assert.equal(await page.locator('#ensembleStage').isVisible(),false);
      assert.equal(await page.locator('[data-character-choice=challenger]').getAttribute('aria-pressed'),'true');
      assert.ok((await page.locator('#interactionTitle').textContent()).includes('单独聊天'));
      await page.click('#toggleChat');await page.fill('#chatInput','我们单独聊聊。');await page.click('#chatSend');
      await page.waitForFunction(()=>document.getElementById('chatStatus').textContent==='伙伴在等你接话。');
      assert.equal(requests.at(-1).character,'challenger');assert.equal(requests.at(-1).adventure,false);
      assert.deepEqual(voices,['dark','challenger','light','english','challenger']);
      await page.click('#toggleChat');await page.screenshot({path:'learning-assets/challenger-solo-'+name+'.png'});
      await page.click('#groupScene');
      assert.equal(await page.locator('#adventureMode').isChecked(),true);
      assert.equal(await page.locator('#ensembleStage figure:visible').count(),3);
      for(const role of ['chinese','english','math']){
        await page.locator('[data-character-choice='+role+']').click();
        assert.equal(await page.locator('#adventureMode').isChecked(),false);
        assert.equal(await page.locator('#avatarWorld').getAttribute('data-character'),role);
        await page.click('#startLive');
        await page.waitForFunction(()=>document.getElementById('chatStatus').textContent.startsWith('正在听'));
        const request=requests.at(-1);
        assert.equal(request.character,role);assert.equal(request.adventure,false);
        assert.ok(request.image.startsWith('data:image/jpeg;base64,'));
        assert.equal(request.camera_state,'on');
        await page.evaluate(()=>window.testTracks=document.getElementById('cameraPreview').srcObject.getTracks());
        const countBeforeClose=spoken.length;
        await page.click('#cameraToggle');
        await page.waitForFunction(()=>document.getElementById('chatStatus').textContent.startsWith('正在听'));
        assert.equal(spoken.length,countBeforeClose+1);
        assert.ok(spoken.at(-1).includes('摄像头关着'));
        assert.equal(voices.at(-1),role);
        assert.equal(await page.locator('#cameraPanel').isVisible(),false);
        await page.click('#startLive');
        assert.equal(await page.evaluate(()=>window.testTracks.every(track=>track.readyState==='ended')),true);
      }
      await page.reload();await page.waitForFunction(()=>!document.getElementById('chatSend').disabled);
      await page.click('#openInteraction');
      assert.equal(await page.locator('#groupScene').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#ensembleStage figure:visible').count(),3);
      assert.deepEqual(errors,[]);console.log(name+': ensemble order, teacher identities, audio playback and layout passed.');
      await page.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
