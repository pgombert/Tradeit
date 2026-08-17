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
npm run db:seed          # creates your account, prints a password once
npm run collect -- fred  # pull real data
```

Lost the password? `npm run db:seed -- --force` sets a new one.

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
