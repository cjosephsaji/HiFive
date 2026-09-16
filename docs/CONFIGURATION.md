# Configuration

Copy `.env.example` to `.env`. Keep the populated file private and out of Git.

| Variable | Purpose | Default |
| --- | --- | --- |
| `TELEGRAM_ENABLED` | Enables Telegram delivery and portal OTP | `true` in example |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API credential | Required |
| `TELEGRAM_CHAT_ID` | Private administrator chat receiving OTP and alerts | Required |
| `TELEGRAM_ERROR_REMINDER_HOURS` | Interval before an unresolved alert is repeated | `12` |
| `TELEGRAM_COMMANDS_ENABLED` | Enables `/status`, `/accounts`, `/check`, `/logs` | `false` |
| `TELEGRAM_ADMIN_USER_ID` | Additional command restriction for group chats | Empty; portal OTP requires a private chat |
| `PORTAL_SECRET` | Secret used to hash one-time codes | Required, at least 32 characters |
| `SESSION_COOKIE_SECURE` | Send session cookie only over HTTPS | `true` |
| `DATABASE_PATH` | SQLite file path | `./data/app.sqlite` |
| `PROFILE_ROOT` | Chromium profile directory | `./data/profiles` |
| `SCREENSHOT_ROOT` | Diagnostic screenshot directory | `./data/screenshots` |
| `RESET_SAFETY_SECONDS` | Delay after a stored reset before triggering | `90` |
| `PORT` | Portal HTTP port inside the container | `3000` |

Docker Compose overrides the database, profile, and screenshot paths with `/data/...` paths mounted from the host. It binds ports 3000 and 6080 to server localhost.

`SESSION_COOKIE_SECURE=false` is only for access through an SSH tunnel to `http://localhost:3000`. Use `true` when the portal is behind HTTPS. A changed `.env` requires recreating the container, not merely restarting it.

## Telegram commands

Commands are optional and accepted only from the configured chat. `/check account-001` queues a Usage check; it never directly sends `HI`. The scheduler still applies normal reset and idempotency rules. Portal OTP always requires the private chat ID configured in `TELEGRAM_CHAT_ID`.
