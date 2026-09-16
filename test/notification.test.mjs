import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppDatabase } from '../dist/database/db.js';
import { TelegramService } from '../dist/notifications/telegramService.js';
import { NotificationService } from '../dist/notifications/notificationService.js';
import { CommandService } from '../dist/notifications/commandService.js';

function setup() {
  const dir=mkdtempSync(join(tmpdir(),'chatgpt-notify-'));
  const db=new AppDatabase(join(dir,'test.sqlite'));
  db.addAccount({id:'account-001',name:'Account 1',profilePath:join(dir,'profile'),timezone:'Asia/Kolkata'});
  const sent=[];
  const config={enabled:true,botToken:'fake',chatId:'123',errorReminderHours:12,commandsEnabled:true,adminUserId:null};
  const fetcher=async (_url,init)=>{
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{status:200});
  };
  const telegram=new TelegramService(config,fetcher);
  const notifications=new NotificationService(db,telegram,config);
  return {db,telegram,notifications,sent,cleanup:()=>{db.close();rmSync(dir,{recursive:true,force:true})}};
}
test('deduplicates unresolved errors across service instances and sends on state change',async()=>{
  const s=setup();
  try {
    assert.equal(await s.notifications.error({accountId:'account-001',event:'LOGIN_REQUIRED'}),true);
    assert.equal(await new NotificationService(s.db,s.telegram,{enabled:true,errorReminderHours:12}).error({accountId:'account-001',event:'LOGIN_REQUIRED'}),false);
    assert.equal(s.sent.length,1);
    assert.equal(await s.notifications.error({accountId:'account-001',event:'WORK_NOT_AVAILABLE'}),true);
    assert.equal(s.sent.length,2);
    s.notifications.resolved('account-001');
    assert.equal(await s.notifications.error({accountId:'account-001',event:'LOGIN_REQUIRED'}),true);
    assert.equal(s.sent.length,3);
  } finally {s.cleanup()}
});
test('success is unique per reset cycle',async()=>{
  const s=setup();
  try {
    const input={accountId:'account-001',event:'WORK_STARTED',oldReset:'2026-09-18T14:00:00Z',newReset:'2026-09-18T19:00:00Z',cycleKey:'2026-09-18T14:00:00Z'};
    assert.equal(await s.notifications.success(input),true);
    assert.equal(await s.notifications.success(input),false);
    assert.match(s.sent[0].text,/Message: HI/);
    assert.equal(s.sent.length,1);
  } finally {s.cleanup()}
});
test('Telegram commands reject unauthorized chats and queue checks without sending HI',async()=>{
  const s=setup();
  try {
    const commands=new CommandService(s.db,s.telegram);
    await commands.handle({update_id:1,message:{text:'/check account-001',chat:{id:999,type:'private'},from:{id:999}}});
    assert.equal(s.db.pendingChecks().length,0);
    await commands.handle({update_id:2,message:{text:'/check account-001',chat:{id:123,type:'private'},from:{id:123}}});
    assert.equal(s.db.pendingChecks().length,1);
    assert.equal(s.sent.length,1);
    assert.match(s.sent[0].text,/Usage check queued/);
    await commands.handle({update_id:3,message:{text:'/check account-001',chat:{id:123,type:'group'},from:{id:999}}});
    assert.equal(s.sent.length,1);
  } finally {s.cleanup()}
});
test('a reset cycle can only be started once, including after an interrupted attempt',()=>{
  const s=setup();
  try {
    assert.equal(s.db.startTrigger('account-001','2026-09-18T14:00:00Z','2026-09-18T14:00:00Z'),true);
    assert.equal(s.db.startTrigger('account-001','2026-09-18T14:00:00Z','2026-09-18T14:00:00Z'),false);
    assert.equal(s.db.triggerExists('account-001','2026-09-18T14:00:00Z'),true);
    s.db.recoverInterruptedTriggers();
    assert.equal(s.db.account('account-001').status,'RESET_VERIFICATION_PENDING');
    assert.equal(s.db.trigger('account-001','2026-09-18T14:00:00Z').status,'RESET_VERIFICATION_PENDING');
  } finally {s.cleanup()}
});
