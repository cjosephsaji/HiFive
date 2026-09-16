import { randomUUID } from "node:crypto";
import type { AppDatabase,Account } from "../database/db.js";
import { BrowserManager } from "../browser/browserManager.js";
import { readUsage,UsageError,type UsageResult } from "../browser/usagePage.js";
import { openWorkConversation } from "../browser/conversationManager.js";
import { sendHi } from "../browser/chatComposer.js";
import type { NotificationService } from "../notifications/notificationService.js";
import type { Page } from "playwright";
import type { AccountStatus,AlertEvent } from "../types/events.js";

export class AccountWorker {
  constructor(private readonly db:AppDatabase,private readonly browser:BrowserManager,
    private readonly notifications:NotificationService,private readonly safetySeconds=90) {}
  async process(accountId:string, usageOnly=false):Promise<void> {
    const owner=randomUUID();
    if(!this.db.lock(accountId,owner)) return;
    let account=this.db.account(accountId);
    if(!account) {this.db.unlock(accountId,owner);return;}
    let page:Page|undefined;
    let close:undefined|(()=>Promise<void>);
    try {
      const session=await this.browser.open(account);
      page=session.page;close=session.close;
      const usage=await readUsage(page,account.timezone);
      const now=new Date().toISOString();
      if(account.status==="RESET_VERIFICATION_PENDING" && account.fiveHourReset) {
        const old=account.fiveHourReset;
        const trigger=this.db.trigger(accountId,old);
        this.db.updateAccount(accountId,{lastUsageCheckAt:now});
        if(Date.parse(usage.fiveHour.timestamp)>Date.parse(old)+60_000) {
          this.db.updateTrigger(accountId,old,{status:"SUCCESS",newReset:usage.fiveHour.timestamp,completedAt:now});
          this.db.updateAccount(accountId,{status:"SUCCESS",fiveHourReset:usage.fiveHour.timestamp,
            fiveHourRaw:usage.fiveHour.raw,weeklyReset:usage.weekly?.timestamp??null,weeklyRaw:usage.weekly?.raw??null,
            lastSuccessAt:now,lastError:null,failureCount:0});
          this.db.event(accountId,"SUCCESS",`Delayed reset confirmation: ${usage.fiveHour.timestamp}`);
          await this.notifications.success({accountId,event:"WORK_STARTED",oldReset:old,newReset:usage.fiveHour.timestamp,cycleKey:old});
        } else if(trigger?.messageSentAt && Date.now()-Date.parse(trigger.messageSentAt)>30*60_000) {
          this.db.updateTrigger(accountId,old,{status:"RESET_DID_NOT_CHANGE",error:"Reset unchanged after 30 minutes",completedAt:now});
          this.db.setStatus(accountId,"RESET_DID_NOT_CHANGE","HI submitted; Usage reset remained unchanged");
          await this.notifications.error({accountId,event:"RESET_DID_NOT_CHANGE"});
        } else await this.notifications.error({accountId,event:"RESET_VERIFICATION_PENDING"});
        return;
      }
      this.db.updateAccount(accountId,{
        fiveHourReset:usage.fiveHour.timestamp,fiveHourRaw:usage.fiveHour.raw,
        weeklyReset:usage.weekly?.timestamp??null,weeklyRaw:usage.weekly?.raw??null,
        lastUsageCheckAt:now,failureCount:0,lastError:null
      });
      this.db.event(accountId,"USAGE_CHECKED",`5-hour reset: ${usage.fiveHour.timestamp}`);
      if(usageOnly) {
        if(!account.fiveHourReset || !this.db.triggerExists(accountId,account.fiveHourReset)) {
          this.db.setStatus(accountId,"WAITING");this.notifications.resolved(accountId);
        }
        return;
      }
      account=this.db.account(accountId)!;
      // A fresh Usage value may already describe the next cycle; the stored value
      // remains the authoritative idempotency key until a confirmed success.
      const stored=account.fiveHourReset;
      const due=stored && Date.now()>=Date.parse(stored)+this.safetySeconds*1000;
      if(!due) {this.db.setStatus(accountId,"WAITING");this.notifications.resolved(accountId);return;}
      const cycleKey=stored;
      if(this.db.triggerExists(accountId,cycleKey)) return;
      if(!this.db.startTrigger(accountId,cycleKey,stored)) return;
      this.db.updateAccount(accountId,{status:"TRIGGERING",lastTriggerAt:now});
      this.db.event(accountId,"TRIGGERING","Opening Work conversation");
      if(!await openWorkConversation(page,account)) {
        await this.fail(accountId,"WORK_NOT_AVAILABLE","Work mode could not be detected",cycleKey,page,account);
        return;
      }
      const sent=await sendHi(page);
      const conversationUrl=/^https:\/\/chatgpt\.com\/c\/[\w-]+/.test(page.url())?page.url():null;
      if(!sent) {
        await this.fail(accountId,"MESSAGE_SEND_FAILED","HI submission could not be confirmed",cycleKey,page,account);
        return;
      }
      this.db.updateTrigger(accountId,cycleKey,{status:"MESSAGE_SENT",messageSentAt:new Date().toISOString(),conversationUrl:conversationUrl??undefined});
      this.db.updateAccount(accountId,{status:"VERIFYING_RESET",lastWorkChatUrl:conversationUrl??account.lastWorkChatUrl});
      this.db.event(accountId,"MESSAGE_SENT","HI submitted through confirmed Work mode");
      let verified:UsageResult|null=null;
      for(let attempt=0;attempt<6;attempt++) {
        if(attempt) await page.waitForTimeout(10_000);
        try {
          const candidate=await readUsage(page,account.timezone);
          if(Date.parse(candidate.fiveHour.timestamp)>Date.parse(stored)+60_000) {verified=candidate;break;}
        } catch { /* Preserve MESSAGE_SENT; never resend on verification failure. */ }
      }
      if(!verified) {
        this.db.updateTrigger(accountId,cycleKey,{status:"RESET_VERIFICATION_PENDING",error:"Reset change not confirmed"});
        this.db.setStatus(accountId,"RESET_VERIFICATION_PENDING","HI sent; new reset not confirmed");
        await this.notifications.error({accountId,event:"RESET_VERIFICATION_PENDING"});
        return;
      }
      this.db.updateTrigger(accountId,cycleKey,{status:"SUCCESS",newReset:verified.fiveHour.timestamp,completedAt:new Date().toISOString()});
      this.db.updateAccount(accountId,{status:"SUCCESS",fiveHourReset:verified.fiveHour.timestamp,
        fiveHourRaw:verified.fiveHour.raw,weeklyReset:verified.weekly?.timestamp??null,
        weeklyRaw:verified.weekly?.raw??null,lastSuccessAt:new Date().toISOString(),lastError:null});
      this.db.event(accountId,"SUCCESS",`HI confirmed; new reset: ${verified.fiveHour.timestamp}`);
      await this.notifications.success({accountId,event:"WORK_STARTED",oldReset:stored,newReset:verified.fiveHour.timestamp,cycleKey});
    } catch(error) {
      const status:AccountStatus=error instanceof UsageError ? error.code : isBrowserCrash(error) ? "CHROMIUM_CRASH" : isNetwork(error) ? "NETWORK_FAILURE" : "UNKNOWN_ERROR";
      const accountNow=this.db.account(accountId);
      const count=(accountNow?.failureCount??0)+1;
      const protectedPending=accountNow?.status==="RESET_VERIFICATION_PENDING";
      this.db.updateAccount(accountId,{status:protectedPending?"RESET_VERIFICATION_PENDING":status,lastError:safeError(error),failureCount:count,lastUsageCheckAt:new Date().toISOString()});
      this.db.event(accountId,status,safeError(error));
      if(page && accountNow) await this.browser.screenshot(accountNow,page,status).catch(()=>undefined);
      const event=alertFor(status,count);
      if(event) await this.notifications.error({accountId,event});
      if(count>=5 && accountNow?.enabled) {
        this.db.updateAccount(accountId,{enabled:false,status:"DISABLED_REPEATED_ERRORS"});
        this.db.event(accountId,"DISABLED_REPEATED_ERRORS","Disabled after five consecutive errors");
        await this.notifications.error({accountId,event:"ACCOUNT_DISABLED_REPEATED_ERRORS"});
      }
    } finally {
      await close?.().catch(()=>undefined);
      this.db.unlock(accountId,owner);
    }
  }
  private async fail(id:string,status:AccountStatus,message:string,cycleKey:string,page:Page,account:Account):Promise<void> {
    this.db.updateTrigger(id,cycleKey,{status,error:message,completedAt:new Date().toISOString()});
    const count=(this.db.account(id)?.failureCount??0)+1;
    this.db.updateAccount(id,{failureCount:count});
    this.db.setStatus(id,status,message);
    await this.browser.screenshot(account,page,status);
    await this.notifications.error({accountId:id,event:status as AlertEvent});
    if(count>=5) {
      this.db.updateAccount(id,{enabled:false,status:"DISABLED_REPEATED_ERRORS"});
      this.db.event(id,"DISABLED_REPEATED_ERRORS","Disabled after five consecutive errors");
      await this.notifications.error({accountId:id,event:"ACCOUNT_DISABLED_REPEATED_ERRORS"});
    }
  }
}
function safeError(error:unknown):string {
  const text=error instanceof Error ? error.message : String(error);
  return text.replace(/(?:bearer\s+|token[=:]\s*|cookie[=:]\s*)\S+/gi,"[redacted]")
    .replace(/https?:\/\/\S+/g,"[url redacted]").slice(0,300);
}
function isNetwork(error:unknown):boolean {return /net::|ECONN|ENOTFOUND|ETIMEDOUT|network/i.test(String(error));}
function isBrowserCrash(error:unknown):boolean {return /browser.*closed|target.*closed|chromium.*crash/i.test(String(error));}
function alertFor(status:AccountStatus,count:number):AlertEvent|null {
  if(status==="NETWORK_FAILURE") return count>=3?"REPEATED_NETWORK_FAILURES":null;
  if(status==="CHROMIUM_CRASH") return "CHROMIUM_CRASH";
  if(status==="LOGIN_REQUIRED"||status==="USAGE_PARSE_FAILED") return status;
  return null;
}
