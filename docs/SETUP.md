# Setup

Two environments: your Mac, and Google Cloud. They handle secrets differently on
purpose.

---

## The rule about secrets

**Never paste a credential into a chat window, a commit, or a file that isn't
`.env`.** Chat transcripts are stored. Commits are permanent even after a later
deletion. Secret Manager is the only place production credentials belong.

Not every credential carries the same weight:

| Credential | Sensitivity | If it leaks |
|---|---|---|
| `FRED_ID` | Low | Free, read-only, public data. Rotate in a minute. |
| `FINHUB_APIKEY` | Low | Free earnings-calendar key. Rotate in a minute. |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | Medium | Read-only access to the dedicated newsletter inbox — no other Google data. Revoke in the account's security settings and re-mint. |
| `GOOGLE_CLIENT_ID` | None | Public by design — it ships in the browser. Not a secret; it just identifies the sign-in app. |
| `ANTHROPIC_API_KEY` | Medium | Someone spends your API budget. Rotate and move on. |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | High | Anyone can mint a valid login for your instance. |
| `DATABASE_URL` | High | Direct access to everything Tradeit holds. |
| **`SCHWAB_CLIENT_ID` / `SCHWAB_CLIENT_SECRET`** | **Highest** | **Access to a brokerage account. No exceptions — these go straight to Secret Manager and nowhere else.** |

Tradeit requests **read scopes only** from Schwab and never calls a trading
endpoint (see `CLAUDE.md`). That limits the blast radius; it doesn't remove it.

---

## Local development

One command, from a fresh clone:

```bash
./infra/bootstrap-local.sh
```

It checks your tools, starts Postgres and Redis in Docker, generates the JWT
secrets, prompts for your FRED key **with the terminal echo off**, installs
dependencies, applies the schema, creates your account and prints its password
once, runs the tests, and pulls real data if a key was supplied. Safe to re-run —
it won't overwrite an existing `backend/.env`.

Then:

```bash
npm run dev     # backend :4002, dashboard http://localhost:3002
```

### Doing it by hand

```bash
docker compose up -d                 # Postgres 5434, Redis 6381
npm install
cp .env.example backend/.env
```

Then edit `backend/.env`:

- `JWT_SECRET` and `JWT_REFRESH_SECRET` — any long random strings, from
  `openssl rand -base64 48`. These should *not* match production.
- `FRED_ID` — your real key. Low-sensitivity and read-only, and the
  collector can't do anything without it.
- Schwab credentials — leave blank locally unless you're working on that
  collector. The dashboard renders an honest "not connected" state without them.

```bash
npm run db:migrate
npm run db:seed          # creates your account (sign-in is Google-only, no password)
npm run collect -- fred  # pull real data
```

Sign-in is **Google-only** — there is no password. Before the login page works,
set up the Google client ID once (next section), and put it in **two** places:
`GOOGLE_CLIENT_ID` in `backend/.env` and `VITE_GOOGLE_CLIENT_ID` in
`frontend/.env` (copy `frontend/.env.example`). They are the same value.

---

## Sign in with Google (SSO)

Login is Google-only. You click one button, Google confirms it's you, and the
server lets you in **only** if the Google account's email is `ALLOWED_EMAIL`
(`pete@goodwellpartners.com`). Any other Google account is refused.

You need one **OAuth client ID** for the app. Unlike the Schwab or JWT secrets,
this ID is *public by design* — it's shipped in the browser — so there is no
client secret to protect here.

One-time setup in `console.cloud.google.com`:

1. Pick (or create) a project → **APIs & Services** → **OAuth consent screen**.
   Choose **External**, app name "Tradeit". Under **Audience**, add
   `pete@goodwellpartners.com` as a test user. (No sensitive scopes are needed —
   sign-in only reads your name and email.)
2. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth
   client ID** → application type **Web application**. Name it "Tradeit web".
3. Under **Authorized JavaScript origins**, add the sites the button loads from:
   - `http://localhost:3002` (local development)
   - `https://trade.meadowlark.day` (production)
   Leave "Authorized redirect URIs" empty — this flow doesn't use one.
4. Click Create. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).

Put that one value in both places:

- Local: `GOOGLE_CLIENT_ID=` in `backend/.env`, and `VITE_GOOGLE_CLIENT_ID=` in
  `frontend/.env`.
