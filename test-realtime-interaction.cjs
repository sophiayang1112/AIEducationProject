const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL==='chromium'?undefined:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
  try{
    const page=await browser.newPage(),events=[],errors=[],requests=[],voices=[];let audioPackets=0,stops=0,starts=0;
    await page.context().grantPermissions(['camera','microphone']);page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/health',async route=>{const r=await route.fetch();await route.fulfill({json:{...require('./test-browser-fixture.cjs').ready(await r.json()),realtime_asr:true}});});
    await page.route('**/api/asr/*',async route=>{
      const action=route.request().url().split('/').pop();
      if(action==='start'){starts++;return route.fulfill({json:{session_id:'test',sample_rate:16000}});}
      if(action==='audio'){audioPackets++;if(audioPackets===1)await pause(1400);return route.fulfill({json:{accepted:true}}).catch(()=>{});}
      if(action==='stop'){stops++;return route.fulfill({json:{stopped:true}});}
      await pause(40);await route.fulfill({json:{events:events.splice(0),closed:false}}).catch(()=>{});
    });
    await page.route('**/api/cancel',route=>route.fulfill({json:{cancelled:true}}));
    await page.route('**/api/chat',async route=>{
      const body=route.request().postDataJSON();requests.push(body);
      if(body.message==='旧问题')await pause(1200);
      const text=body.message==='新问题'?'[challenger] 好，我们聊这个。\n':body.message==='旧问题'?'[challenger] 不能播放的旧回答。\n':'[challenger] 同学，我在听。';
      await route.fulfill({contentType:'application/x-ndjson',body:[{type:'start',character:'challenger'},{type:'delta',text},{type:'done',saved:true}].map(x=>JSON.stringify(x)).join('\n')+'\n'}).catch(()=>{});
    });
    await page.route('**/api/speech-stream',route=>{
      const body=route.request().postDataJSON();voices.push(body);
      return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'audio',data:Buffer.alloc(144000).toString('base64'),sample_rate:24000})+'\n'+JSON.stringify({type:'done'})+'\n'});
    });
    await page.goto((process.env.APP_URL || 'http://127.0.0.1:8765/'));await page.waitForFunction(()=>!document.getElementById('startLive').disabled);
    await page.click('#openInteraction');await page.locator('[data-character-choice=challenger]').click();await page.click('#startLive');
    await page.waitForFunction(()=>document.getElementById('avatarWorld').dataset.state==='speaking');
    await pause(1500);
    const before=audioPackets;await pause(250);assert.ok(audioPackets>before,'microphone continues during playback after the simulated upload stall');
    events.push({type:'speech_start'});await page.waitForFunction(()=>document.getElementById('stopReading').hidden);
    events.push({type:'speech_end'},{type:'final',text:'旧问题'});await page.waitForFunction(()=>document.getElementById('chatSend').disabled);
    events.push({type:'speech_start'},{type:'speech_end'},{type:'final',text:'新问题'});
    await pause(1800);
    assert.ok(requests.some(r=>r.message==='新问题'));
    assert.ok(!voices.some(v=>v.text.includes('不能播放')),'interrupted answer must not play');
    assert.ok(voices.every(v=>v.character==='challenger'));
    assert.ok(voices.every(v=>!v.text.includes('[')),'role tags must never be read aloud');
    assert.ok(requests.every(r=>!r.image),'casual chat does not wait for camera frames');
    assert.equal(await page.locator('#avatarCaption').isVisible(),false);
    assert.equal(starts,1,'a 1.4 second upload stall must drain without restarting the microphone');
    events.push({type:'error',error:'Injected ASR disconnect'});
    await page.waitForFunction(()=>document.getElementById('chatStatus').textContent.startsWith('已重新连接'));
    assert.equal(starts,2);assert.equal(await page.locator('#startLive').textContent(),'结束互动');
    events.push({type:'error',error:'Second transient disconnect'});await pause(500);
    assert.equal(starts,3,'a second transient disconnect can recover too');
    await page.click('#startLive');await pause(200);assert.ok(stops>0);
    const endedPackets=audioPackets;await pause(250);assert.equal(audioPackets,endedPackets);
    await page.locator('[data-character-choice=chinese]').click();await page.click('#startLive');
    await pause(350);
    events.push({type:'speech_start'},{type:'final',text:'不放，我就不放。'});
    await pause(600);
    const refusal=requests.find(r=>r.message==='不放，我就不放。');
    assert.ok(refusal);assert.equal(refusal.character,'chinese');assert.ok(!refusal.image,'refusal is answered as speech, not another camera inspection');
    const count=requests.length;await pause(9000);assert.equal(requests.length,count,'automatic camera prompts pause after refusal');
    await page.click('#captureFrame');await pause(500);assert.ok(requests.at(-1).image,'manual display resumes image help');
    await page.click('#startLive');
    assert.deepEqual(errors,[]);
    console.log('PASS: full-duplex microphone, barge-in, stale reply cancellation, role isolation, no unnecessary images, stop cleanup.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
