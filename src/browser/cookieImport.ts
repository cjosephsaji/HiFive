import type { Cookie } from "playwright";

const allowedHosts = ["chatgpt.com", "openai.com"];

export function parseCookieExport(input: string): Cookie[] {
  if (Buffer.byteLength(input, "utf8") > 2_000_000) throw new Error("Cookie export is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(input); }
  catch { throw new Error("Expected a JSON cookie export"); }
  const entries = Array.isArray(parsed) ? parsed :
    parsed && typeof parsed === "object" && "cookies" in parsed ? (parsed as {cookies:unknown}).cookies : null;
  if (!Array.isArray(entries)) throw new Error("Expected a JSON array of cookies or an object with a cookies array");
  const cookies: Cookie[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const cookie = entry as Record<string, unknown>;
    if (typeof cookie.domain !== "string") continue;
    const host = cookie.domain.replace(/^\./, "").toLowerCase();
    if (!allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) continue;
    if (typeof cookie.name !== "string" || !cookie.name || typeof cookie.value !== "string") continue;
    const normalized: Cookie = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: typeof cookie.path === "string" && cookie.path.startsWith("/") ? cookie.path : "/",
      expires: -1,
      httpOnly: cookie.httpOnly === true,
      secure: cookie.secure === true,
      sameSite: "Lax"
    };
    const expires = cookie.expires ?? cookie.expirationDate;
    if (typeof expires === "number" && Number.isFinite(expires) && expires > 0) normalized.expires = expires;
    const sameSite = String(cookie.sameSite ?? "").toLowerCase();
    if (sameSite === "strict") normalized.sameSite = "Strict";
    else if (sameSite === "none" || sameSite === "no_restriction") normalized.sameSite = "None";
    cookies.push(normalized);
  }
  if (!cookies.length) throw new Error("No ChatGPT or OpenAI cookies found in the export");
  if (cookies.length > 500) throw new Error("Cookie export contains too many matching cookies");
  return cookies;
}
