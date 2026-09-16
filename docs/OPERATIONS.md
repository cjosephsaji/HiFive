# Operations

## Daily checks

Open the portal to review each account's status, next reset, last Usage check, and last successful `HI`. Telegram alerts report important state changes. `/status` and `/accounts` provide read-only summaries when Telegram commands are enabled.

## Expired ChatGPT session

For `LOGIN_REQUIRED`, open the account's login browser in the portal, connect through the localhost noVNC tunnel, complete the ChatGPT login manually, and close the login browser. Run **Diagnose** before re-enabling automatic work. Chromium profiles are account-specific and persist through restarts.

### Experimental cookie import

If manual login cannot complete, an administrator can try importing a JSON cookie export from their own browser. This is not a supported ChatGPT login method and may fail or be challenged again. The import tool accepts a JSON array of cookies or an object with a `cookies` array, imports only `chatgpt.com` and `openai.com` domains, and never prints cookie values. Do not send the export to anyone or upload it through the portal.

Keep the account **disabled** and close its login browser before importing. Copy the export to a temporary file on the server with access limited to the server administrator. Then run:

```bash
cd ~/HiFive
chmod 600 /tmp/hifive-cookies.json
sudo docker compose exec -T app node dist/importCookies.js --account account-001 < /tmp/hifive-cookies.json
rm -f /tmp/hifive-cookies.json
```

Delete the local export too when finished. Run **Diagnose** in the portal and enable the account only if it confirms a logged-in session and correct Usage and Work detection. Importing cookies cannot guarantee that the server browser will pass Cloudflare verification.

## Work or Usage detection failure

Inspect the account's portal events and screenshot in `data/screenshots/<account-id>/`. Run:

```bash
docker compose exec app node dist/diagnose.js --account account-001
```

This command reads Usage, checks Work and composer detection, and saves a screenshot. It does not send `HI`. ChatGPT UI changes may require code changes in `src/browser/`.

## Uncertain submission

`MESSAGE_SEND_FAILED`, `RESET_VERIFICATION_PENDING`, and `RESET_DID_NOT_CHANGE` are deliberately conservative. Inspect the actual conversation and Usage page manually. HiFive does not automatically resend `HI` for an attempted reset cycle, even after a restart.

## Manual actions

- **Check Usage** or `/check account-001`: queue a Usage check, without directly sending `HI`.
- **Trigger if due**: apply the same due and idempotency rules as the scheduler. It cannot force a repeated message.
- **Disable**: stop automatic processing for the account.
- **Delete**: remove the account record, event history, screenshots, and saved Chromium profile. This also removes the stored ChatGPT login session.

## Portal sign-in and recovery

The portal requires a password and a six-digit Telegram code. Codes expire after five minutes and five verification attempts. Requests are limited to one per minute and three per hour. **Change portal password** invalidates existing sessions. The first administrator is created from the server terminal with `docker compose exec app npm run setup-admin`.

If the bot cannot send codes, check `TELEGRAM_BOT_TOKEN` and the private `TELEGRAM_OTP_CHAT_ID` in `.env`, then recreate the container after changes. `TELEGRAM_CHAT_ID` may point to a separate alert group. Do not expose these settings in logs or support requests.
