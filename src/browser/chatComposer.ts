import type { Locator,Page } from "playwright";
import { selectors } from "./chatgptSelectors.js";

export async function findComposer(page:Page):Promise<Locator|null> {
  for (const selector of selectors.composers) {
    const loc=page.locator(selector).filter({visible:true});
    if (await loc.count()===1) return loc;
  }
  return null;
}
export async function sendHi(page:Page):Promise<boolean> {
  const composer=await findComposer(page);
  if(!composer) return false;
  const before=await countHi(page);
  await composer.fill("HI");
  const send=page.getByRole("button",{name:/^send$|send message/i}).first();
  if(await send.isVisible().catch(()=>false)) await send.click();
  else await composer.press("Enter");
  await page.waitForTimeout(700);
  for(let n=0;n<10;n++) {
    if(await countHi(page)>before) return true;
    await page.waitForTimeout(1000);
  }
  return false;
}
async function countHi(page:Page):Promise<number> {
  for(const selector of selectors.userMessages) {
    const count=await page.locator(selector).filter({hasText:/^HI$/}).count();
    if(count) return count;
  }
  return 0;
}
