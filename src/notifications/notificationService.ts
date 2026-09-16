import { DateTime } from "luxon";
import type { TelegramConfig } from "../config/config.js";
import type { AppDatabase } from "../database/db.js";
import type { AlertInput, SuccessInput } from "../types/events.js";
import { TelegramService } from "./telegramService.js";

const alertCopy: Record<AlertInput["event"], { title:string; body:string }> = {
  LOGIN_REQUIRED: {title:"⚠️ LOGIN REQUIRED",body:"ChatGPT session has expired.\n\nOpen the admin dashboard/noVNC session and log in again."},
  WORK_NOT_AVAILABLE: {title:"❌ WORK TRIGGER FAILED",body:"Error: Work mode could not be detected\nStatus: WORK_NOT_AVAILABLE"},
  USAGE_PARSE_FAILED: {title:"⚠️ USAGE PARSE FAILED",body:"The Usage reset time could not be read. Check diagnostics before triggering Work."},
  MESSAGE_SEND_FAILED: {title:"❌ MESSAGE SEND FAILED",body:"Message submission could not be confirmed. The system will not retry HI automatically for this reset cycle."},
  RESET_VERIFICATION_PENDING: {title:"⚠️ RESET VERIFICATION PENDING",body:"HI was submitted, but the new Usage reset is not confirmed yet. The system will NOT resend HI automatically."},
  RESET_DID_NOT_CHANGE: {title:"⚠️ RESET VERIFICATION FAILED",body:"HI was submitted but the Usage reset time did not update.\n\nThe system will NOT resend HI automatically. Manual verification may be required."},
  CHROMIUM_CRASH: {title:"❌ CHROMIUM CRASH",body:"Chromium closed unexpectedly. Check the account logs and profile."},
  REPEATED_NETWORK_FAILURES: {title:"⚠️ REPEATED NETWORK FAILURES",body:"Several consecutive network operations failed. Check connectivity and account logs."},
  ACCOUNT_DISABLED_REPEATED_ERRORS: {title:"❌ ACCOUNT DISABLED",body:"Automatic processing was disabled after repeated errors. Inspect the account before enabling it again."}
};

export class NotificationService {
  constructor(private readonly db: AppDatabase, private readonly telegram: TelegramService, private readonly config: TelegramConfig) {}
  async error(input: AlertInput): Promise<boolean> {
    const account = this.db.account(input.accountId);
    if (!account || !this.telegram.enabled) return false;
    const reminder = this.config.errorReminderHours * 3_600_000;
    if (!this.db.reserveError(account.id,input.event,reminder)) return false;
    const copy = alertCopy[input.event];
    try {
      await this.telegram.send(`${copy.title}\n\nAccount: ${safeLabel(account.name)}\n${copy.body}`);
      this.db.finishError(account.id,input.event,true);
      return true;
    } catch {
      this.db.finishError(account.id,input.event,false);
      this.db.event(account.id,"TELEGRAM_SEND_FAILED","Telegram notification delivery failed");
      return false;
    }
  }
  async success(input: SuccessInput): Promise<boolean> {
    const account = this.db.account(input.accountId);
    if (!account || !this.telegram.enabled) return false;
    if (!this.db.reserveSuccess(account.id,input.cycleKey)) return false;
    try {
      const oldReset = formatReset(input.oldReset,account.timezone);
      const newReset = formatReset(input.newReset,account.timezone);
      await this.telegram.send(`✅ WORK STARTED\n\nAccount: ${safeLabel(account.name)}\nMessage: HI\nOld Reset: ${oldReset}\nNew Reset: ${newReset}\nStatus: SUCCESS`);
      this.db.finishSuccess(account.id,input.cycleKey,true);
      this.db.resolveError(account.id);
      return true;
    } catch {
      this.db.finishSuccess(account.id,input.cycleKey,false);
      this.db.event(account.id,"TELEGRAM_SEND_FAILED","Telegram notification delivery failed");
      return false;
    }
  }
  resolved(accountId: string): void { this.db.resolveError(accountId); }
}

export function safeLabel(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g," ").slice(0,100);
}
function formatReset(value:string,zone:string):string {
  const date=DateTime.fromISO(value,{zone:"utc"}).setZone(zone);
  return date.isValid ? date.toFormat("MMM d, h:mm a") : "Unknown";
}
