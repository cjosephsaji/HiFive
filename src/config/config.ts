import "dotenv/config";

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
  otpChatId: string;
  errorReminderHours: number;
  commandsEnabled: boolean;
  adminUserId: string | null;
}

export interface AppConfig {
  telegram: TelegramConfig; databasePath: string; profileRoot: string; screenshotRoot: string;
  resetSafetySeconds: number; portalSecret: string; secureCookies: boolean; port: number;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const enabled = env.TELEGRAM_ENABLED === "true";
  const commandsEnabled = env.TELEGRAM_COMMANDS_ENABLED === "true";
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = env.TELEGRAM_CHAT_ID?.trim() ?? "";
  const otpChatId = env.TELEGRAM_OTP_CHAT_ID?.trim() || chatId;
  const hours = Number(env.TELEGRAM_ERROR_REMINDER_HOURS ?? "12");
  if (!Number.isFinite(hours) || hours <= 0) throw new Error("TELEGRAM_ERROR_REMINDER_HOURS must be positive");
  if (enabled && (!botToken || !chatId)) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required when Telegram is enabled");
  if (commandsEnabled && !enabled) throw new Error("TELEGRAM_COMMANDS_ENABLED requires TELEGRAM_ENABLED=true");
  const resetSafetySeconds=Number(env.RESET_SAFETY_SECONDS??"90");
  const port=Number(env.PORT??"3000");
  if(!Number.isInteger(resetSafetySeconds)||resetSafetySeconds<0)throw new Error("Invalid RESET_SAFETY_SECONDS");
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid PORT");
  return {
    telegram: {
      enabled, botToken, chatId, otpChatId, commandsEnabled,
      errorReminderHours: hours,
      adminUserId: env.TELEGRAM_ADMIN_USER_ID?.trim() || null
    },
    databasePath: env.DATABASE_PATH || "./data/app.sqlite",
    profileRoot: env.PROFILE_ROOT || "./data/profiles",
    screenshotRoot: env.SCREENSHOT_ROOT || "./data/screenshots",
    resetSafetySeconds,port,portalSecret:env.PORTAL_SECRET?.trim()??"",
    secureCookies:env.SESSION_COOKIE_SECURE!=="false"
  };
}
