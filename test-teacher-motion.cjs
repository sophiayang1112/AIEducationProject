const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL==='chromium'?undefined:'chrome',headless:true});
  try{
    for(const [name,width,height] of [['desktop',1280,800],['mobile',390,844]]){
      const page=await browser.newPage({viewport:{width,height}}),errors=[];
      await require('./test-browser-fixture.cjs').install(page);
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/api/chat',async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.fulfill({status:503,contentType:'application/json',body:'{"error":"test response"}'});});
      await page.goto((process.env.APP_URL || 'http://127.0.0.1:8765/'));
      await page.waitForFunction(()=>!document.getElementById('chatSend').disabled);
      await page.click('#openInteraction');
      for(const role of ['chinese','english','math']){
        await page.locator('[data-character-choice='+role+']').click();
        for(const group of [false,true]){
          await page.evaluate(group=>{const mode=document.getElementById('adventureMode');mode.checked=group;mode.dispatchEvent(new Event('change'));},group);
          for(const state of ['idle','thinking','listening','speaking','cheering']){
            await page.evaluate(state=>window.dispatchEvent(new CustomEvent('professor-state',{detail:{state}})),state);
            const selector=group?'[data-cast='+role+'] .cast-face':'#avatarPortrait';
            const first=await page.locator(selector).boundingBox();
            await page.waitForTimeout(170);
            const last=await page.locator(selector).boundingBox();
            assert.deepEqual(last,first);
            assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).transform),'none');
          }
        }
      }
      await page.locator('[data-character-choice=challenger]').click();
      for(const group of [false,true]){
        await page.evaluate(group=>{const mode=document.getElementById('adventureMode');mode.checked=group;mode.dispatchEvent(new Event('change'));window.dispatchEvent(new CustomEvent('professor-state',{detail:{state:'thinking'}}));},group);
        await page.waitForTimeout(350);
        const selector=group?'[data-cast=challenger] .cast-face':'#avatarPortrait';
        const first=await page.locator(selector).boundingBox();await page.waitForTimeout(650);
        assert.deepEqual(await page.locator(selector).boundingBox(),first);
        assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).transform),'none');
      }
      await page.locator('[data-character-choice=english]').click();
      const caption=await page.locator('#avatarCaption').textContent();
      await page.click('#toggleChat');await page.fill('#chatInput','Test');
      const request=page.waitForRequest('**/api/chat');await page.click('#chatSend');await request;
      assert.equal(await page.locator('#avatarCaption').textContent(),caption);
      assert.ok(!(await page.locator('body').textContent()).includes('让我想一想，这一题怎么出呢'));
      await page.waitForFunction(()=>!document.getElementById('chatSend').disabled);
      await page.click('#toggleChat');
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('professor-state',{detail:{state:'speaking',text:'我们一起看看这道题。'}})));
      await page.waitForTimeout(300);
      await page.screenshot({path:'learning-assets/teacher-calm-'+name+'.png'});
      assert.deepEqual(errors,[]);console.log(name+': all three teachers stable in five states, solo and group; no canned thinking caption.');
      await page.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
