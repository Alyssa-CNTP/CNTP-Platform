# Email via Microsoft Graph — setup runbook

The CNTP Platform sends transactional email (roster reminders, and every other
`notify()` email) through `lib/notifications/email.ts`. It supports two
transports and picks one at runtime:

1. **Microsoft Graph (preferred)** — app-only, `POST /users/{sender}/sendMail`.
   Microsoft's supported path for Microsoft 365; does **not** rely on basic SMTP
   AUTH (which M365 disables by default). Use this.
2. **SMTP (fallback)** — Office 365 basic auth via nodemailer. Only used if Graph
   isn't configured. Many M365 tenants reject it (`SmtpClientAuthentication is
   disabled`), which is why we moved to Graph.

If neither is configured the email channel logs a warning and skips — nothing
breaks, in-app + WhatsApp channels are unaffected.

> **Why this was needed:** both staging and production had `SMTP_USER`/`SMTP_PASS`
> empty, so no `notify()` email had ever been delivered — the roster reminder
> cron reported "sent" but the count was attempts, not deliveries. The admin
> **Backend status → Send test to me** button on `/production/roster` reports the
> live transport + per-channel result.

---

## How the code sends (read this first)

`lib/notifications/email.ts`:

1. `graphToken()` — client-credentials grant:
   ```
   POST https://login.microsoftonline.com/<GRAPH_TENANT_ID>/oauth2/v2.0/token
   client_id=<GRAPH_CLIENT_ID>&client_secret=<GRAPH_CLIENT_SECRET>
   &scope=https://graph.microsoft.com/.default&grant_type=client_credentials
   ```
   The token is cached in-process until ~1 min before expiry.
2. `sendViaGraph()`:
   ```
   POST https://graph.microsoft.com/v1.0/users/<GRAPH_SENDER>/sendMail
   Authorization: Bearer <token>
   { "message": { "subject", "body": {contentType:"HTML"}, "toRecipients":[…] },
     "saveToSentItems": false }
   ```
   Success = HTTP 202.

`GRAPH_SENDER` is the mailbox mail is sent **as** — it must be a real, licensed
mailbox (or a shared mailbox) in the tenant.

---

## Step 1 — Register an Azure AD application

Azure Portal → **Microsoft Entra ID → App registrations → New registration**:

- **Name:** `cntp-platform-mailer`
- **Supported account types:** Single tenant.
- No redirect URI needed (app-only, no user sign-in).

After creating, copy:
- **Directory (tenant) ID** → `GRAPH_TENANT_ID`
- **Application (client) ID** → `GRAPH_CLIENT_ID`

## Step 2 — Grant the Mail.Send application permission

App registration → **API permissions → Add a permission → Microsoft Graph →
Application permissions** → search **`Mail.Send`** → add it.

Then click **Grant admin consent for <tenant>** (requires a Global Admin). The
status must show a green tick — without admin consent the send returns 403.

> `Mail.Send` (application) grants send-as for the **whole tenant**. Lock it down
> in Step 4 so this app can only send as the one mailbox.

## Step 3 — Create a client secret

App registration → **Certificates & secrets → New client secret** → set an
expiry (e.g. 24 months; diarise renewal) → **copy the secret VALUE immediately**
(shown once). → `GRAPH_CLIENT_SECRET`.

## Step 4 — Restrict which mailbox it can send as (strongly recommended)

By default the app can send as any mailbox. Scope it to just the sender with an
**Application Access Policy** (Exchange Online PowerShell):

```powershell
# 1. A mail-enabled security group containing only the sender mailbox
New-DistributionGroup -Name "CNTP Mailer Senders" -Type Security `
  -PrimarySmtpAddress cntp-mailer-senders@rooibostea.co.za
Add-DistributionGroupMember -Identity "CNTP Mailer Senders" `
  -Member no-reply@rooibostea.co.za

# 2. Restrict the app (use the Application/client ID from Step 1) to that group
New-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> `
  -PolicyScopeGroupId cntp-mailer-senders@rooibostea.co.za `
  -AccessRight RestrictAccess `
  -Description "CNTP Platform mailer — send as no-reply only"

# 3. Verify
Test-ApplicationAccessPolicy -AppId <GRAPH_CLIENT_ID> `
  -Identity no-reply@rooibostea.co.za   # AccessCheckResult: Granted
```

## Step 5 — Wire the env vars

```bash
GRAPH_TENANT_ID=<tenant id>
GRAPH_CLIENT_ID=<client id>
GRAPH_CLIENT_SECRET=<client secret value>
GRAPH_SENDER=no-reply@rooibostea.co.za   # must be a real mailbox in the tenant
```

- **Local:** add to `.env.local`.
- **Staging/Prod (VPS):** add to `/home/cntpdev/apps/<env>/app/cntp-ops/.env.local`
  and restart the pm2 process (`cntp-staging` / `cntp-production`). Treat the
  secret like any other — never commit it.

Leave `SMTP_*` empty (or set) — Graph wins whenever its four vars are present.

## Step 6 — Test end-to-end

1. Sign in as a full admin → **Production → Shift Rosters → Backend status
   (expand) → Send test to me**.
2. It sends a real email to your own address and reports the result inline:
   - `transport: graph` + `sent` → working. Check your inbox (and spam).
   - `failed — <message>` → the Graph error verbatim. Common ones:
     - **403 / access denied** — admin consent not granted (Step 2), or the
       Application Access Policy excludes the sender (Step 4).
     - **`Invalid client secret`** — secret mistyped or expired (Step 3).
     - **`ErrorInvalidUser` / mailbox not found** — `GRAPH_SENDER` isn't a real
       licensed mailbox in the tenant.
3. Server logs carry `[notifications/email]` lines for anything not surfaced.

---

## Notes

- **Sender reputation:** ensure SPF/DKIM/DMARC are set for `rooibostea.co.za` so
  platform mail doesn't land in spam. M365 signs DKIM for tenant domains once
  enabled in the Defender portal.
- **Secret rotation:** the client secret expires. When it does, email silently
  fails with `Invalid client secret` — the self-test button surfaces it. Renew in
  Step 3 and update the env.
- **Volume:** current triggers (roster reminders twice a week, breakdowns, ticket
  assignments) are low-volume; no batching needed.
