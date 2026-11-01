const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL==='chromium'?undefined:'chrome',headless:true});
  try{
    for(const [name,width,height] of [['reported',884,791],['desktop',1280,800],['mobile',390,844],['landscape',844,390]]){
      const page=await browser.newPage({viewport:{width,height}});
      await require('./test-browser-fixture.cjs').install(page);
      await page.goto((process.env.APP_URL || 'http://127.0.0.1:8765/'));await page.click('#openInteraction');
      for(const camera of [false,true]){
        await page.evaluate(camera=>{document.getElementById('cameraPanel').hidden=camera===false;window.dispatchEvent(new CustomEvent('professor-speaker',{detail:{character:'challenger'}}));window.dispatchEvent(new CustomEvent('professor-state',{detail:{state:'speaking'}}));},camera);
        await page.waitForTimeout(300);
        const boxes=await page.evaluate(()=>{
          const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};};
          return {titleHidden:getComputedStyle(document.querySelector('.character-title')).display==='none',stage:rect(document.getElementById('ensembleStage')),faces:[...document.querySelectorAll('#ensembleStage figure:not([hidden]) .cast-face')].map(rect),names:[...document.querySelectorAll('#ensembleStage figure:not([hidden]) figcaption')].map(rect),camera:rect(document.getElementById('cameraPanel')),caption:rect(document.getElementById('avatarCaption')),overflow:document.documentElement.scrollWidth>innerWidth};
        });
        assert.equal(boxes.titleHidden,true);assert.equal(boxes.overflow,false);
        for(let i=0;i<boxes.faces.length;i++){
          const face=boxes.faces[i];assert.ok(face.top>=boxes.stage.top-8,name+' face above reserved stage');
          assert.ok(face.bottom<=boxes.names[i].top+1,name+' face overlaps its name');
          assert.ok(boxes.names[i].bottom<=boxes.stage.bottom+1,name+' name outside stage');
          if(camera){const c=boxes.camera;assert.ok(face.right<=c.left||face.left>=c.right||face.bottom<=c.top||face.top>=c.bottom,name+' camera overlaps a face');}
        }
        assert.equal(await page.locator('#avatarCaption').isVisible(),false);
        if(name==='reported'&&camera)await page.screenshot({path:'learning-assets/ensemble-layout-fixed.png'});
      }
      console.log(name+': title, portraits, captions and camera do not overlap.');await page.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
