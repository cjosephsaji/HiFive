import { createInterface,emitKeypressEvents } from "node:readline";
import { loadConfig } from "./config/config.js";
import { AppDatabase } from "./database/db.js";
import { TelegramService } from "./notifications/telegramService.js";
import { AuthService } from "./auth/authService.js";

if(!process.stdin.isTTY)throw new Error("Run setup-admin in an interactive terminal");
const config=loadConfig();
const db=new AppDatabase(config.databasePath);
const auth=new AuthService(db,new TelegramService(config.telegram),config.portalSecret,config.telegram.chatId);
const username=await new Promise<string>(resolve=>{
  const rl=createInterface({input:process.stdin,output:process.stdout});
  rl.question("Admin username: ",answer=>{rl.close();resolve(answer.trim())});
});
const password=await hiddenPrompt("Admin password (at least 16 characters): ");
const confirm=await hiddenPrompt("Confirm password: ");
if(password!==confirm)throw new Error("Passwords do not match");
await auth.createFirstAdmin(username,password);
db.close();
process.stdout.write("Admin created. Sign in through the web portal and enter the Telegram code.\n");

function hiddenPrompt(label:string):Promise<string> {
  return new Promise((resolve,reject)=>{
    let value="";
    process.stdout.write(label);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onKey=(character:string,key:{name?:string;ctrl?:boolean})=>{
      if(key.ctrl&&key.name==="c") {cleanup();reject(new Error("Cancelled"));return;}
      if(key.name==="return"||key.name==="enter") {cleanup();process.stdout.write("\n");resolve(value);return;}
      if(key.name==="backspace") {value=value.slice(0,-1);return;}
      if(character && character>=" " && character!=="\u007f" && value.length<256)value+=character;
    };
    const cleanup=()=>{process.stdin.off("keypress",onKey);process.stdin.setRawMode(false);process.stdin.pause()};
    process.stdin.on("keypress",onKey);
  });
}
