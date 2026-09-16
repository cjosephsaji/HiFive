import type { Page } from "playwright";
import { ensureWork, workActive } from "./workMode.js";
import { findComposer } from "./chatComposer.js";
import type { Account } from "../database/db.js";

export async function openWorkConversation(page:Page,account:Account):Promise<boolean> {
  if(account.lastWorkChatUrl && /^https:\/\/chatgpt\.com\/c\/[\w-]+$/.test(account.lastWorkChatUrl)) {
    await page.goto(account.lastWorkChatUrl,{waitUntil:"domcontentloaded"});
    if(await findComposer(page) && await workActive(page)) return true;
  }
  // Only reuse recent chats when their Work state can be verified after opening.
  await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded"});
  const links=await page.locator("a[href*='/c/']").evaluateAll(elements=>elements.slice(0,10).map(e=>(e as HTMLAnchorElement).href));
  for(const url of links) {
    if(!/^https:\/\/chatgpt\.com\/c\/[\w-]+$/.test(url)) continue;
    await page.goto(url,{waitUntil:"domcontentloaded"});
    if(await findComposer(page) && await workActive(page)) return true;
  }
  await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded"});
  return await ensureWork(page) && Boolean(await findComposer(page));
}
