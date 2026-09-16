# Contributing

HiFive has safety-sensitive browser automation. Keep changes small and verify that a failed or uncertain send cannot produce a second `HI` for the same reset cycle.

## Local checks

```bash
npm ci
npm test
npm audit --audit-level=high
```

Tests cover Usage parsing, notification deduplication, portal password and Telegram OTP login, account CRUD, CSRF, and trigger-cycle uniqueness. Run the diagnostic command against a manually logged-in test account before changing ChatGPT UI selectors. The diagnostic command does not send `HI` unless `--send-hi` is supplied, and that flag still applies normal due and idempotency checks.

Do not commit `.env`, `data/`, browser profiles, screenshots containing account information, or credentials. Keep ChatGPT UI selectors in `src/browser/` and call the generic `NotificationService` from business logic rather than Telegram directly.
