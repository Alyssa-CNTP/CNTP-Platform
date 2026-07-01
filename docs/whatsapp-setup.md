# WhatsApp notifications — setup runbook

The CNTP Platform already has a complete, provider-agnostic notification pipeline
(`lib/notifications/`). The `urgent` channel sends WhatsApp (or SMS) via either the
**Meta WhatsApp Cloud API** or **Twilio**. The code is done — this runbook covers the
**Meta-side account setup and credentials** that only a human with Business Manager
access can complete, plus the env wiring that switches it on.

When configured it fires today on:

- **Maintenance breakdowns** — on-duty technician + manager (already wired)
- **Axis ticket assignments** — the assignee, on create and on reassignment

If `WHATSAPP_PROVIDER` is unset, the urgent channel logs a warning and skips — nothing
breaks. In-app + email channels are unaffected.

---

## How the code sends a message (read this first)

`lib/notifications/urgent.ts` → `sendMeta()` posts a **template** message:

```
POST https://graph.facebook.com/v21.0/<WHATSAPP_PHONE_ID>/messages
Authorization: Bearer <WHATSAPP_TOKEN>

{
  "messaging_product": "whatsapp",
  "to": "27821234567",                         // recipient, '+' stripped automatically
  "type": "template",
  "template": {
    "name": "<WHATSAPP_TEMPLATE>",             // default 'cntp_alert'
    "language": { "code": "en" },
    "components": [
      { "type": "body", "parameters": [ { "type": "text", "text": "<the message>" } ] }
    ]
  }
}
```

Key consequences for the template you create in Meta:

- **One template serves everything.** Every urgent notification (breakdowns, ticket
  assignments) uses the same template; only the single body value changes. You do **not**
  need a template per event.
- **The template body must contain exactly one variable, `{{1}}`**, and the language must
  be **English (`en`)**. More or fewer variables → the API call fails with a format error.
- The app passes `"<title>\n<body>"` collapsed to a single line as `{{1}}` (Meta rejects
  parameters with newlines, tabs, or 4+ spaces — the code strips these for you).

---

## Step 1 — Meta account + WhatsApp sender

In [Meta for Developers](https://developers.facebook.com) / Meta Business Suite:

1. **Business verification** — Business Settings → Security Centre → verify the CNTP
   business. (Unverified businesses are capped at very low send limits.)
2. **Create an app** — developers.facebook.com → My Apps → Create App → type **Business**.
3. **Add the WhatsApp product** to the app. This auto-creates a **WhatsApp Business
   Account (WABA)** and a free Meta-provided **test number**.
4. **Add your real sender number** (WhatsApp Manager → add phone number, verify by
   SMS/call). A number already on the consumer WhatsApp app must be deleted there first.
   For early testing the test number is fine — but it can only message numbers you add to
   its allow-list in the dashboard.
5. Note the **Phone number ID** (WhatsApp → API Setup, *not* the phone number itself).
   → this is `WHATSAPP_PHONE_ID`.

## Step 2 — Create + submit the message template

WhatsApp Manager → **Message templates** → Create template:

- **Name:** `cntp_alert`  (must match `WHATSAPP_TEMPLATE`)
- **Category:** **Utility**  (operational alerts — cheaper; do **not** pick Marketing)
- **Language:** English (`en`)
- **Body:**

  ```
  CNTP Platform: {{1}}. Open the platform to view the full details.
  ```

  Sample value for `{{1}}` (Meta asks for one to review): `Ticket IT-0042 assigned to you — app / high priority.`

Rules Meta's validator enforces (all satisfied by the body above): don't end on a
variable, keep enough static text around `{{1}}`, no marketing language in a Utility
template. **Utility templates are usually approved within minutes.**

## Step 3 — Permanent access token (System User)

The 24-hour token in the dashboard is for testing only. For production:

1. Meta **Business Settings → Users → System Users** → Add → create one (e.g.
   `cntp-platform-bot`), role **Admin** or **Employee**.
2. **Assign assets** → add the WhatsApp app (and the WABA) to this system user with full
   control.
3. **Generate new token** → select the app → scopes **`whatsapp_business_messaging`** and
   **`whatsapp_business_management`** → set **expiry: Never** → copy it.
   → this is `WHATSAPP_TOKEN`. It is shown once — store it immediately.

## Step 4 — Wire the env vars

```bash
WHATSAPP_PROVIDER=meta
WHATSAPP_TOKEN=<permanent system-user token>
WHATSAPP_PHONE_ID=<phone number ID from Step 1.5>
WHATSAPP_TEMPLATE=cntp_alert
```

- **Local:** add to `.env.local`.
- **Staging/Prod (VPS):** add to the server's env (the `.env` PM2 reads) and restart
  `cntp-staging`, e.g. via the standard deploy SSH block. Treat the token like any other
  secret — never commit it.

## Step 5 — Make sure recipients can receive

- Each notifiable user needs a phone number in **`shared.app_roles.phone`** in **E.164**
  format (e.g. `+27821234567`). `resolveRecipients()` reads phone from there; users with no
  phone are silently skipped for the urgent channel.
- Users can opt out per channel in **Settings → Notifications** (`urgent` toggle). This is
  the Meta-required opt-in/consent control.

## Step 6 — Test end-to-end

1. With the test number, add your own WhatsApp number to its allow-list in the dashboard.
2. Set your `shared.app_roles.phone` and confirm the `urgent` toggle is on.
3. Assign yourself an Axis ticket (or raise a maintenance breakdown). You should receive
   the WhatsApp within seconds.
4. If nothing arrives, check the server logs for `[notifications/urgent]` lines — they say
   exactly why it skipped or what Meta returned.

---

## Notes / future work

- **Delivery receipts (optional):** to know whether a message was delivered/read/failed,
  configure a Meta **webhook** pointing at a new endpoint (e.g. `/api/whatsapp/webhook`)
  subscribed to `messages` status events. Not implemented yet — the current code is
  send-and-log only.
- **Rate / cost:** Utility-category messages are billed per conversation. The current
  triggers (breakdowns, ticket assignments) are low-volume and event-driven, so no
  debouncing is needed. If a high-frequency trigger is ever added, add rate-limiting before
  the `notify()` call.
- **Twilio alternative:** set `WHATSAPP_PROVIDER=twilio` with `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`. No template pre-approval, higher per-message
  cost. Same `notify()` call sites — no code change needed to switch.
```
