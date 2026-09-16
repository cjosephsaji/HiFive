import { DateTime } from "luxon";
import type { AppDatabase,Account } from "../database/db.js";
import { TelegramService,type TelegramUpdate } from "./telegramService.js";
import { safeLabel } from "./notificationService.js";

export class CommandService {
  private controller:AbortController|null=null;
  constructor(private readonly db:AppDatabase,private readonly telegram:TelegramService) {}
  start():void {if(!this.telegram.commandsEnabled||this.controller)return;this.controller=new AbortController();void this.poll(this.controller.signal);}
  stop():void {this.controller?.abort();this.controller=null;}
  private async poll(signal:AbortSignal):Promise<void> {
    let delay=1000;
    while(!signal.aborted) {
      try {
        const updates=await this.telegram.updates(this.db.cursor(),signal);
        for(const update of updates) {
          await this.handle(update);
          this.db.setCursor(update.update_id+1);
        }
        delay=1000;
      } catch {
        if(signal.aborted)break;
        await new Promise(resolve=>setTimeout(resolve,delay));
        delay=Math.min(delay*2,60_000);
      }
    }
  }
  async handle(update:TelegramUpdate):Promise<void> {
    if(!this.telegram.isAuthorized(update))return;
    const text=update.message?.text?.trim()??"";
    let response:string;
    if(text==="/status") response=this.status();
    else if(text==="/accounts") response=this.accounts();
    else {
      const check=/^\/check\s+(account-[a-z0-9-]+)$/.exec(text);
      const logs=/^\/logs\s+(account-[a-z0-9-]+)$/.exec(text);
      if(check) response=this.check(check[1]!);
      else if(logs) response=this.logs(logs[1]!);
      else response="Commands: /status, /accounts, /check account-001, /logs account-001";
    }
    await this.telegram.send(response);
  }
  private status():string {
    const accounts=this.db.accounts();
    return `ChatGPT Work Automation\n\n${accounts.length?accounts.map(a=>`${a.status==="WAITING"||a.status==="SUCCESS"?"✅":"⚠️"} ${safeLabel(a.name)}\n${a.status==="SUCCESS"?"Waiting":a.status}\n${a.fiveHourReset?`Next reset: ${format(a.fiveHourReset,a.timezone)}`:"Next reset: unknown"}`).join("\n\n"):"No accounts configured"}`;
  }
  private accounts():string {
    const accounts=this.db.accounts();
    return accounts.length?accounts.map(a=>`${a.id} — ${safeLabel(a.name)} — ${a.enabled?"enabled":"disabled"} — ${a.status}`).join("\n"):"No accounts configured";
  }
  private check(id:string):string {
    const account=this.db.account(id);
    if(!account)return "Unknown account";
    return this.db.queueCheck(id)?`Usage check queued for ${id}. The scheduler will apply its normal due and idempotency rules.`:`A Usage check is already queued for ${id}.`;
  }
  private logs(id:string):string {
    if(!this.db.account(id))return "Unknown account";
    const events=this.db.events(id,10);
    return `Recent events for ${id}:\n${events.length?events.map(e=>`${e.createdAt} ${e.event}: ${safeLabel(e.message)}`).join("\n"):"No events"}`;
  }
}
function format(value:string,zone:string):string {
  const dt=DateTime.fromISO(value,{zone:"utc"}).setZone(zone);
  return dt.isValid?dt.toFormat("MMM d, h:mm a"):"unknown";
}
