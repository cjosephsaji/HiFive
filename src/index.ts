import { loadConfig } from "./config/config.js";
import { AppDatabase } from "./database/db.js";
import { TelegramService } from "./notifications/telegramService.js";
import { NotificationService } from "./notifications/notificationService.js";
import { CommandService } from "./notifications/commandService.js";
import { BrowserManager } from "./browser/browserManager.js";
import { AccountWorker } from "./scheduler/accountWorker.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { createServer } from "./api/server.js";
import { AuthService } from "./auth/authService.js";

const config=loadConfig();
const db=new AppDatabase(config.databasePath);
db.recoverInterruptedTriggers();
const telegram=new TelegramService(config.telegram);
const auth=new AuthService(db,telegram,config.portalSecret,config.telegram.otpChatId);
const notifications=new NotificationService(db,telegram,config.telegram);
const commands=new CommandService(db,telegram);
const browser=new BrowserManager(config.screenshotRoot);
const worker=new AccountWorker(db,browser,notifications,config.resetSafetySeconds);
const scheduler=new Scheduler(db,worker,notifications,config.resetSafetySeconds);
const app=createServer(db,worker,browser,config,auth);
const server=app.listen(config.port,()=>console.log(JSON.stringify({event:"SERVER_STARTED",port:config.port})));
scheduler.start();commands.start();
function stop(){scheduler.stop();commands.stop();server.close(()=>{db.close();process.exit(0)});}
process.on("SIGTERM",stop);process.on("SIGINT",stop);
