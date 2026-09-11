# Local standby — running CNTP Platform on the local server when the VPS is down

A **warm standby**: the local server runs the same production app, reached over
Tailscale, while the VPS is unreachable. Manual failover, a few minutes, internal
access only.

> **What makes this cheap:** the databases are **not** on the VPS. Production data
> lives in the Supabase cloud project `sxzjjcyuzyfneesnsjna` (see
> [environments-architecture.md](../environments-architecture.md)). If the VPS
> dies, the data is untouched — the standby only has to run the app and be
> reachable. No replication, no sync, no split-brain.

---

## 1. What this covers — and what it doesn't

| Failure | Covered? |
|---|---|
| VPS dead, rebuilt, or unreachable | **Yes** — this is what the standby is for |
| A deploy wrecked `.next` and production is crash-looping | **Yes** |
| VPS disk full / pm2 won't start | **Yes** |
| Factory internet down | **No** — the standby still needs to reach Supabase |
| Supabase itself down | **No** — nothing on-prem helps; the data is there |
| Someone off the tailnet needs access | **No** — Tailscale-only, by design |

If "the floor must keep capturing with no internet at all" becomes the
requirement, that's a different and much larger project: a local Postgres,
offline-first capture, and a reconciliation path for shared identifiers (bag
serials, session rows). Don't let this runbook imply it's covered.

---

## 2. Prerequisites on the local server

Verified on the Windows workstation on 2026-08-20:

| Requirement | State | Action |
|---|---|---|
| Node 24 | ✅ v24.19.0 present (VPS runs v24.16.0) | none |
| Tailscale | ⚠️ installed but **logged out** | `tailscale up` and confirm the host appears on the tailnet |
| pm2 | ❌ not installed | `npm i -g pm2` (or run with `npm start` and accept no auto-restart) |
| Repo clone | ✅ `C:\Users\Alyssa\Downloads\cntp-ops` | keep it, or clone fresh for the standby |
| Production env file | ❌ **not present** | see the warning below |

### ⚠️ The env file is the one thing that can do real damage

The standby must point at the **production** Supabase project. The `.env.local`
already in this checkout holds **staging** keys
(`NEXT_PUBLIC_SUPABASE_URL=…qjqkpockmujecjgmdple…`). Starting the standby with
that file gives you an app that looks like production and **writes every capture
into the staging database** — worse than being down, because it looks fine.

Copy the production env file deliberately, once, and keep it separate:

```bash
scp -P 2022 cntpdev@154.65.97.200:/home/cntpdev/apps/production/app/cntp-ops/.env.local ~/cntp-standby.env
```

Then have the standby use it (the sync script below takes `--env <path>`). Treat
that file like the production database password, because it contains it.

### ⚠️ Do the SSO wiring BEFORE you need it

Sign-in will fail on the standby unless its origin is allow-listed in advance —
and you can't fix that from a dead VPS:

- **Supabase Auth** → the standby origin must be in the redirect allowlist for
  project `sxzjjcyuzyfneesnsjna`.
- **Azure app registration** → same origin added as a redirect URI, or Microsoft
  SSO bounces every staff login.

Use the stable Tailscale hostname (e.g. `http://cntp-standby:3001`), not a
DHCP-assigned IP, so the allowlist entry stays valid.

**Floor operators are fine either way** — PIN login is a database lookup with no
redirect, so capture keeps working even if the SSO wiring was never done. Plan
around that: the floor can capture, office staff may not be able to sign in.

---

## 3. One-time setup

```bash
tailscale up                                    # then note the hostname it registers
npm i -g pm2
git clone https://github.com/Alyssa-CNTP/CNTP-Platform ~/cntp-standby
cd ~/cntp-standby && git checkout main
bash scripts/local-standby.sh sync --env ~/cntp-standby.env
```

The last step fetches `main`, installs, and builds — nothing is served yet.

---

## 4. Keeping it warm

A standby that hasn't built since June is not a standby. Run the sync weekly, or
after any production promotion:

```bash
bash scripts/local-standby.sh sync --env ~/cntp-standby.env
```

This builds into a side directory and only swaps it in when the build produced a
`BUILD_ID` — so a failed sync leaves the last working standby intact. That
matters most in the case you'd actually use it: syncing while the VPS is already
down.

Building here costs the local server's CPU, **not** the VPS's — no contention
with the live apps.

---

## 5. Failover (VPS is down)

```bash
bash scripts/local-standby.sh start --env ~/cntp-standby.env
bash scripts/local-standby.sh status
```

Then tell staff the tailnet URL: `http://<tailscale-hostname>:3001`.

Sanity-check before announcing it:

1. `/dashboard` loads.
2. A floor operator can PIN in at `/floor`.
3. A capture page saves — confirm the row appears in the **production** Supabase
   project, not staging. This is the check that catches a wrong env file.

---

## 6. Failback (VPS is healthy again)

1. Stop the standby: `bash scripts/local-standby.sh stop`.
2. Confirm the VPS app is serving: `curl -s -o /dev/null -w '%{http_code}' https://cntpplatform.rooibostea.co.za/dashboard`.
3. Tell staff to go back to the normal URL.

There's no data merge step — both the standby and the VPS write to the same
Supabase project, so whatever was captured during the outage is already there.
That's the whole reason this design is simple; keep it that way.

---

## 7. What still won't work during an outage

Worth knowing so nobody waits for something that isn't coming:

- **Scheduled jobs** — the GitHub Actions crons (energy capture, roster rotate,
  shift report) hit `PROD_APP_URL`, which points at the VPS. They'll fail for the
  duration. Re-run them from the Actions tab after failback if the day's data
  matters.
- **Inbound webhooks** — anything pointed at the public hostname (WhatsApp,
  email) won't reach the standby.
- **No HTTPS** — plain HTTP over the tailnet. Acceptable because Tailscale
  encrypts the transport, but browsers will treat it as an insecure origin, so
  camera-based barcode scanning may be blocked. Test that before relying on it
  on a scanning tablet.
- **Label printing** depends on the printers being reachable from the standby's
  network segment — likely better locally than from the VPS, but untested.
