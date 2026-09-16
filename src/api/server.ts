import express from "express";
import { randomUUID } from "node:crypto";
import { resolve,sep,dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rm } from "node:fs/promises";
import { DateTime } from "luxon";
import type { AppConfig } from "../config/config.js";
import type { AppDatabase } from "../database/db.js";
import type { BrowserManager,BrowserSession } from "../browser/browserManager.js";
import type { AccountWorker } from "../scheduler/accountWorker.js";
import type { AuthService } from "../auth/authService.js";
import { readUsage } from "../browser/usagePage.js";
import { ensureWork } from "../browser/workMode.js";
import { findComposer } from "../browser/chatComposer.js";

const assets=resolve(dirname(fileURLToPath(import.meta.url)),"../../public");
type AuthRequest=express.Request & {portalSession?:{userId:string;username:string;csrf:string};portalToken?:string};

export function createServer(db:AppDatabase,worker:AccountWorker,browser:BrowserManager,config:AppConfig,auth:AuthService) {
  const app=express();
  app.disable("x-powered-by");
  app.use((_req,res,next)=>{
    res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Referrer-Policy","no-referrer");
    res.setHeader("Cache-Control","no-store");
    next();
  });
  app.use(express.json({limit:"16kb"}));
  app.use("/assets",express.static(assets,{index:false}));
  const loginSessions=new Map<string,{owner:string;session:BrowserSession;timer:NodeJS.Timeout}>();
  const cookieName=config.secureCookies?"__Host-portal_session":"portal_session";
  const getSession=(req:AuthRequest)=>{
    const token=readCookie(req,cookieName);
    if(!token)return null;
    req.portalToken=token;
    return auth.session(token);
  };
  app.get("/",(_req,res)=>res.sendFile(resolve(assets,"index.html")));
  app.post("/api/auth/login",async(req,res)=>{
    const {username,password}=req.body??{};
    if(typeof username!=="string"||typeof password!=="string"||username.length>100||password.length>256){res.status(401).json({error:"Invalid credentials or login unavailable"});return;}
    const result=await auth.begin(username,password,req.ip??"unknown");
    if(result.kind==="invalid"){res.status(401).json({error:"Invalid credentials or login unavailable"});return;}
    if(result.kind==="rate_limited"){
      res.setHeader("Retry-After",String(result.retryAfterSeconds));
      res.status(429).json({error:`Too many login codes requested. Try again in ${Math.ceil(result.retryAfterSeconds/60)} minute(s).`});return;
    }
    if(result.kind==="delivery_failed"){
      res.status(503).json({error:"Telegram could not deliver the login code. Check the configured bot and private chat, then try again."});return;
    }
    res.json({challengeId:result.challengeId});
  });
  app.post("/api/auth/verify",(req,res)=>{
    const {challengeId,code}=req.body??{};
    if(typeof challengeId!=="string"||typeof code!=="string"){res.status(401).json({error:"Invalid or expired code"});return;}
    const result=auth.verify(challengeId,code);
    if(!result){res.status(401).json({error:"Invalid or expired code"});return;}
    res.cookie(cookieName,result.token,{httpOnly:true,secure:config.secureCookies,sameSite:"strict",path:"/",maxAge:12*60*60_000});
    res.json({username:result.username,csrf:result.csrf});
  });
  app.get("/api/auth/me",(req:AuthRequest,res)=>{
    const session=getSession(req);
    if(!session){res.status(401).json({error:"Login required"});return;}
    res.json({username:session.username,csrf:session.csrf});
  });
  app.use("/api",(req:AuthRequest,res,next)=>{
    const session=getSession(req);
    if(!session){res.status(401).json({error:"Login required"});return;}
    req.portalSession=session;
    if(!["GET","HEAD","OPTIONS"].includes(req.method)&&!auth.csrfValid(session.csrf,req.header("x-csrf-token")??"")){
      res.status(403).json({error:"Invalid CSRF token"});return;
    }
    next();
  });
  app.post("/api/auth/logout",(req:AuthRequest,res)=>{
    auth.logout(req.portalToken??"");
    res.clearCookie(cookieName,{httpOnly:true,secure:config.secureCookies,sameSite:"strict",path:"/"});
    res.json({ok:true});
  });
  app.post("/api/auth/password",async(req:AuthRequest,res)=>{
    const {currentPassword,newPassword}=req.body??{};
    if(typeof currentPassword!=="string"||typeof newPassword!=="string"||!await auth.changePassword(req.portalSession!.userId,currentPassword,newPassword)){
      res.status(400).json({error:"Password not changed"});return;
    }
    res.clearCookie(cookieName,{httpOnly:true,secure:config.secureCookies,sameSite:"strict",path:"/"});
    res.json({ok:true,message:"Password changed; sign in again"});
  });
  app.get("/api/accounts",(_req,res)=>res.json(db.accounts().map(publicAccount)));
  app.post("/api/accounts",(req,res)=>{
    const {id,name,timezone="Asia/Kolkata"}=req.body??{};
    if(!validId(id)){res.status(400).json({field:"id",error:"Account ID must start with account- and contain 1–40 lowercase letters, numbers, or hyphens."});return;}
    if(!validName(name)){res.status(400).json({field:"name",error:"Display name must contain 1–100 characters."});return;}
    if(!validZone(timezone)){res.status(400).json({field:"timezone",error:"Enter a valid timezone, such as Asia/Kolkata or UTC."});return;}
    const profilePath=resolve(config.profileRoot,id);
    if(!profilePath.startsWith(resolve(config.profileRoot)+sep)) {res.status(400).json({error:"Invalid account ID"});return;}
    if(db.account(id)){res.status(409).json({field:"id",error:"That account ID already exists."});return;}
    try {db.addAccount({id,name:name.trim(),profilePath,timezone,enabled:false});res.status(201).json(publicAccount(db.account(id)!));}
    catch (error) {console.error("Account creation failed",error);res.status(500).json({error:"Could not create account. Check the application logs."});}
  });
  app.patch("/api/accounts/:id",(req,res)=>{
    const account=db.account(req.params.id);
    if(!account){res.sendStatus(404);return;}
    const name=req.body?.name??account.name;
    const timezone=req.body?.timezone??account.timezone;
    if(!validName(name)||!validZone(timezone)){res.status(400).json({error:"Invalid account details"});return;}
    db.editAccount(account.id,name.trim(),timezone);
    res.json(publicAccount(db.account(account.id)!));
  });
  app.delete("/api/accounts/:id",async(req,res)=>{
    const account=db.account(req.params.id);
    if(!account){res.sendStatus(404);return;}
    if(req.body?.confirmId!==account.id){res.status(400).json({error:"Confirm the account ID"});return;}
    const owner=randomUUID();
    if(!db.lock(account.id,owner)){res.status(409).json({error:"Account browser busy"});return;}
    try {
      const root=resolve(config.profileRoot)+sep;
      if(!resolve(account.profilePath).startsWith(root))throw new Error("Unsafe profile path");
      await rm(account.profilePath,{recursive:true,force:true});
      await rm(resolve(config.screenshotRoot,account.id),{recursive:true,force:true});
      db.deleteAccount(account.id);
      res.json({deleted:account.id});
    } catch {db.unlock(account.id,owner);res.status(500).json({error:"Could not delete account and profile"});}
  });
  app.get("/api/accounts/:id/events",(req,res)=>{
    if(!db.account(req.params.id)) {res.sendStatus(404);return;}
    res.json(db.events(req.params.id,50));
  });
  app.post("/api/accounts/:id/check",(req,res)=>{
    if(!db.account(req.params.id)) {res.sendStatus(404);return;}
    res.status(202).json({queued:db.queueCheck(req.params.id)});
  });
  app.post("/api/accounts/:id/trigger",(req,res)=>{
    const account=db.account(req.params.id);
    if(!account||!account.enabled){res.status(400).json({error:"Account missing or disabled"});return;}
    if(!account.fiveHourReset || Date.now()<Date.parse(account.fiveHourReset)+config.resetSafetySeconds*1000 || db.triggerExists(account.id,account.fiveHourReset)){
      res.status(409).json({error:"Reset not due or cycle already attempted"});return;
    }
    void worker.process(account.id);
    res.status(202).json({status:"Queued through normal due/idempotency checks"});
  });
  app.post("/api/accounts/:id/enabled",(req,res)=>{
    const account=db.account(req.params.id);
    if(!account){res.sendStatus(404);return;}
    if(typeof req.body?.enabled!=="boolean"){res.sendStatus(400);return;}
    db.updateAccount(account.id,{enabled:req.body.enabled,failureCount:0,
      status:req.body.enabled && account.status==="DISABLED_REPEATED_ERRORS"?"WAITING":account.status});
    if(req.body.enabled && account.status==="DISABLED_REPEATED_ERRORS")db.resolveError(account.id);
    db.event(account.id,req.body.enabled?"ACCOUNT_ENABLED":"ACCOUNT_DISABLED","Admin changed enabled state");
    res.json(publicAccount(db.account(account.id)!));
  });
  app.post("/api/accounts/:id/login/open",async(req,res)=>{
    const account=db.account(req.params.id);
    if(!account){res.sendStatus(404);return;}
    if(loginSessions.has(account.id)){res.json({status:"already open"});return;}
    const owner=randomUUID();
    if(!db.lock(account.id,owner,30*60_000)){res.status(409).json({error:"Account browser busy"});return;}
    try {
      const session=await browser.open(account,false);
      await session.page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded"});
      const timer=setTimeout(()=>{
        loginSessions.delete(account.id);
        void session.close().finally(()=>db.unlock(account.id,owner));
      },25*60_000);
      loginSessions.set(account.id,{owner,session,timer});
      res.json({status:"open",instructions:"Use noVNC on port 6080, then close the login session."});
    } catch {
      db.unlock(account.id,owner);res.status(500).json({error:"Could not open visible browser"});
    }
  });
  app.post("/api/accounts/:id/login/close",async(req,res)=>{
    const held=loginSessions.get(req.params.id);
    if(!held){res.status(404).json({error:"No login session"});return;}
    loginSessions.delete(req.params.id);
    clearTimeout(held.timer);
    await held.session.close().catch(()=>undefined);
    db.unlock(req.params.id,held.owner);
    res.json({status:"closed"});
  });
  app.post("/api/accounts/:id/diagnose",async(req,res)=>{
    const account=db.account(req.params.id);
    if(!account){res.sendStatus(404);return;}
    const owner=randomUUID();
    if(!db.lock(account.id,owner)){res.status(409).json({error:"Account browser busy"});return;}
    let session:BrowserSession|undefined;
    try {
      session=await browser.open(account);
      const usage=await readUsage(session.page,account.timezone);
      await session.page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded"});
      const work=await ensureWork(session.page);
      const composer=Boolean(await findComposer(session.page));
      const screenshot=await browser.screenshot(account,session.page,"diagnose");
      res.json({usage,work,composer,conversationUrl:/^https:\/\/chatgpt\.com\/c\//.test(session.page.url())?session.page.url():null,screenshot});
    }catch{res.status(500).json({error:"Diagnosis failed; inspect account logs/screenshots"});}
    finally{await session?.close().catch(()=>undefined);db.unlock(account.id,owner);}
  });
  return app;
}

function publicAccount(a:NonNullable<ReturnType<AppDatabase["account"]>>) {
  const {profilePath,...safe}=a;return safe;
}
function readCookie(req:express.Request,name:string):string|null {
  const header=req.header("cookie")??"";
  for(const part of header.split(";")) {
    const [key,...value]=part.trim().split("=");
    if(key===name)return value.join("=");
  }
  return null;
}
function validId(value:unknown):value is string{return typeof value==="string"&&/^account-[a-z0-9-]{1,40}$/.test(value);}
function validName(value:unknown):value is string{return typeof value==="string"&&value.trim().length>0&&value.length<=100;}
function validZone(value:unknown):value is string{return typeof value==="string"&&DateTime.now().setZone(value).isValid;}
