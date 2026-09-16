# Deployment

HiFive runs as one Docker Compose service on a Linux server. The container includes Chromium, Xvfb, and noVNC. SQLite and Chromium profiles live on host-mounted directories so they survive container replacement.

## Prerequisites

- A Linux server with Docker Engine and the Compose plugin
- A private Telegram chat with your bot, and its numeric chat ID
- Enough disk space for a separate Chromium profile for each account
- SSH access for the noVNC tunnel

## First deployment

```bash
cp .env.example .env
openssl rand -hex 32
```

Put the generated value in `PORTAL_SECRET` in `.env`. Set `TELEGRAM_BOT_TOKEN` and your **private** `TELEGRAM_CHAT_ID`. Keep `.env` out of Git. Set `SESSION_COOKIE_SECURE=true` when the portal is served over HTTPS. For a localhost SSH tunnel only, set it to `false`.

```bash
docker compose up -d --build
docker compose exec app npm run setup-admin
```

The setup command prompts for a username and a password of at least 16 characters. It creates the first portal administrator and can only run once. The password is hashed in SQLite. Sign in to the portal with the password, then enter the Telegram code.

Compose binds both ports to server localhost. For private access:

```bash
ssh -L 3000:localhost:3000 -L 6080:localhost:6080 user@server
```

Open `http://localhost:3000` for the portal and `http://localhost:6080/vnc.html` for noVNC. If you change `.env`, recreate the container with `docker compose up -d --force-recreate`.

For public portal access, place port 3000 behind an HTTPS reverse proxy, keep `SESSION_COOKIE_SECURE=true`, and leave port 6080 bound to localhost. noVNC does not have its own password and must never be exposed publicly.

## Add the first account

1. Sign in to the portal and add `account-001`. It starts disabled.
2. Select **Open login browser** and use the noVNC window to log in to ChatGPT manually. Complete any 2FA or device verification yourself.
3. Select **Close login browser**.
4. Run **Diagnose** and check the Usage values, Work detection, composer detection, and screenshot.
5. Enable the account only after the diagnostic result is correct for the current ChatGPT interface.

The session is saved under `data/profiles/account-001/`. HiFive does not store ChatGPT passwords. Repeat these steps for each additional account.

## Persistent data and backups

Compose mounts these host paths:

| Path | Contents |
| --- | --- |
| `data/database/` | SQLite account state, trigger history, portal users, and sessions |
| `data/profiles/` | Chromium sessions for each account |
| `data/screenshots/` | Diagnostic screenshots |
| `data/logs/` | Xvfb and noVNC process logs |

Back up the database and profiles together while the container is stopped. Treat both as sensitive: the profiles contain authenticated ChatGPT browser state. Keep backups encrypted and access restricted. To restore, stop Compose, restore the directories and matching `.env`, then start Compose.

## Update and verify

```bash
git pull
docker compose up -d --build
docker compose logs --tail=100 app
```

The app has not been validated against your logged-in ChatGPT UI. UI changes can affect Usage and Work detection. Keep automatic triggering disabled until diagnostics pass after initial deployment or a relevant ChatGPT UI change.
