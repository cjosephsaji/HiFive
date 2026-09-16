# HiFive

HiFive monitors ChatGPT Work reset times for multiple accounts, sends `HI` when an account is due, verifies the new reset, and alerts an administrator through Telegram. It includes a web portal with password and Telegram code sign-in.

## Start here

1. Read [Deployment](docs/DEPLOYMENT.md) for server setup and the first admin account.
2. Read [Configuration](docs/CONFIGURATION.md) for every environment setting.
3. Read [Operations](docs/OPERATIONS.md) for account login, monitoring, and recovery.
4. Read [Security](SECURITY.md) before exposing the portal through a reverse proxy.

Node.js, TypeScript, Playwright, Chromium, SQLite, an authenticated web portal, and Telegram alerts. Each account has its own persistent browser profile. The scheduler sends `HI` only after a stored reset time plus the configured safety delay, verifies a new user message in Work mode, and checks Usage again. A trigger record is written **before** submission, so an uncertain or interrupted attempt is never retried automatically for the same reset cycle.

**Current validation limit:** ChatGPT changes its UI. The Usage and Work selectors in this repository are conservative starting points and have not been verified against your logged-in account. Use the diagnostic flow before enabling automation. A failed Work check does not send `HI`.

## Quick deployment outline

1. Create a Telegram bot and start a **private** chat with it. Copy `.env.example` to `.env`; set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` for alerts, and your private, positive numeric `TELEGRAM_OTP_CHAT_ID` for portal login codes. Alerts may go to a group; login codes must go to the private chat. Set `PORTAL_SECRET` to a random secret such as the output of `openssl rand -hex 32`. Commands additionally require `TELEGRAM_COMMANDS_ENABLED=true`.
2. Run `docker compose up -d --build` on a Linux VPS, then `docker compose exec app npm run setup-admin`. Enter an admin username and a password of at least 16 characters in the interactive terminal. The password is stored only as a salted scrypt hash. The setup command works only once.
3. The portal and noVNC bind to localhost on ports 3000 and 6080. For access over SSH, set `SESSION_COOKIE_SECURE=false` in `.env` and recreate the container with `docker compose up -d --force-recreate`, then use `ssh -L 3000:localhost:3000 -L 6080:localhost:6080 user@server`. Open `http://localhost:3000` and `http://localhost:6080/vnc.html`. For public access, put the portal behind an HTTPS reverse proxy and leave `SESSION_COOKIE_SECURE=true`. **Never expose port 6080 publicly**; its VNC service has no password and must stay behind the SSH tunnel.
4. Sign in to the portal with the admin password, then enter the six-digit code sent to Telegram. Add `account-001`, open its login browser, and log in to ChatGPT manually through noVNC. Close the login browser from the portal when finished. The Chromium profile persists in `data/profiles/account-001/` across container restarts; ChatGPT passwords are not saved in SQLite.
5. Run **Diagnose** in the dashboard. Inspect the Usage timestamps, Work detection, composer detection, and screenshot under `data/screenshots/account-001/`. The CLI equivalent is `docker compose exec app node dist/diagnose.js --account account-001`.
6. Once the selectors have been verified against the current ChatGPT UI, enable the account in the dashboard. The scheduler checks due accounts about once per minute. To add more accounts, repeat steps 4–6; each account gets its own profile.
7. View account events using **Logs** or Telegram `/logs account-001`. Docker logs are available through `docker compose logs app`. The portal can edit account names/timezones, enable or disable accounts, and delete an account. Deletion also removes that account's saved Chromium profile and screenshots.

`docker compose exec app node dist/diagnose.js --account account-001 --send-hi` runs the **normal** due and idempotency checks. It does not force a send. The dashboard's manual trigger behaves the same way. An account starts disabled, and a new account's first Usage check stores its reset time without sending a message.

## Telegram

Portal OTP codes are valid for five minutes and five verification attempts. Sends are limited to one per minute and three per hour per admin. Password attempts are throttled by username and IP. Portal sessions use server-stored tokens in `HttpOnly`, `SameSite=Strict` cookies, with CSRF protection. Changing the portal password invalidates all sessions.

Alerts are sent for login expiry, unavailable Work mode, Usage parse failure, message send failure, pending or failed reset verification, successful `HI`, Chromium crash, repeated network failures, and automatic account disablement. Normal scheduler ticks send nothing. Error alerts are stored in SQLite and sent once when the unresolved event changes; the same event is sent again only after `TELEGRAM_ERROR_REMINDER_HOURS`. A successful cycle notification is unique per account and old reset timestamp.

Optional commands:

- `/status` — account summary and next reset
- `/accounts` — configured account states
- `/check account-001` — queue an immediate Usage check; it never directly sends `HI`
- `/logs account-001` — ten recent sanitized event records

Commands are accepted only from `TELEGRAM_CHAT_ID`. In a group, set `TELEGRAM_ADMIN_USER_ID` to the administrator's numeric user ID. Portal OTP uses `TELEGRAM_OTP_CHAT_ID` and requires a private chat. No command bypasses the reset or idempotency checks. The bot does not return cookies, credentials, environment values, browser profiles, or raw Chromium diagnostics.

The application calls `NotificationService`, which owns deduplication and formatting. `TelegramService` is only the delivery adapter; another provider can be added without changing the scheduler.

## Safety and recovery

The scheduler keeps account locks in SQLite and records a trigger attempt before any send. If a process stops after `HI` might have been submitted, that reset cycle stays blocked from automatic resend. Pending verification is checked again without sending. After 30 minutes with an unchanged reset, it becomes `RESET_DID_NOT_CHANGE`. Review the conversation and Usage manually before taking any action.

Accounts with five consecutive errors are disabled. The dashboard lets an administrator re-enable an account after inspection. Login remains manual; CAPTCHA and 2FA are never automated.

Run `npm ci && npm test` for the parser, notifications, portal sign-in/OTP, account CRUD, and authorization tests. Run `npm run build` for a TypeScript check.