- Production: it is not a secret, but it's handled like every other config value.
  Add it to the API service and rebuild the frontend with it set:

  ```bash
  gcloud run services update tradeit-api --region=us-central1 \
    --update-env-vars=GOOGLE_CLIENT_ID=<your-client-id>
  # the frontend bakes it in at build time:
  VITE_GOOGLE_CLIENT_ID=<your-client-id> npm run build -w frontend
  firebase deploy --only hosting
  ```

If the email on the Google account isn't `ALLOWED_EMAIL`, the login page shows
"That Google account is not allowed to sign in here" — that's the single-user
gate working, not a bug.

---

## The newsletter inbox (Gmail collector)

The `gmail` collector reads one dedicated inbox that every §3 research letter is
subscribed to. It uses OAuth with the **`gmail.readonly`** scope — it can read
mail and nothing else, and it never touches your personal Google account.

The inbox is **`tradeit1971@gmail.com`**. Setup is a one-time token mint:

1. In `console.cloud.google.com`, create (or reuse) a project (`tradeit-news`,
   kept separate from the app's `tradeit-505723`), enable the **Gmail API**, and
   set up the OAuth consent screen as an **External** app with the
   `.../auth/gmail.readonly` scope. Then **Publish it — set the publishing status
   to "In production," not "Testing."**

   This matters: a Testing-mode app's refresh token **expires after 7 days**, which
   would break the daily collector roughly weekly. Publishing makes the token
   long-lived. You do **not** need to complete Google's verification — an
   unverified in-production app is fine for a personal, single-inbox tool; you
   just click through the one-time "unverified app" warning when you consent.
2. Create an **OAuth client ID** of type *Desktop app*. That gives you
   `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`.
3. Mint the refresh token with the bundled helper — it runs the consent flow
   against a loopback server on your Mac, so there's no OAuth Playground to wire
   up:

   ```bash
   npm run gmail:authorize
   ```

   Paste the client id and secret when asked, and in the browser sign in **as
   tradeit1971@gmail.com** and grant read-only access. It prints your
   `GMAIL_REFRESH_TOKEN`. (Google only returns a refresh token on first consent —
   if you need a fresh one, remove Tradeit at
   `myaccount.google.com/permissions` and re-run.)

Locally, drop the three values into `backend/.env` and run `npm run collect -- gmail`.
In production they are three secrets, added exactly like any other:

```bash
gcloud secrets create GMAIL_REFRESH_TOKEN --data-file=- --replication-policy=automatic
gcloud run jobs update tradeit-collect --region=us-central1 \
  --update-secrets=GMAIL_REFRESH_TOKEN=GMAIL_REFRESH_TOKEN:latest
```

A refresh token can be revoked or expire. When it does the collector fails with a
clear "re-authorize the newsletter inbox" message rather than going quietly
stale — re-mint at step 3 and rotate `GMAIL_REFRESH_TOKEN`.

Which letters are ingested, and how each sender is recognized, lives in
`packages/shared/src/constants/newsletter-sources.ts`. Adding a subscription is a
one-line entry there; adjust a source's `match` list if a letter arrives from an
address the registry doesn't yet recognize.

---

## Schwab (account + prices)

Two read-only pieces share one Schwab login:

- **Account reader** — your live balance, settled vs. unsettled cash, and open
  positions, on the dashboard.
- **Price collector** — daily price history for the tradable universe, pulled by
  `npm run collect -- prices` into the price table.

Both use the Schwab Trader API with **read scopes only**. The API *can* place
orders; no code here ever calls that path, and a build-breaking test enforces it
(`CLAUDE.md`, docs/PLAN.md §0).

### One-time app registration

At `developer.schwab.com`, register as an **Individual Developer**, create an app
with both **Accounts and Trading** and **Market Data** products, and set the
callback URL **exactly** to:

```
https://trade.meadowlark.day/api/schwab/callback
```

Wait for the app to reach **"Ready for use."** The app's **App Key** and **Secret**
become `SCHWAB_CLIENT_ID` and `SCHWAB_CLIENT_SECRET` (both highest-sensitivity —
Secret Manager only, per the table above), and `SCHWAB_REDIRECT_URI` is the
callback URL above.

```bash
gcloud run services update tradeit-api --region=us-central1 \
  --update-secrets=SCHWAB_CLIENT_ID=SCHWAB_CLIENT_ID:latest,SCHWAB_CLIENT_SECRET=SCHWAB_CLIENT_SECRET:latest
gcloud run services update tradeit-api --region=us-central1 \
  --update-env-vars=SCHWAB_REDIRECT_URI=https://trade.meadowlark.day/api/schwab/callback
# the price collector runs in the collect job, so it needs the same three:
gcloud run jobs update tradeit-collect --region=us-central1 \
  --update-secrets=SCHWAB_CLIENT_ID=SCHWAB_CLIENT_ID:latest,SCHWAB_CLIENT_SECRET=SCHWAB_CLIENT_SECRET:latest \
  --update-env-vars=SCHWAB_REDIRECT_URI=https://trade.meadowlark.day/api/schwab/callback
```

### Connecting — and reconnecting weekly

There is **nothing to paste**. On the dashboard's **Account** panel, click
**Connect Schwab**, sign in at Schwab, and approve read-only access; Schwab sends
you back and the connection is stored server-side (the `schwab_tokens` table).

**Schwab's login lasts about 7 days.** Unlike the Gmail token, refreshing the
short-lived access token does not extend it — so roughly weekly the panel shows
**Reconnect Schwab** and you click through the same flow again. The 30-minute
access token in between is refreshed automatically; you only ever click the
button.

### A note on local testing

Schwab only redirects to the one registered HTTPS callback, so the full connect
flow runs in production, not on `localhost`. Locally, leave the Schwab values
blank: the dashboard shows an honest "not connected," and the account/price logic
is covered by unit tests (`schwab.parse.test.ts`, `schwab.prices.test.ts`) that
run without a live login. `npm run collect -- prices` without a connection fails
with a clear "Schwab is not connected" message rather than writing nothing
silently.

---

## Google Cloud

Everything below is one command:

```bash
./infra/provision.sh
```

It is safe to re-run — each step checks for what it creates first. It will:

1. Enable the APIs Tradeit needs.
2. Create the Artifact Registry repository for container images.
3. Create the `tradeit` database and user, and store the connection string in
   Secret Manager. **By default it adds a database to Meadowlark's existing
   Cloud SQL instance** rather than paying ~$25/month for one of its own. Set
   `SQL_INSTANCE` to something else if you'd rather they were fully isolated.
4. Generate the JWT secrets and prompt for the rest. **Prompts read with terminal
   echo off** — the values go straight to Secret Manager, are never displayed,
   and are never written to disk. Blank input skips a secret so you can add it
   later.
5. Create a service account with only two roles: connect to Cloud SQL, and read
   secrets.
6. Create the `tradeit-api` service plus the `tradeit-migrate` and
   `tradeit-collect` jobs. Collectors run as a separate job from the API
   deliberately, so a collector crash can't take the app down.
7. Schedule the collector for weekdays at 18:10 Central, after FRED's daily
   publication settles.

Adding a secret later, without re-running anything:

```bash
gcloud secrets create FRED_ID --data-file=- --replication-policy=automatic
# paste the value, then Ctrl-D. Nothing is echoed.

gcloud run services update tradeit-api --region=us-central1 \
  --update-secrets=FRED_ID=FRED_ID:latest
gcloud run jobs update tradeit-collect --region=us-central1 \
  --update-secrets=FRED_ID=FRED_ID:latest
```

Rotating one:

```bash
gcloud secrets versions add FRED_ID --data-file=-
```

Because everything is pinned to `:latest`, the new version is picked up on the
next deploy or job run.

---

## Deploying

```bash
gcloud builds submit --config=cloudbuild.backend.yaml .     # API + jobs
npm run build -w frontend && firebase deploy --only hosting  # dashboard
```

The build runs migrations through `tradeit-migrate` **before** the service rolls
out, so a failed migration halts the pipeline rather than leaving the API running
against a schema it doesn't understand.

First deploy runs in the other order — the image has to exist before
`provision.sh` can point services at it:

```bash
gcloud builds submit --config=cloudbuild.backend.yaml .
./infra/provision.sh
gcloud run jobs execute tradeit-collect --region=us-central1 --wait
```

---

## The domain

Firebase Hosting site: `tradeit-prod`, in project `meadowlark-492419`. Attach
`trade.meadowlark.<tld>` to that site in the Firebase console, then add the two
DNS records it gives you. `firebase.json` already rewrites `/api/**` to the
`tradeit-api` Cloud Run service, so the dashboard and the API share an origin and
there is no CORS configuration to maintain.
