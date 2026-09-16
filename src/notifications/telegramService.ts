import type { TelegramConfig } from "../config/config.js";

interface TelegramResponse<T> { ok: boolean; result?: T; description?: string }
export interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string };
    from?: { id: number };
  };
}

export class TelegramService {
  constructor(private readonly config: TelegramConfig, private readonly fetcher: typeof fetch = fetch) {}
  get enabled(): boolean { return this.config.enabled; }
  get commandsEnabled(): boolean { return this.config.commandsEnabled; }
  isAuthorized(update: TelegramUpdate): boolean {
    const message = update.message;
    if (!message || String(message.chat.id) !== this.config.chatId) return false;
    // A group chat ID identifies the group, not the member issuing the command.
    if (message.chat.type !== "private" && !this.config.adminUserId) return false;
    return !this.config.adminUserId || String(message.from?.id) === this.config.adminUserId;
  }
  async send(text: string): Promise<void> {
    if (!this.config.enabled) return;
    await this.sendTo(this.config.chatId,text);
  }
  async sendTo(chatId:string,text:string):Promise<void> {
    if (!this.config.enabled || chatId!==this.config.chatId) throw new Error("Telegram destination unavailable");
    await this.call("sendMessage", { chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true }, 15_000);
  }
  async updates(offset: number, signal?: AbortSignal): Promise<TelegramUpdate[]> {
    if (!this.config.enabled || !this.config.commandsEnabled) return [];
    const result = await this.call<TelegramUpdate[]>("getUpdates", {
      offset, timeout: 25, allowed_updates: ["message"]
    }, 35_000, signal);
    return result;
  }
  private async call<T>(method: string, body: object, timeout: number, signal?: AbortSignal): Promise<T> {
    const response = await this.fetcher(`https://api.telegram.org/bot${this.config.botToken}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(timeout), ...(signal ? [signal] : [])])
    });
    if (!response.ok) throw new Error(`Telegram ${method} HTTP ${response.status}`);
    const payload = await response.json() as TelegramResponse<T>;
    if (!payload.ok || payload.result === undefined) throw new Error(`Telegram ${method} failed`);
    return payload.result;
  }
}
