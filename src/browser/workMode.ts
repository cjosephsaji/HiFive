import type { Page } from "playwright";

export async function workActive(page:Page):Promise<boolean> {
  const selected=page.getByRole("button",{name:/^work$/i,pressed:true});
  if (await selected.first().isVisible().catch(()=>false)) return true;
  const indicator=page.locator("[aria-current='true'],[data-state='active'],[aria-selected='true']").filter({hasText:/^work$/i});
  return indicator.first().isVisible().catch(()=>false);
}
export async function ensureWork(page:Page):Promise<boolean> {
  if(await workActive(page)) return true;
  const work=page.getByRole("button",{name:/^work$/i}).first();
  if (!await work.isVisible().catch(()=>false)) return false;
  await work.click();
  return workActive(page);
}
