# read-trello-tasks — setup guide

Step-by-step setup for the `read-trello-tasks` skill. The skill reads Trello
boards, lists, cards, and checklist items through the Trello REST API using a
**Power-Up API key** plus a **user authorization token**.

There are two secrets involved:

| Secret | Where it comes from | Stored in |
| --- | --- | --- |
| `TRELLO_API_KEY` | Generated once on a Trello **Power-Up** (this guide) | `.env` |
| User **token** | Obtained via the one-time `login` browser flow | `.data/trello-token.json` |

> Trello has **no Google Cloud / GCP step** — unlike `read-gmail`, everything
> happens inside Trello's own developer admin at `trello.com/power-ups/admin`.

---

## Prerequisites

- [Bun](https://bun.sh) installed (`bun --version`).
- You are logged into Trello in your browser as the target account.
- Port **3458** is free on localhost (used by the login callback).

---

## Step 1 — Create a Workspace (if the account has none)

Trello only lets you create a Power-Up (and therefore an API key) if your
account is a **member of a Workspace**. A brand-new or guest-only account has
no Workspace, so create one first.

Open <https://trello.com/> → **Create → Workspace** (or the **Create a
Workspace** button on the Boards page). Give it a name, pick any **Workspace
type**, and click **Continue**.

> If the account is already a member of a Workspace, skip this step.
> The API key works account-wide regardless of which Workspace owns the
> Power-Up — it can read any board the account can see.

---

## Step 2 — Open the Power-Up admin and create a new app

Go to <https://trello.com/power-ups/admin>. Under **Your Apps**, click **New**.

---

## Step 3 — Fill in the New App form

Fill the required fields (all of them must be non-empty for **Create** to
enable):

- **App name** — e.g. `My Trello Reader`
- **Workspace** — the Workspace from Step 1
- **Email** — a contact email
- **Support contact** — required; any email works
- **Author** — your name or org
- **Iframe connector URL** — required by the form but unused by this skill;
  any valid `https://` URL works (e.g. `https://example.com`)

Then click **Create**.

---

## Step 4 — Generate the API key

On the app page, open the **API key** tab in the left nav, then click
**Generate a new API key**.

---

## Step 5 — Copy the API key

Copy the **API key** value. (You do **not** need the *Secret* — this skill
authorizes via a user token, not the client secret.)

Put the key in `.agents/skills/read-trello-tasks/.env`:

```dotenv
TRELLO_API_KEY=your_api_key_here
```

You can copy `env.example` to `.env` as a starting point. The file is
gitignored and should be `chmod 600`.

---

## Step 6 — Allow the localhost callback origin

The login flow redirects to `http://localhost:3458/trello/callback`. Trello
rejects the authorization with **"Invalid return_url"** unless that origin is
whitelisted on the Power-Up.

Still on the **API key** tab, type `http://localhost:3458` into **Allowed
origins** and click **Add**. It should appear in the list below the field.

> If you change `TRELLO_REDIRECT_URI` in `.env`, add that origin here instead.

---

## Step 7 — Run the login flow to get a token

From the repo root:

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts login
```

This starts a local callback server on port 3458, prints an authorization
URL, and opens it in your browser. On the **authorization** page, click
**Allow**.

After you click Allow, the token is captured automatically and written to
`.data/trello-token.json` (mode 600). The command prints your member info and
exits.

> If your browser opens the URL but isn't logged in as the target account,
> log in there first (or paste the printed authorization URL into a browser
> tab that is logged in as the right account), then click **Allow**.

---

## Step 8 — Verify

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts status   # loggedIn: true
bun .agents/skills/read-trello-tasks/scripts/trello.ts me       # your account
bun .agents/skills/read-trello-tasks/scripts/trello.ts boards   # visible boards
```

Then drill into a board:

```sh
bun .agents/skills/read-trello-tasks/scripts/trello.ts lists   --board BOARD_ID
bun .agents/skills/read-trello-tasks/scripts/trello.ts cards   --board BOARD_ID --limit 50
bun .agents/skills/read-trello-tasks/scripts/trello.ts card    --id CARD_ID
bun .agents/skills/read-trello-tasks/scripts/trello.ts actions --board BOARD_ID
bun .agents/skills/read-trello-tasks/scripts/trello.ts search  --query 'invoice'
```

---

## Resulting `.env`

```dotenv
# Trello API key from https://trello.com/power-ups/admin
TRELLO_API_KEY=<your_api_key>

# Optional. Defaults shown.
TRELLO_APP_NAME=MyApp
TRELLO_REDIRECT_URI=http://localhost:3458/trello/callback
TRELLO_SCOPE=read
TRELLO_EXPIRATION=never
TRELLO_TOKEN_FILE=.agents/skills/read-trello-tasks/.data/trello-token.json
```

To allow write operations later, set `TRELLO_SCOPE=read,write` and re-run
`login` (the new scope requires re-authorization).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Missing TRELLO_API_KEY` | Add the key to `.env` (Step 5). |
| Power-Up admin says *"not a member of a Trello Workspace"* | Create a Workspace (Step 1). |
| **Create** button stays disabled | All fields including **Support contact** and **Iframe connector URL** must be filled (Step 3). |
| **Invalid return_url** on the authorize page | Add `http://localhost:3458` to Allowed origins (Step 6). |
| `EADDRINUSE` on login | Port 3458 is busy — free it or change `TRELLO_REDIRECT_URI` (and re-add the origin in Step 6). |
| Login opens the wrong account | Authorize in a browser logged in as the target account, then **Allow**. |

---

## Security notes

- `.env` and `.data/` are gitignored — never commit them.
- Never print the API key, the token, or the Power-Up **Secret** into logs,
  chat, or screenshots.
- The token is scoped `read` by default and inherits only the boards the
  account can already access.
- To revoke access: delete the token (`logout`), or revoke the Power-Up token
  from `https://trello.com/<username>/account` → **Connected apps**, or delete
  the Power-Up from the admin (**Delete app**).
