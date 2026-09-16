import type { AppDatabase } from "../database/db.js";
import type { AccountWorker } from "./accountWorker.js";
import type { NotificationService } from "../notifications/notificationService.js";
import type { AlertEvent,AccountStatus } from "../types/events.js";

const alertByStatus:Partial<Record<AccountStatus,AlertEvent>>={
  LOGIN_REQUIRED:"LOGIN_REQUIRED",WORK_NOT_AVAILABLE:"WORK_NOT_AVAILABLE",
  USAGE_PARSE_FAILED:"USAGE_PARSE_FAILED",MESSAGE_SEND_FAILED:"MESSAGE_SEND_FAILED",
  RESET_VERIFICATION_PENDING:"RESET_VERIFICATION_PENDING",RESET_DID_NOT_CHANGE:"RESET_DID_NOT_CHANGE",
  CHROMIUM_CRASH:"CHROMIUM_CRASH",DISABLED_REPEATED_ERRORS:"ACCOUNT_DISABLED_REPEATED_ERRORS"
};

export class Scheduler {
  private timer:NodeJS.Timeout|null=null;
  private running=false;
  constructor(private readonly db:AppDatabase,private readonly worker:AccountWorker,private readonly notifications:NotificationService,private readonly safetySeconds=90) {}
  start():void { if(this.timer)return;void this.tick();this.timer=setInterval(()=>void this.tick(),60_000); }
  stop():void {if(this.timer)clearInterval(this.timer);this.timer=null;}
  async tick():Promise<void> {
    if(this.running)return;
    this.running=true;
    try {
      for(const request of this.db.pendingChecks()) {
        this.db.setCheckStatus(request.id,"RUNNING");
        try {await this.worker.process(request.accountId,true);this.db.setCheckStatus(request.id,"DONE");}
        catch {this.db.setCheckStatus(request.id,"FAILED");}
      }
      for(const account of this.db.accounts()) {
        const alert=alertByStatus[account.status];
        if(alert) await this.notifications.error({accountId:account.id,event:alert});
        if(!account.enabled)continue;
        const last=account.lastUsageCheckAt?Date.parse(account.lastUsageCheckAt):0;
        if(account.status==="RESET_VERIFICATION_PENDING") {
          if(Date.now()-last>=15*60_000) await this.worker.process(account.id);
          continue;
        }
        if(account.fiveHourReset && this.db.triggerExists(account.id,account.fiveHourReset)) continue;
        if(Date.now()-last<15*60_000 && (account.status==="LOGIN_REQUIRED"||account.status==="NETWORK_FAILURE"||!account.fiveHourReset)) continue;
        if(!account.fiveHourReset || Date.now()>=Date.parse(account.fiveHourReset)+this.safetySeconds*1000) {
          await this.worker.process(account.id);
        }
      }
    } finally {this.running=false;}
  }
}
