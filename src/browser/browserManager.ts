import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import type { Account } from "../database/db.js";

export interface BrowserSession { context: BrowserContext; page: Page; close(): Promise<void> }
export class BrowserManager {
  constructor(private readonly screenshotRoot = "./data/screenshots") {}
  async open(account: Account, headless = true): Promise<BrowserSession> {
    await mkdir(account.profilePath,{recursive:true});
    const context = await chromium.launchPersistentContext(account.profilePath, {
      headless, args: ["--no-sandbox"], viewport:{width:1440,height:1000}
    });
    const page = context.pages()[0] ?? await context.newPage();
    page.setDefaultTimeout(15_000);
    return {context,page,close:()=>context.close()};
  }
  async screenshot(account: Account,page: Page,label: string): Promise<string> {
    const path = `${this.screenshotRoot}/${account.id}`;
    await mkdir(path,{recursive:true});
    const file = `${path}/${new Date().toISOString().replaceAll(":","-")}-${label.replace(/[^a-z0-9_-]/gi,"_")}.png`;
    await page.screenshot({path:file,fullPage:true}).catch(()=>undefined);
    return file;
  }
}
