import type { Page } from "playwright";
import { DateTime } from "luxon";
import { isLoginRequired } from "./loginDetector.js";

export type ParsedReset = {raw:string;timestamp:string};
export interface UsageResult {fiveHour:ParsedReset;weekly:ParsedReset|null}
export class UsageError extends Error { constructor(readonly code:"LOGIN_REQUIRED"|"USAGE_PAGE_NOT_FOUND"|"USAGE_PARSE_FAILED",message:string){super(message)} }

export async function readUsage(page: Page,timezone: string): Promise<UsageResult> {
  await page.goto("https://chatgpt.com/",{waitUntil:"domcontentloaded"});
  if(await isLoginRequired(page)) throw new UsageError("LOGIN_REQUIRED","ChatGPT login required");
  const settings = page.getByRole("button",{name:/settings|profile|account/i}).first();
  if (!await settings.isVisible().catch(()=>false)) throw new UsageError("USAGE_PAGE_NOT_FOUND","Settings control not found");
  await settings.click();
  const usage = page.getByRole("tab",{name:/usage/i}).or(page.getByRole("button",{name:/usage/i})).or(page.getByRole("link",{name:/usage/i})).first();
  if (!await usage.isVisible().catch(()=>false)) throw new UsageError("USAGE_PAGE_NOT_FOUND","Usage control not found");
  await usage.click();
  const text = await page.locator("body").innerText();
  const parsed = parseUsage(text,timezone);
  if (!parsed) throw new UsageError("USAGE_PARSE_FAILED","5-hour reset could not be parsed");
  return parsed;
}

export function parseUsage(text:string,timezone:string,now=DateTime.now().setZone(timezone)):UsageResult|null {
  if (!now.isValid) return null;
  const five = extractNear(text,/(?:5[ -]?hour(?: usage)? limit)/i);
  if (!five) return null;
  const fiveHour=parseReset(five,timezone,now);
  if (!fiveHour) return null;
  const weeklyRaw=extractNear(text,/(?:weekly(?: usage)? limit)/i);
  return {fiveHour,weekly:weeklyRaw ? parseReset(weeklyRaw,timezone,now) : null};
}
function extractNear(text:string,label:RegExp):string|null {
  const match=label.exec(text);
  if (!match) return null;
  const slice=text.slice(match.index+match[0].length,match.index+match[0].length+180);
  const reset=/resets?\s+(?:(?:on|at)\s+)?((?:[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+\d{4})?,?\s+)?\d{1,2}:\d{2}\s*[AP]M)/i.exec(slice);
  return reset?.[1]?.trim() ?? null;
}
function parseReset(raw:string,timezone:string,now:DateTime):ParsedReset|null {
  const full=/^[A-Za-z]/.test(raw);
  let parsed:DateTime;
  if (full) {
    parsed=DateTime.fromFormat(raw,"MMM d, yyyy, h:mm a",{zone:timezone,locale:"en-US"});
    if (!parsed.isValid) parsed=DateTime.fromFormat(raw,"MMM d, h:mm a",{zone:timezone,locale:"en-US"}).set({year:now.year});
  } else {
    parsed=DateTime.fromFormat(raw.replace(/\s+/g," "),"h:mm a",{zone:timezone,locale:"en-US"})
      .set({year:now.year,month:now.month,day:now.day});
    if (parsed.isValid && parsed < now.minus({minutes:5})) parsed=parsed.plus({days:1});
  }
  return parsed.isValid ? {raw,timestamp:parsed.toUTC().toISO()!} : null;
}
