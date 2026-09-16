import { createHash,createHmac,randomBytes,randomInt,randomUUID,scrypt,timingSafeEqual } from "node:crypto";
import type { AppDatabase } from "../database/db.js";
import type { TelegramService } from "../notifications/telegramService.js";

interface UserRow { id:string;username:string;password_salt:string;password_hash:string;telegram_chat_id:string }
interface ChallengeRow { id:string;user_id:string;code_hash:string;expires_at:string;attempts:number }
interface SessionRow { user_id:string;username:string;csrf_token:string;expires_at:string }
const SESSION_MS=12*60*60_000;

export class AuthService {
  constructor(private readonly db:AppDatabase,private readonly telegram:TelegramService,
    private readonly secret:string,private readonly chatId:string) {
    if(secret.length<32 || secret==="replace-with-64-random-hex-characters")
      throw new Error("PORTAL_SECRET must be a random secret of at least 32 characters");
    if(!telegram.enabled || !/^[1-9]\d*$/.test(chatId))
      throw new Error("Portal OTP requires Telegram enabled with a private TELEGRAM_OTP_CHAT_ID");
    this.db.raw.prepare("UPDATE portal_users SET telegram_chat_id=? WHERE telegram_chat_id<>?").run(chatId,chatId);
  }
  async createFirstAdmin(username:string,password:string):Promise<void> {
    if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||password.length<16||password.length>256)
      throw new Error("Username must be 3-40 safe characters; password must be 16-256 characters");
    const salt=randomBytes(24).toString("hex");
    const hash=await passwordHash(password,salt);
    this.db.raw.transaction(()=>{
      const count=(this.db.raw.prepare("SELECT count(*) AS n FROM portal_users").get() as {n:number}).n;
      if(count)throw new Error("An admin already exists");
      this.db.raw.prepare("INSERT INTO portal_users(id,username,password_salt,password_hash,telegram_chat_id,created_at) VALUES(?,?,?,?,?,?)")
        .run(randomUUID(),username,salt,hash,this.chatId,new Date().toISOString());
    })();
  }
  async begin(username:string,password:string,ip:string):Promise<string|null> {
    const normalized=username.trim().slice(0,100);
    const keys=[`account:${digest(normalized.toLowerCase())}`,`ip:${digest(ip)}`];
    this.db.raw.prepare("DELETE FROM portal_challenges WHERE expires_at<?").run(new Date().toISOString());
    this.db.raw.prepare("DELETE FROM portal_sessions WHERE expires_at<?").run(new Date().toISOString());
    this.db.raw.prepare("DELETE FROM portal_otp_sends WHERE sent_at<?").run(new Date(Date.now()-60*60_000).toISOString());
    for(const key of keys) {
      const blocked=this.db.raw.prepare("SELECT blocked_until FROM portal_login_attempts WHERE key=?").get(key) as {blocked_until:string|null}|undefined;
      if(blocked?.blocked_until && Date.parse(blocked.blocked_until)>Date.now())return null;
    }
    const user=this.db.raw.prepare("SELECT * FROM portal_users WHERE username=?").get(normalized) as UserRow|undefined;
    const calculated=await passwordHash(password,user?.password_salt??"unknown-user-salt");
    const valid=Boolean(user && equalHex(calculated,user.password_hash));
    if(!valid) {
      for(const key of keys) {
        const failures=((this.db.raw.prepare("SELECT failures FROM portal_login_attempts WHERE key=?").get(key) as {failures:number}|undefined)?.failures??0)+1;
        const threshold=key.startsWith("ip:")?30:5;
        const wait=failures>=threshold?Math.min(60,5*2**Math.min(failures-threshold,4))*60_000:0;
        this.db.raw.prepare(`INSERT INTO portal_login_attempts(key,failures,blocked_until) VALUES(?,?,?)
          ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until`)
          .run(key,failures,wait?new Date(Date.now()+wait).toISOString():null);
      }
      return null;
    }
    for(const key of keys)this.db.raw.prepare("DELETE FROM portal_login_attempts WHERE key=?").run(key);
    const sends=this.db.raw.prepare("SELECT count(*) AS n,max(sent_at) AS latest FROM portal_otp_sends WHERE user_id=? AND sent_at>?")
      .get(user!.id,new Date(Date.now()-60*60_000).toISOString()) as {n:number;latest:string|null};
    if(sends.n>=3||(sends.latest&&Date.now()-Date.parse(sends.latest)<60_000))return null;
    const latest=this.db.raw.prepare("SELECT created_at FROM portal_challenges WHERE user_id=? ORDER BY created_at DESC LIMIT 1")
      .get(user!.id) as {created_at:string}|undefined;
    if(latest && Date.now()-Date.parse(latest.created_at)<60_000)return null;
    const id=randomUUID();const code=randomInt(0,1_000_000).toString().padStart(6,"0");
    const now=new Date();
    this.db.raw.transaction(()=>{
      this.db.raw.prepare("DELETE FROM portal_challenges WHERE user_id=?").run(user!.id);
      this.db.raw.prepare("INSERT INTO portal_challenges(id,user_id,code_hash,created_at,expires_at) VALUES(?,?,?,?,?)")
        .run(id,user!.id,this.codeHash(id,code),now.toISOString(),new Date(now.getTime()+5*60_000).toISOString());
    })();
    try {
      await this.telegram.sendTo(this.chatId,`Portal login code: ${code}\nExpires in 5 minutes. If you did not request this, change your portal password.`);
      this.db.raw.prepare("INSERT INTO portal_otp_sends(user_id,sent_at) VALUES(?,?)").run(user!.id,new Date().toISOString());
    }
    catch {this.db.raw.prepare("DELETE FROM portal_challenges WHERE id=?").run(id);return null;}
    return id;
  }
  verify(challengeId:string,code:string):{token:string;csrf:string;username:string}|null {
    if(!/^[0-9]{6}$/.test(code)||!isUuid(challengeId))return null;
    return this.db.raw.transaction(()=>{
      const challenge=this.db.raw.prepare("SELECT * FROM portal_challenges WHERE id=?").get(challengeId) as ChallengeRow|undefined;
      if(!challenge||challenge.attempts>=5||Date.parse(challenge.expires_at)<Date.now())return null;
      this.db.raw.prepare("UPDATE portal_challenges SET attempts=attempts+1 WHERE id=?").run(challengeId);
      if(!equalHex(this.codeHash(challengeId,code),challenge.code_hash))return null;
      this.db.raw.prepare("DELETE FROM portal_challenges WHERE id=?").run(challengeId);
      const user=this.db.raw.prepare("SELECT username FROM portal_users WHERE id=?").get(challenge.user_id) as {username:string};
      const token=randomBytes(32).toString("base64url");const csrf=randomBytes(24).toString("base64url");
      this.db.raw.prepare("INSERT INTO portal_sessions(token_hash,user_id,csrf_token,created_at,expires_at) VALUES(?,?,?,?,?)")
        .run(digest(token),challenge.user_id,csrf,new Date().toISOString(),new Date(Date.now()+SESSION_MS).toISOString());
      return {token,csrf,username:user.username};
    })();
  }
  session(token:string):{userId:string;username:string;csrf:string}|null {
    if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))return null;
    const row=this.db.raw.prepare(`SELECT s.user_id,u.username,s.csrf_token,s.expires_at FROM portal_sessions s
      JOIN portal_users u ON u.id=s.user_id WHERE s.token_hash=?`).get(digest(token)) as SessionRow|undefined;
    if(!row||Date.parse(row.expires_at)<Date.now())return null;
    return {userId:row.user_id,username:row.username,csrf:row.csrf_token};
  }
  logout(token:string):void {if(token)this.db.raw.prepare("DELETE FROM portal_sessions WHERE token_hash=?").run(digest(token));}
  csrfValid(expected:string,given:string):boolean {
    const a=Buffer.from(expected);const b=Buffer.from(given);
    return a.length===b.length && timingSafeEqual(a,b);
  }
  async changePassword(userId:string,current:string,next:string):Promise<boolean> {
    if(next.length<16||next.length>256)return false;
    const user=this.db.raw.prepare("SELECT * FROM portal_users WHERE id=?").get(userId) as UserRow|undefined;
    if(!user||!equalHex(await passwordHash(current,user.password_salt),user.password_hash))return false;
    const salt=randomBytes(24).toString("hex");const hash=await passwordHash(next,salt);
    this.db.raw.transaction(()=>{
      this.db.raw.prepare("UPDATE portal_users SET password_salt=?,password_hash=? WHERE id=?").run(salt,hash,userId);
      this.db.raw.prepare("DELETE FROM portal_sessions WHERE user_id=?").run(userId);
    })();
    return true;
  }
  private codeHash(id:string,code:string):string {return createHmac("sha256",this.secret).update(`${id}:${code}`).digest("hex");}
}
function digest(value:string):string{return createHash("sha256").update(value).digest("hex");}
function isUuid(value:string):boolean{return /^[a-f0-9-]{36}$/i.test(value);}
function equalHex(a:string,b:string):boolean {
  const left=Buffer.from(a,"hex");const right=Buffer.from(b,"hex");
  return left.length===right.length && timingSafeEqual(left,right);
}
async function passwordHash(password:string,salt:string):Promise<string> {
  return new Promise((resolve,reject)=>scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024},(error,key)=>
    error?reject(error):resolve(key.toString("hex"))));
}
