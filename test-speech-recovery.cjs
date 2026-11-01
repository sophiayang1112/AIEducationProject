const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL==='chromium'?undefined:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  try{
    const page=await browser.newPage(),voices=[],spoken=[],errors=[];let failed=false;
    await page.context().grantPermissions(['camera','microphone']);
    await page.addInitScript(()=>{window.SpeechRecognition=class{start(){}stop(){this.onend?.();}};});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/health',async route=>{const r=await route.fetch();await route.fulfill({json:{...require('./test-browser-fixture.cjs').ready(await r.json()),realtime_asr:false}});});
    await page.route('**/api/chat',route=>route.fulfill({contentType:'application/x-ndjson',body:[
      {type:'start',character:'dark',allowed_speakers:['dark','challenger','light']},
      {type:'delta',text:'[dark] 同学，你来啦！\n[challenger] 今天聊点什么？\n[light] 我也在呢。\n'},
      {type:'done',saved:true}
    ].map(x=>JSON.stringify(x)).join('\n')+'\n'}));
    await page.route('**/api/speech-stream',route=>{
      const body=route.request().postDataJSON();voices.push(body.character);spoken.push(body.text);
      if(body.character==='challenger'&&!failed){failed=true;return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'error',error:'Injected disconnect'})+'\n'});}
      return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'audio',sample_rate:24000,data:Buffer.alloc(4800).toString('base64')})+'\n'+JSON.stringify({type:'done'})+'\n'});
    });
    await page.goto((process.env.APP_URL || 'http://127.0.0.1:8765/'));await page.click('#openInteraction');await page.click('#startLive');
    await page.waitForFunction(()=>document.getElementById('chatStatus').textContent.startsWith('正在听'));
    assert.deepEqual(voices,['dark','challenger','light']);
    assert.equal(await page.locator('#retryVoice').isVisible(),true);
    assert.equal(await page.locator('#startLive').textContent(),'结束互动');
    assert.equal(await page.locator('#cameraPanel').isVisible(),true);
    await page.click('#retryVoice');await page.waitForTimeout(400);
    assert.equal(voices.at(-1),'challenger');assert.equal(await page.locator('#retryVoice').isVisible(),false);
    await page.click('#startLive');
    await page.route('**/api/chat',route=>route.fulfill({contentType:'application/x-ndjson',body:[
      {type:'start',character:'english',allowed_speakers:['english']},
      {type:'delta',text:'apple 就是苹果，先说第一个音“阿”，再连上“剖”。\n同学，跟我读一遍：apple。\n'},
      {type:'done',saved:true}
    ].map(x=>JSON.stringify(x)).join('\n')+'\n'}));
    await page.locator('[data-character-choice=english]').click();
    await page.click('#toggleChat');await page.fill('#chatInput','教我读 apple');await page.click('#chatSend');
    await page.waitForFunction(()=>!document.getElementById('chatSend').disabled);
    await page.waitForTimeout(500);
    assert.ok(spoken.some(text=>text==='apple.'));
    assert.ok(!spoken.some(text=>text.includes('“阿”')||text.includes('“剖”')));
    assert.deepEqual(errors,[]);
    console.log('PASS: one failed voice does not stop remaining characters or live session; retry keeps the failed character voice.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
