# Operations

## Daily checks

Open the portal to review each account's status, next reset, last Usage check, and last successful `HI`. Telegram alerts report important state changes. `/status` and `/accounts` provide read-only summaries when Telegram commands are enabled.

## Expired ChatGPT session

For `LOGIN_REQUIRED`, open the account's login browser in the portal, connect through the localhost noVNC tunnel, complete the ChatGPT login manually, and close the login browser. Run **Diagnose** before re-enabling automatic work. Chromium profiles are account-specific and persist through restarts.

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

If the bot cannot send codes, check `TELEGRAM_BOT_TOKEN` and the private `TELEGRAM_CHAT_ID` in `.env`, then recreate the container after changes. Do not expose these settings in logs or support requests.
