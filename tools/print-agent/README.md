# Print-relay agent

Lets **production** print to the factory label printers without the VPS needing any
network route into the factory LAN. The VPS enqueues print jobs; this agent — running
on an always-on machine on the factory network — pulls them over HTTPS and sends each
to its printer over TCP 9100.

```
Operator prints tag → prod /api/print/label → enqueues job (production.print_jobs)
print-agent (factory LAN) → POST /api/print/agent/next  (claims pending jobs)
                          → sends payload to printer_ip:9100
                          → POST /api/print/agent/result (done / error)
```

Only **outbound HTTPS** from the agent is needed — no VPN, no Tailscale, no inbound
firewall changes.

## One-time setup

### 1. Prod (VPS) environment
Set these in the production env (then restart `cntp-production`):
```
PRINT_RELAY=1
PRINT_AGENT_SECRET=<long random string>
```
`PRINT_RELAY=1` makes the print API enqueue instead of opening a socket.
`PRINT_AGENT_SECRET` authenticates the agent. (Leave both unset locally so dev prints directly.)

### 2. Database
Run `supabase/migrations/20260721_001_print_jobs.sql` in the Supabase SQL editor
(staging + prod).

### 3. Office PC (or any always-on factory-LAN machine)
```powershell
$env:PROD_URL = "https://<production-url>"
$env:PRINT_AGENT_SECRET = "<same secret as prod>"
powershell -ExecutionPolicy Bypass -File .\print-agent.ps1
```
You should see `print-agent started → …` and, on each print, a `printed <section> → <ip>` line.

## Run it permanently (Scheduled Task)
So it survives reboots and runs without a logged-in console:
```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PWD\print-agent.ps1`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
Register-ScheduledTask -TaskName "CNTP Print Agent" -Action $action -Trigger $trigger -Principal $principal
```
Set `PROD_URL` and `PRINT_AGENT_SECRET` as **system** environment variables (not just
the session) so the SYSTEM-run task sees them:
```powershell
[Environment]::SetEnvironmentVariable("PROD_URL", "https://<production-url>", "Machine")
[Environment]::SetEnvironmentVariable("PRINT_AGENT_SECRET", "<same secret>", "Machine")
```

## Verifying / troubleshooting
- **Nothing prints:** confirm the agent window shows no `poll error`, and that `PROD_URL`
  is the real production URL. Check `production.print_jobs` — jobs should move
  `pending → printing → done`.
- **Job stuck `printing` / `error`:** the agent couldn't reach that printer. From the
  agent machine: `Test-NetConnection <printer-ip> -Port 9100` should be `True`.
- **401 from prod:** the agent's `PRINT_AGENT_SECRET` doesn't match prod's.
