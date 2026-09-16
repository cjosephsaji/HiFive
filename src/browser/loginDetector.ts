import type { Page } from "playwright";
import { selectors } from "./chatgptSelectors.js";

export async function isLoginRequired(page: Page): Promise<boolean> {
  if (/\/(auth|login|signin)(\/|\?|$)/i.test(page.url())) return true;
  for (const name of selectors.loginSignals) {
    if (await page.getByRole("button",{name}).first().isVisible().catch(()=>false)) return true;
    if (await page.getByRole("link",{name}).first().isVisible().catch(()=>false)) return true;
  }
  return false;
}
