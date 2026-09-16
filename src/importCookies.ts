import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { loadConfig } from "./config/config.js";
import { AppDatabase } from "./database/db.js";
import { parseCookieExport } from "./browser/cookieImport.js";

const flagIndex = process.argv.indexOf("--account");
const accountId = process.argv[flagIndex + 1];
if (flagIndex < 0 || !accountId || accountId.startsWith("--") || process.stdin.isTTY)
  throw new Error("Use: node dist/importCookies.js --account account-001 < cookies.json");

const cookies = parseCookieExport(readFileSync(0, "utf8"));
const config = loadConfig();
const db = new AppDatabase(config.databasePath);
const owner = randomUUID();
let locked = false;
try {
  const account = db.account(accountId);
  if (!account) throw new Error("Unknown account ID");
  if (account.enabled) throw new Error("Disable the account in the portal before importing cookies");
  locked = db.lock(accountId, owner, 5 * 60_000);
  if (!locked) throw new Error("Account browser is busy. Close its login browser and try again");
  const context = await chromium.launchPersistentContext(account.profilePath, {
    headless: true, args: ["--no-sandbox"], viewport: {width: 1440, height: 1000}
  });
  try { await context.addCookies(cookies); }
  catch { throw new Error("Cookie import failed. Check the export format and try again"); }
  finally { await context.close(); }
  db.event(accountId, "SESSION_COOKIES_IMPORTED", "Administrator imported browser cookies locally");
  console.log(`Imported ${cookies.length} ChatGPT/OpenAI cookies for ${accountId}. Run Diagnose before enabling the account.`);
} finally {
  if (locked) db.unlock(accountId, owner);
  db.close();
}
