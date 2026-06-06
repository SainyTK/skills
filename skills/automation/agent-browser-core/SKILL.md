---
name: agent-browser-core
description: Self-contained agent-browser workflow — browser execution first, real browser profiles for auth, no extra "skills get" round-trips. Use for navigating pages, snapshots, clicking, filling forms, screenshots, video capture, authenticated sites via existing Brave/Chrome profiles, and multiple agents working in separate tabs in the default session. Prefer this over for everyday browser automation.
allowed-tools: Bash(agent-browser:*)
---

# agent-browser-core

Everything needed to drive a browser is in this file — do **not** run
`agent-browser skills get ...` unless the task is an Electron app, Slack
desktop, or a cloud provider (then load the matching specialized skill).

Four parts: **0. First-time config** · **1. Browser operations** · **2. Authentication via real browser profiles** · **3. Shared session tabs**

---

## 0. First-time config

If `agent-browser` is installed but default browser/profile behavior is not set
up yet, interview the user before choosing defaults. Do not silently pick
bundled Chromium when the task involves sites that may need login. We found
Chromium loses credentials after close/restart, while main browsers such as
Brave and Chrome keep credentials reliably when using existing user profiles.

### Detect config

Check the local setup first:

```bash
agent-browser --help
agent-browser profiles
```

Also inspect `~/.agent-browser/config.json` if filesystem access allows it. If
there is no `profile` and no `executablePath`/`executable-path` equivalent, treat
agent-browser as not configured for persistent browser credentials.

### Interview

Ask these questions before changing config:

1. Which browser should agent-browser use by default? Prefer the user's normal
   authenticated browser. Examples: Brave, Chrome, or a specific app path.
2. Should agent-browser reuse an existing profile from that browser, or create a
   separate persistent automation profile?

Tell the user this can be changed later. Keep the tradeoff short:

- Existing profile: required for auth-heavy tasks. Best chance of reusing
  Google/OAuth credentials because it uses the user's real browser state.
- Separate persistent profile: cleaner isolation for unauthenticated tasks, but
  not preferred for auth because the user must log in again and some sites may
  treat it as a new browser.

### Apply chosen defaults

After the user chooses, update the user-level config:

```json
{
  "profile": "<profile name or persistent profile path>",
  "executablePath": "<browser executable path>"
}
```

Examples:

```json
{
  "profile": "Profile 1",
  "executablePath": "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
}
```

```json
{
  "profile": "/Users/<user>/.agent-browser/profiles/main",
  "executablePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
}
```

If a daemon/session is already running, do not close it automatically. Closing
the agent-browser session can drop auth credentials for the shared browser.
Tell the user the new config applies on the next launch, or ask before any
restart/close action.

Then verify with a cheap headed open on the target login-sensitive site:

```bash
agent-browser --headed open https://mail.google.com
agent-browser get url
```

---

## 1. Browser operations

### The core loop

```bash
agent-browser open <url>        # 1. open page (auto-prepends https://)
agent-browser snapshot -i       # 2. see interactive elements as @eN refs
agent-browser click @e3         # 3. act on a ref
agent-browser snapshot -i       # 4. RE-SNAPSHOT after any page change
```

Refs (`@e1`, `@e2`...) go **stale the moment the page changes** (navigation,
submit, dynamic re-render, dialog). Always re-snapshot before the next ref.

### Reading a page

```bash
agent-browser snapshot -i            # interactive only (preferred)
agent-browser snapshot -i -u         # + href urls on links
agent-browser snapshot -s "#main"    # scope to CSS selector
agent-browser get text @e1           # visible text
agent-browser get attr @e1 href      # any attribute
agent-browser get value @e1          # input value
agent-browser get url                # current URL
agent-browser get title              # page title
```

### Interacting

```bash
agent-browser click @e1              # click   (--new-tab to open in new tab)
agent-browser fill @e2 "text"        # clear then type
agent-browser type @e2 "more"        # type without clearing
agent-browser press Enter            # key at current focus (Control+a etc.)
agent-browser check @e3 / uncheck @e3
agent-browser select @e4 "value"     # dropdown
agent-browser upload @e5 file.pdf
agent-browser scroll down 500        # up/down/left/right
agent-browser scrollintoview @e1
agent-browser hover @e1
```

When refs fail, fall back to semantic locators, then raw CSS:

```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser click "#submit"
```

### Waiting — pick the right wait, never bare sleeps

```bash
agent-browser wait @e1                     # element appears
agent-browser wait --text "Success"       # text appears
agent-browser wait --url "**/dashboard"   # URL matches glob
agent-browser wait --load networkidle     # SPA catch-all after navigation
```

