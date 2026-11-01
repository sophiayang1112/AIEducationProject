'use strict';
const voices=Object.fromEntries(['dark','light','challenger','chinese','english','math'].map(role=>[role,true]));
exports.ready=data=>({...data,ready:true,token:data.token||'test-local-token',voice_ready:true,voices});
exports.install=page=>page.route('**/api/health',async route=>{
  const response=await route.fetch();
  await route.fulfill({json:exports.ready(await response.json())});
});
