# Architecture

HiFive keeps browser automation, scheduling, persistence, the portal, and notifications in separate modules.

```text
Portal/API or Telegram command
            |
            v
       SQLite account state
            |
            v
       Scheduler + account lock
            |
            v
  Isolated Chromium profile
            |
            v
 Usage -> Work -> HI -> Usage verification
            |
            v
  Trigger history + notification service -> Telegram
```

| Directory | Responsibility |
| --- | --- |
| `src/browser/` | Persistent Chromium profiles and conservative ChatGPT UI detection |
| `src/scheduler/` | Due checks, account locks, trigger, and verification flow |
| `src/database/` | SQLite schema and account/trigger records |
| `src/auth/` | Portal password, Telegram OTP, and server-side sessions |
| `src/api/` and `public/` | Authenticated HTTP API and portal UI |
| `src/notifications/` | Generic alert deduplication, Telegram delivery, and commands |

The worker writes a `trigger_history` row before attempting `HI`. The account and reset timestamp form a unique cycle key. If submission is uncertain, the worker does not retry that cycle. On restart, an interrupted attempt becomes `RESET_VERIFICATION_PENDING`. The worker can re-read Usage later without resending. A confirmed changed reset becomes `SUCCESS` and starts a new cycle.

Error notification state is stored in SQLite. One unresolved event sends one alert; another is allowed when the status changes or `TELEGRAM_ERROR_REMINDER_HOURS` passes. Normal one-minute scheduler checks do not alert.

Each account has a separate `launchPersistentContext` directory. These directories carry the saved ChatGPT sessions across restarts. Portal user passwords are salted scrypt hashes; Telegram OTP hashes and portal session hashes are stored in SQLite. ChatGPT usernames and passwords are not stored.

All ChatGPT selectors are centralized in `src/browser/chatgptSelectors.ts` or their dedicated browser modules. Changes to the ChatGPT UI must be checked with the diagnostic command before automatic triggering is enabled.
