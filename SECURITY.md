# Security

## Deployment boundary

The portal requires a password followed by a Telegram one-time code. Host it behind HTTPS and use `SESSION_COOKIE_SECURE=true`. Docker Compose binds the portal and noVNC to localhost. Keep noVNC on localhost and reach it only through an SSH tunnel; it has no separate password or portal session check.

The database, `.env`, and Chromium profiles are sensitive. A profile can contain an active ChatGPT session. Restrict file access, encrypt backups, and never commit these paths. HiFive does not store ChatGPT passwords or automate CAPTCHA, 2FA, or device checks.

## Authentication controls

Portal passwords are salted scrypt hashes. Telegram codes are random, hashed with `PORTAL_SECRET`, expire after five minutes, and are limited to five attempts. Sending is throttled. Portal session tokens are random and stored only as hashes in SQLite; the browser receives an `HttpOnly`, `SameSite=Strict` cookie. Mutating API calls require a CSRF token. Changing the password invalidates sessions.

Telegram commands are restricted to the configured chat. None can force `HI` or bypass the scheduler's reset-cycle check.

## Reporting a vulnerability

Do not put credentials, tokens, browser profiles, or exploit details in a public issue. Contact the repository owner privately through GitHub before publishing details.
