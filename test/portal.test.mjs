import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,mkdirSync,writeFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '../dist/database/db.js';
import { TelegramService } from '../dist/notifications/telegramService.js';
import { AuthService } from '../dist/auth/authService.js';
import { createServer } from '../dist/api/server.js';

test('portal login requires password and Telegram OTP; account CRUD requires session and CSRF',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'chatgpt-portal-'));
  const db=new AppDatabase(join(dir,'app.sqlite'));
  const sent=[];
  const telegramConfig={enabled:true,botToken:'fake',chatId:'123',errorReminderHours:12,commandsEnabled:false,adminUserId:null};
  const telegram=new TelegramService(telegramConfig,async(_url,init)=>{
    sent.push(JSON.parse(init.body));return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200});
  });
  const auth=new AuthService(db,telegram,'a'.repeat(64),'123');
  await auth.createFirstAdmin('admin','a-strong-password-123');
  const config={telegram:telegramConfig,databasePath:join(dir,'app.sqlite'),profileRoot:join(dir,'profiles'),screenshotRoot:join(dir,'screenshots'),resetSafetySeconds:90,portalSecret:'a'.repeat(64),secureCookies:false,port:0};
  const app=createServer(db,{process:async()=>{}},{},config,auth);
  const server=app.listen(0);
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,method='GET',body,cookie,csrf)=>fetch(base+'/api'+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  try {
    assert.equal((await fetch(base+'/')).status,200);
    assert.equal((await fetch(base+'/assets/portal.js')).status,200);
    assert.equal((await request('/accounts')).status,401);
    assert.equal((await request('/auth/login','POST',{username:'admin',password:'wrong'})).status,401);
    assert.equal(sent.length,0);
    const started=await request('/auth/login','POST',{username:'admin',password:'a-strong-password-123'});
    assert.equal(started.status,200);
    const {challengeId}=await started.json();
    assert.equal(sent.length,1);
    const code=/Portal login code: (\d{6})/.exec(sent[0].text)[1];
    assert.equal((await request('/auth/verify','POST',{challengeId,code:'000000'})).status,401);
    const verified=await request('/auth/verify','POST',{challengeId,code});
    assert.equal(verified.status,200);
    const cookie=verified.headers.get('set-cookie').split(';')[0];
    assert.match(verified.headers.get('set-cookie'),/HttpOnly/);
    assert.match(verified.headers.get('set-cookie'),/SameSite=Strict/);
    const {csrf}=await verified.json();
    assert.equal((await request('/accounts','POST',{id:'account-001',name:'A'},cookie)).status,403);
    const created=await request('/accounts','POST',{id:'account-001',name:'Account 1',timezone:'Asia/Kolkata'},cookie,csrf);
    assert.equal(created.status,201);
    assert.equal(db.account('account-001').name,'Account 1');
    assert.equal((await request('/accounts/account-001','PATCH',{name:'Updated',timezone:'UTC'},cookie,csrf)).status,200);
    assert.equal(db.account('account-001').name,'Updated');
    mkdirSync(db.account('account-001').profilePath,{recursive:true});
    writeFileSync(join(db.account('account-001').profilePath,'session-marker'),'saved');
    assert.equal((await request('/accounts/account-001','DELETE',{confirmId:'account-001'},cookie,csrf)).status,200);
    assert.equal(db.account('account-001'),null);
    assert.equal(existsSync(join(dir,'profiles','account-001')),false);
    assert.equal((await request('/auth/logout','POST',{},cookie,csrf)).status,200);
    assert.equal((await request('/accounts','GET',undefined,cookie)).status,401);
  } finally {
    await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true});
  }
});
