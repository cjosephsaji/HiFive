import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AccountStatus, AccountSummary } from "../types/events.js";

export interface Account extends AccountSummary {
  profilePath: string;
  weeklyReset: string | null;
  fiveHourRaw: string | null;
  weeklyRaw: string | null;
  lastWorkChatUrl: string | null;
  lastUsageCheckAt: string | null;
  lastTriggerAt: string | null;
  lastSuccessAt: string | null;
  failureCount: number;
}

export class AppDatabase {
  readonly raw: Database.Database;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.raw = new Database(path);
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("foreign_keys = ON");
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, profile_path TEXT NOT NULL UNIQUE,
        timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'WAITING', last_work_chat_url TEXT,
        five_hour_reset TEXT, five_hour_raw TEXT, weekly_reset TEXT, weekly_raw TEXT,
        last_usage_check_at TEXT, last_trigger_at TEXT, last_success_at TEXT,
        last_error TEXT, failure_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS trigger_history (
        id INTEGER PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        cycle_key TEXT NOT NULL, old_reset TEXT, new_reset TEXT,
        trigger_started_at TEXT NOT NULL, message_sent_at TEXT, completed_at TEXT,
        status TEXT NOT NULL, conversation_url TEXT, error TEXT,
        UNIQUE(account_id, cycle_key)
      );
      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY, account_id TEXT REFERENCES accounts(id),
        event TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS system_events_account_idx ON system_events(account_id, id DESC);
      CREATE TABLE IF NOT EXISTS notification_state (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id), event TEXT NOT NULL,
        last_sent_at TEXT, pending_until TEXT
      );
      CREATE TABLE IF NOT EXISTS notification_success (
        account_id TEXT NOT NULL REFERENCES accounts(id), cycle_key TEXT NOT NULL,
        sent_at TEXT, pending_until TEXT, PRIMARY KEY(account_id, cycle_key)
      );
      CREATE TABLE IF NOT EXISTS telegram_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), next_update_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS check_requests (
        id INTEGER PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        requested_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING'
      );
      CREATE TABLE IF NOT EXISTS account_locks (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id), owner TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS portal_users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
        telegram_chat_id TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS portal_login_attempts (
        key TEXT PRIMARY KEY, failures INTEGER NOT NULL, blocked_until TEXT
      );
      CREATE TABLE IF NOT EXISTS portal_challenges (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES portal_users(id),
        code_hash TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS portal_otp_sends (
        id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES portal_users(id), sent_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS portal_sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES portal_users(id),
        csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
    `);
    this.raw.prepare("UPDATE check_requests SET status='PENDING' WHERE status='RUNNING'").run();
  }
  close(): void { this.raw.close(); }
  addAccount(input: { id: string; name: string; profilePath: string; timezone: string; enabled?: boolean }): void {
    this.raw.prepare(`INSERT INTO accounts(id,name,profile_path,timezone,enabled)
      VALUES(@id,@name,@profilePath,@timezone,@enabled)`).run({ ...input, enabled: input.enabled ? 1 : 0 });
    this.event(input.id, "ACCOUNT_CREATED", "Account created");
  }
  editAccount(id:string,name:string,timezone:string):void {
    this.raw.prepare("UPDATE accounts SET name=?,timezone=? WHERE id=?").run(name,timezone,id);
    this.event(id,"ACCOUNT_UPDATED","Account details updated");
  }
  deleteAccount(id:string):void {
    this.raw.transaction(()=>{
      for(const table of ["trigger_history","system_events","notification_state","notification_success","check_requests","account_locks"])
        this.raw.prepare(`DELETE FROM ${table} WHERE account_id=?`).run(id);
      this.raw.prepare("DELETE FROM accounts WHERE id=?").run(id);
    })();
  }
  account(id: string): Account | null {
    const row = this.raw.prepare("SELECT * FROM accounts WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? mapAccount(row) : null;
  }
  accounts(): Account[] {
    return (this.raw.prepare("SELECT * FROM accounts ORDER BY id").all() as Record<string, unknown>[]).map(mapAccount);
  }
  updateAccount(id: string, patch: Partial<Pick<Account, "status" | "enabled" | "lastError" | "fiveHourReset" | "fiveHourRaw" | "weeklyReset" | "weeklyRaw" | "lastUsageCheckAt" | "lastTriggerAt" | "lastSuccessAt" | "lastWorkChatUrl" | "failureCount">>): void {
    const columns: Record<string, string> = {
      status: "status", enabled: "enabled", lastError: "last_error",
      fiveHourReset: "five_hour_reset", fiveHourRaw: "five_hour_raw",
      weeklyReset: "weekly_reset", weeklyRaw: "weekly_raw",
      lastUsageCheckAt: "last_usage_check_at", lastTriggerAt: "last_trigger_at",
      lastSuccessAt: "last_success_at", lastWorkChatUrl: "last_work_chat_url",
      failureCount: "failure_count"
    };
    const entries = Object.entries(patch).filter(([key]) => key in columns);
    if (!entries.length) return;
    const values = entries.map(([key, value]) => key === "enabled" ? (value ? 1 : 0) : value);
    this.raw.prepare(`UPDATE accounts SET ${entries.map(([key]) => `${columns[key]}=?`).join(", ")} WHERE id=?`).run(...values, id);
  }
  event(accountId: string | null, event: string, message: string): void {
    this.raw.prepare("INSERT INTO system_events(account_id,event,message,created_at) VALUES(?,?,?,?)")
      .run(accountId, event, message.slice(0, 500), new Date().toISOString());
  }
  events(accountId: string, limit = 10): Array<{event:string; message:string; createdAt:string}> {
    const rows = this.raw.prepare("SELECT event,message,created_at FROM system_events WHERE account_id=? ORDER BY id DESC LIMIT ?")
      .all(accountId, limit) as Array<{event:string; message:string; created_at:string}>;
    return rows.map(r => ({ event:r.event, message:r.message, createdAt:r.created_at }));
  }
  setStatus(id: string, status: AccountStatus, message: string | null = null): void {
    this.updateAccount(id, { status, lastError: message });
    this.event(id, status, message ?? status);
  }
  reserveError(accountId: string, event: string, reminderMs: number, now = Date.now()): boolean {
    return this.raw.transaction(() => {
      const row = this.raw.prepare("SELECT event,last_sent_at,pending_until FROM notification_state WHERE account_id=?")
        .get(accountId) as {event:string; last_sent_at:string|null; pending_until:string|null}|undefined;
      const stillPending = row?.pending_until && Date.parse(row.pending_until) > now;
      if (stillPending) return false;
      if (row?.event === event && row.last_sent_at && now - Date.parse(row.last_sent_at) < reminderMs) return false;
      this.raw.prepare(`INSERT INTO notification_state(account_id,event,last_sent_at,pending_until) VALUES(?,?,NULL,?)
        ON CONFLICT(account_id) DO UPDATE SET event=excluded.event,
        last_sent_at=CASE WHEN notification_state.event=excluded.event THEN notification_state.last_sent_at ELSE NULL END,
        pending_until=excluded.pending_until`).run(accountId, event, new Date(now + 120_000).toISOString());
      return true;
    })();
  }
  finishError(accountId: string, event: string, success: boolean): void {
    this.raw.prepare(`UPDATE notification_state SET pending_until=NULL,
      last_sent_at=CASE WHEN ? THEN ? ELSE last_sent_at END WHERE account_id=? AND event=?`)
      .run(success ? 1 : 0, new Date().toISOString(), accountId, event);
  }
  resolveError(accountId: string): void {
    this.raw.prepare("DELETE FROM notification_state WHERE account_id=?").run(accountId);
  }
  reserveSuccess(accountId: string, cycleKey: string, now = Date.now()): boolean {
    return this.raw.transaction(() => {
      const row = this.raw.prepare("SELECT sent_at,pending_until FROM notification_success WHERE account_id=? AND cycle_key=?")
        .get(accountId,cycleKey) as {sent_at:string|null;pending_until:string|null}|undefined;
      if (row?.sent_at || (row?.pending_until && Date.parse(row.pending_until)>now)) return false;
      this.raw.prepare(`INSERT INTO notification_success(account_id,cycle_key,pending_until) VALUES(?,?,?)
        ON CONFLICT(account_id,cycle_key) DO UPDATE SET pending_until=excluded.pending_until`)
        .run(accountId,cycleKey,new Date(now+120_000).toISOString());
      return true;
    })();
  }
  finishSuccess(accountId: string, cycleKey: string, success: boolean): void {
    this.raw.prepare("UPDATE notification_success SET pending_until=NULL, sent_at=CASE WHEN ? THEN ? ELSE sent_at END WHERE account_id=? AND cycle_key=?")
      .run(success ? 1 : 0,new Date().toISOString(),accountId,cycleKey);
  }
  cursor(): number { return (this.raw.prepare("SELECT next_update_id FROM telegram_cursor WHERE id=1").get() as {next_update_id:number}|undefined)?.next_update_id ?? 0; }
  setCursor(id: number): void { this.raw.prepare("INSERT INTO telegram_cursor(id,next_update_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET next_update_id=excluded.next_update_id").run(id); }
  queueCheck(accountId: string): boolean {
    if (this.raw.prepare("SELECT id FROM check_requests WHERE account_id=? AND status IN ('PENDING','RUNNING')").get(accountId)) return false;
    this.raw.prepare("INSERT INTO check_requests(account_id,requested_at) VALUES(?,?)").run(accountId,new Date().toISOString());
    return true;
  }
  pendingChecks(): Array<{id:number;accountId:string}> {
    return (this.raw.prepare("SELECT id,account_id FROM check_requests WHERE status='PENDING' ORDER BY id").all() as Array<{id:number;account_id:string}>).map(r=>({id:r.id,accountId:r.account_id}));
  }
  setCheckStatus(id: number, status: "RUNNING"|"DONE"|"FAILED"): void { this.raw.prepare("UPDATE check_requests SET status=? WHERE id=?").run(status,id); }
  recoverInterruptedTriggers():void {
    this.raw.transaction(()=>{
      const rows=this.raw.prepare("SELECT account_id,cycle_key FROM trigger_history WHERE status IN ('TRIGGERING','MESSAGE_SENT','VERIFYING_RESET')")
        .all() as Array<{account_id:string;cycle_key:string}>;
      for(const row of rows) {
        this.raw.prepare("UPDATE trigger_history SET status='RESET_VERIFICATION_PENDING',error='Interrupted attempt; submission state uncertain' WHERE account_id=? AND cycle_key=?")
          .run(row.account_id,row.cycle_key);
        this.raw.prepare("UPDATE accounts SET status='RESET_VERIFICATION_PENDING',last_error='Interrupted attempt; verify manually' WHERE id=?")
          .run(row.account_id);
        this.event(row.account_id,"RESET_VERIFICATION_PENDING","Recovered interrupted attempt; HI will not be resent");
      }
    })();
  }
  lock(accountId:string,owner:string,leaseMs=300_000):boolean {
    const now=new Date();
    return this.raw.transaction(()=>{
      this.raw.prepare("DELETE FROM account_locks WHERE account_id=? AND expires_at<?").run(accountId,now.toISOString());
      const result=this.raw.prepare("INSERT OR IGNORE INTO account_locks(account_id,owner,expires_at) VALUES(?,?,?)")
        .run(accountId,owner,new Date(now.getTime()+leaseMs).toISOString());
      return result.changes===1;
    })();
  }
  unlock(accountId:string,owner:string):void { this.raw.prepare("DELETE FROM account_locks WHERE account_id=? AND owner=?").run(accountId,owner); }
  triggerExists(accountId:string,cycleKey:string):boolean {
    return Boolean(this.raw.prepare("SELECT id FROM trigger_history WHERE account_id=? AND cycle_key=?").get(accountId,cycleKey));
  }
  trigger(accountId:string,cycleKey:string):{messageSentAt:string|null;status:string}|null {
    const row=this.raw.prepare("SELECT message_sent_at,status FROM trigger_history WHERE account_id=? AND cycle_key=?")
      .get(accountId,cycleKey) as {message_sent_at:string|null;status:string}|undefined;
    return row?{messageSentAt:row.message_sent_at,status:row.status}:null;
  }
  startTrigger(accountId:string,cycleKey:string,oldReset:string):boolean {
    return this.raw.prepare(`INSERT OR IGNORE INTO trigger_history(account_id,cycle_key,old_reset,trigger_started_at,status)
      VALUES(?,?,?,?, 'TRIGGERING')`).run(accountId,cycleKey,oldReset,new Date().toISOString()).changes===1;
  }
  updateTrigger(accountId:string,cycleKey:string,patch:{status:string;messageSentAt?:string;newReset?:string;conversationUrl?:string;error?:string;completedAt?:string}):void {
    this.raw.prepare(`UPDATE trigger_history SET status=@status,
      message_sent_at=COALESCE(@messageSentAt,message_sent_at),new_reset=COALESCE(@newReset,new_reset),
      conversation_url=COALESCE(@conversationUrl,conversation_url),error=COALESCE(@error,error),
      completed_at=COALESCE(@completedAt,completed_at) WHERE account_id=@accountId AND cycle_key=@cycleKey`)
      .run({accountId,cycleKey,messageSentAt:null,newReset:null,conversationUrl:null,error:null,completedAt:null,...patch});
  }
}

function mapAccount(r: Record<string, unknown>): Account {
  return {
    id:r.id as string, name:r.name as string, profilePath:r.profile_path as string,
    timezone:r.timezone as string, enabled:Boolean(r.enabled), status:r.status as AccountStatus,
    fiveHourReset:r.five_hour_reset as string|null, fiveHourRaw:r.five_hour_raw as string|null,
    weeklyReset:r.weekly_reset as string|null, weeklyRaw:r.weekly_raw as string|null,
    lastWorkChatUrl:r.last_work_chat_url as string|null, lastUsageCheckAt:r.last_usage_check_at as string|null,
    lastTriggerAt:r.last_trigger_at as string|null, lastSuccessAt:r.last_success_at as string|null,
    lastError:r.last_error as string|null, failureCount:r.failure_count as number
  };
}
