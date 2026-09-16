import { loadConfig } from "./config/config.js";
import { AppDatabase } from "./database/db.js";
import { BrowserManager } from "./browser/browserManager.js";
import { readUsage } from "./browser/usagePage.js";
import { ensureWork } from "./browser/workMode.js";
import { findComposer } from "./browser/chatComposer.js";
import { AccountWorker } from "./scheduler/accountWorker.js";
import { TelegramService } from "./notifications/telegramService.js";
import { NotificationService } from "./notifications/notificationService.js";

const id=process.argv[process.argv.indexOf("--account")+1];
if(!id||id.startsWith("--"))throw new Error("Use --account account-001");
const config=loadConfig();const db=new AppDatabase(config.databasePath);
const account=db.account(id);if(!account)throw new Error("Unknown account");
const browser=new BrowserManager(config.screenshotRoot);
if(process.argv.includes("--send-hi")) {
  const notifications=new NotificationService(db,new TelegramService(config.telegram),config.telegram);
  const worker=new AccountWorker(db,browser,notifications,config.resetSafetySeconds);
  await worker.process(id);
  console.log(JSON.stringify({status:db.account(id)?.status}));
} else {
  const session=await browser.open(account);
  try {
    const usage=await readUsage(session.page,account.timezone);
    await session.page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded"});
    const work=await ensureWork(session.page);const composer=Boolean(await findComposer(session.page));
    const screenshot=await browser.screenshot(account,session.page,"diagnose");
    console.log(JSON.stringify({usage,work,composer,conversationUrl:session.page.url(),screenshot},null,2));
  } finally {await session.close();}
}
db.close();