### Screenshot & video

```bash
agent-browser screenshot                   # temp path printed on stdout
agent-browser screenshot page.png          # specific path
agent-browser screenshot --full full.png   # full scroll height
agent-browser screenshot --annotate map.png  # [N] labels keyed to @eN refs

agent-browser record start demo.webm       # start video
# ... actions ...
agent-browser record stop                  # stop & save
```

### Extract data / run JS

```bash
agent-browser snapshot -i --json > page.json   # machine-readable page
cat <<'EOF' | agent-browser eval --stdin
Array.from(document.querySelectorAll("table tbody tr"))
  .map(r => ({ name: r.cells[0].innerText, price: r.cells[1].innerText }));
EOF
```

Use `eval --stdin` (heredoc) for anything with quotes; inline `eval "..."`
only for trivial expressions.

### Tabs

```bash
agent-browser tab                          # list (stable ids t1, t2...)
agent-browser tab new --label docs <url>   # open + label
agent-browser tab docs                     # switch by label (or t2 by id)
agent-browser tab close docs
```

Refs belong to the active tab — re-snapshot after switching.

### Troubleshooting quick table

| Symptom | Fix |
|---|---|
| `Ref not found` | Page changed — `snapshot -i` again |
| Element missing from snapshot | `scroll down 1000` or `wait --text`, then re-snapshot |
| Click swallowed by overlay | Snapshot, dismiss the modal/cookie banner first |
| fill/type ignored | `focus @e1` then `keyboard inserttext "text"` |
| Anything weird (daemon, Chrome, version) | `agent-browser doctor` (add `--fix` for repairs) |

---

## 2. Authentication via real browser profiles

Do not use `agent-browser auth` commands for normal work. For authenticated
tasks, rely on existing credentials in the user's real browser profiles. Brave
and Chrome profiles keep credentials across close/restart; bundled Chromium has
been observed to lose credentials after close/restart.

### Reuse protocol (try in this order)

```bash
# a) List available real browser profiles.
agent-browser profiles

# b) Try the configured default browser/profile first. Keep work in your own tab.
agent-browser tab new --label <task-label> https://app.example.com/dashboard
agent-browser get url          # still on the app page (not /login)? → logged in, done

# c) Not logged in? Try another existing profile if there are only a few:
agent-browser --profile "<profile-name>" tab new --label <task-label> https://app.example.com/dashboard

# d) If no existing profile is logged in, ask the user to log in using their
#    normal browser, then tell you which profile to use. If profiles are few,
#    the agent may inspect them with `agent-browser profiles` and try likely
#    candidates. Never ask the user to paste credentials into chat.
```

### No logged-in profile yet?

Ask the user to log in through their normal browser UI, then tell you which
browser profile to use. If the list of profiles is small, the agent can try
available profiles itself and detect which one is already authenticated.

Never ask the user to paste passwords, OTPs, recovery codes, cookies, or session
tokens into chat.

### Edge cases

- 2FA / OAuth: use `--headed`, ask the user to finish in their normal browser
  profile, then `wait --url "**/dashboard" --timeout 120000`. Keep the session
  open.
- Mid-task logout: ask the user to refresh/login again in the real browser
  profile; do not switch to `agent-browser auth`.

---

## 3. Shared session tabs (normal and parallel use)

Use the single default `agent-browser` session for normal and parallel work.
Do not create separate `--session` values for parallel agents. Auth state lives
in the shared browser/profile, and closing the session can drop credentials.

### Per-agent startup protocol

```bash
# 1. Confirm you are on the default session:
agent-browser session

# 2. Create or switch to your own tab. Use a unique label for your task/agent:
agent-browser tab new --label <task-label> https://app.example.com

# 3. Work only in your tab. Re-snapshot after tab switches:
agent-browser tab <task-label>
agent-browser snapshot -i

# 4. When done, leave the session running. Closing your tab is allowed only if
#    it will not disrupt another agent's visible work:
agent-browser tab close <task-label>
```

Rules:

- **One agent per tab.** Use unique tab labels and switch explicitly before
  every action batch.
- **Default session only.** Do not set `AGENT_BROWSER_SESSION`; do not pass
  `--session <name>` unless the user explicitly asks for isolation.
- **Never close the session.** Do not run `agent-browser close` as cleanup.
  Ask the user first if a restart is truly required.
- **Refs are tab-local and stale after switches.** Run `snapshot -i` after
  switching tabs or after any page change.
- **Google/OAuth accounts:** keep the authenticated browser alive. Use the
  configured default browser/profile; do not copy cookie/state files.
- If anything about the environment looks broken, run `agent-browser doctor`
  before changing session/profile behavior.
