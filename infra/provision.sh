#!/usr/bin/env bash
#
# One-time Google Cloud provisioning for Tradeit.
#
# Safe to re-run: every step checks for what it creates first, so a second run
# reports "exists" rather than failing or duplicating anything.
#
#   ./infra/provision.sh
#
# Secrets are read from your terminal and sent straight to Secret Manager. They
# are never echoed, never written to a file, and never committed.

set -euo pipefail

PROJECT="${PROJECT:-meadowlark-492419}"
REGION="${REGION:-us-central1}"
REPO="tradeit"

# Tradeit is one user with modest data, so by default it takes a new database on
# Meadowlark's existing Cloud SQL instance rather than paying ~$25/month for an
# instance of its own. Set SQL_INSTANCE to provision separately if you'd rather
# the two projects couldn't affect each other.
SQL_INSTANCE="${SQL_INSTANCE:-meadowlark-db}"
DB_NAME="${DB_NAME:-tradeit}"
DB_USER="${DB_USER:-tradeit}"

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
skip() { printf '  \033[90m·\033[0m %s\n' "$1"; }

gcloud config set project "$PROJECT" >/dev/null

# ---------------------------------------------------------------------------
bold "1. APIs"

for api in run.googleapis.com cloudbuild.googleapis.com sqladmin.googleapis.com \
           secretmanager.googleapis.com artifactregistry.googleapis.com \
           cloudscheduler.googleapis.com; do
  if gcloud services list --enabled --filter="config.name=$api" --format='value(config.name)' | grep -q .; then
    skip "$api already enabled"
  else
    gcloud services enable "$api" >/dev/null
    ok "enabled $api"
  fi
done

# ---------------------------------------------------------------------------
bold "2. Artifact Registry"

if gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1; then
  skip "repository $REPO exists"
else
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker --location="$REGION" \
    --description="Tradeit container images" >/dev/null
  ok "created repository $REPO"
fi

# ---------------------------------------------------------------------------
bold "3. Database"

if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
  echo "  Cloud SQL instance '$SQL_INSTANCE' not found."
  echo "  Either set SQL_INSTANCE to an existing instance, or create one:"
  echo "    gcloud sql instances create $SQL_INSTANCE \\"
  echo "      --database-version=POSTGRES_16 --tier=db-f1-micro --region=$REGION"
  exit 1
fi
skip "using instance $SQL_INSTANCE"

if gcloud sql databases describe "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1; then
  skip "database $DB_NAME exists"
else
  gcloud sql databases create "$DB_NAME" --instance="$SQL_INSTANCE" >/dev/null
  ok "created database $DB_NAME"
fi

if gcloud sql users list --instance="$SQL_INSTANCE" --format='value(name)' | grep -qx "$DB_USER"; then
  skip "database user $DB_USER exists"
else
  DB_PASSWORD="$(openssl rand -base64 30 | tr -d '/+=' | head -c 32)"
  gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" >/dev/null
  ok "created database user $DB_USER"

  CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
  printf 'postgresql://%s:%s@localhost/%s?host=/cloudsql/%s' \
    "$DB_USER" "$DB_PASSWORD" "$DB_NAME" "$CONNECTION_NAME" \
    | gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic >/dev/null
  ok "stored DATABASE_URL in Secret Manager"
  unset DB_PASSWORD
fi

# ---------------------------------------------------------------------------
bold "4. Secrets"

# Creates a secret if absent. Generated secrets are produced here and never
# shown; prompted secrets are read with the terminal echo off.
ensure_secret() {
  local name="$1" mode="$2" prompt="${3:-}"

  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    skip "$name exists"
    return
  fi

  case "$mode" in
    generate)
      openssl rand -base64 48 | tr -d '\n' \
        | gcloud secrets create "$name" --data-file=- --replication-policy=automatic >/dev/null
      ok "generated $name"
      ;;
    prompt)
      echo
      echo "  $prompt"
      read -rsp "  $name (input hidden, blank to skip): " value
      echo
      if [ -z "$value" ]; then
        skip "$name skipped — create it later with:"
        printf '      gcloud secrets create %s --data-file=- --replication-policy=automatic\n' "$name"
        return
      fi
      printf '%s' "$value" \
        | gcloud secrets create "$name" --data-file=- --replication-policy=automatic >/dev/null
      unset value
      ok "stored $name"
      ;;
  esac
}

ensure_secret JWT_SECRET generate
ensure_secret JWT_REFRESH_SECRET generate
ensure_secret FRED_API_KEY prompt "Free key from https://fredaccount.stlouisfed.org/apikeys"
ensure_secret SCHWAB_CLIENT_ID prompt "From your app at https://developer.schwab.com (read scopes only)"
ensure_secret SCHWAB_CLIENT_SECRET prompt "From the same Schwab app"
ensure_secret ANTHROPIC_API_KEY prompt "From https://console.anthropic.com (needed from Phase 3)"

# ---------------------------------------------------------------------------
bold "5. Service account"

SA="tradeit-run@${PROJECT}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  skip "service account exists"
else
  gcloud iam service-accounts create tradeit-run \
    --display-name="Tradeit Cloud Run" >/dev/null
  ok "created service account"
fi

for role in roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA" --role="$role" --condition=None >/dev/null
  ok "granted $role"
done

# ---------------------------------------------------------------------------
bold "6. Cloud Run"

CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/backend:latest"

# Only secrets that actually exist are wired in, so a skipped prompt above
# doesn't break the deploy.
SECRET_FLAGS=""
for name in DATABASE_URL JWT_SECRET JWT_REFRESH_SECRET FRED_API_KEY \
            SCHWAB_CLIENT_ID SCHWAB_CLIENT_SECRET ANTHROPIC_API_KEY; do
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    SECRET_FLAGS="${SECRET_FLAGS}${SECRET_FLAGS:+,}${name}=${name}:latest"
  fi
done

ENV_VARS="NODE_ENV=production,ALLOWED_EMAIL=pete@goodwellpartners.com,STARTING_CAPITAL=100000,MAX_DRAWDOWN=30000"

echo "  Images are built by cloudbuild.backend.yaml. If :latest does not exist"
echo "  yet, run that first, then re-run this script."
echo

if gcloud run services describe tradeit-api --region="$REGION" >/dev/null 2>&1; then
  skip "service tradeit-api exists — cloudbuild updates its image"
else
  gcloud run deploy tradeit-api \
    --image="$IMAGE" --region="$REGION" \
    --service-account="$SA" \
    --add-cloudsql-instances="$CONNECTION_NAME" \
    --set-env-vars="$ENV_VARS" \
    --set-secrets="$SECRET_FLAGS" \
    --allow-unauthenticated \
    --min-instances=0 --max-instances=2 >/dev/null
  ok "deployed tradeit-api"
fi

# The migrate and collect jobs run the same image with different commands, so a
# collector crash cannot take the API down with it.

if gcloud run jobs describe tradeit-migrate --region="$REGION" >/dev/null 2>&1; then
  skip "job tradeit-migrate exists"
else
  gcloud run jobs create tradeit-migrate \
    --image="$IMAGE" --region="$REGION" \
    --service-account="$SA" \
    --set-cloudsql-instances="$CONNECTION_NAME" \
    --set-env-vars="$ENV_VARS" \
    --set-secrets="$SECRET_FLAGS" \
    --max-retries=1 \
    --command=npx \
    --args="prisma,migrate,deploy,--schema,backend/prisma/schema.prisma" >/dev/null
  ok "created job tradeit-migrate"
fi

if gcloud run jobs describe tradeit-collect --region="$REGION" >/dev/null 2>&1; then
  skip "job tradeit-collect exists"
else
  gcloud run jobs create tradeit-collect \
    --image="$IMAGE" --region="$REGION" \
    --service-account="$SA" \
    --set-cloudsql-instances="$CONNECTION_NAME" \
    --set-env-vars="$ENV_VARS" \
    --set-secrets="$SECRET_FLAGS" \
    --max-retries=1 \
    --task-timeout=900s \
    --command=node \
    --args="backend/dist/jobs/collect.js" >/dev/null
  ok "created job tradeit-collect"
fi

# ---------------------------------------------------------------------------
bold "7. Scheduler"

# Weekdays at 18:10 Central, after FRED's daily publication settles.
if gcloud scheduler jobs describe tradeit-collect-daily --location="$REGION" >/dev/null 2>&1; then
  skip "scheduler job exists"
else
  gcloud scheduler jobs create http tradeit-collect-daily \
    --location="$REGION" \
    --schedule="10 18 * * 1-5" \
    --time-zone="America/Chicago" \
    --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/tradeit-collect:run" \
    --http-method=POST \
    --oauth-service-account-email="$SA" >/dev/null
  ok "created scheduler job"
fi

bold "Done"
echo "  Next: gcloud builds submit --config=cloudbuild.backend.yaml ."
echo "  Then: gcloud run jobs execute tradeit-collect --region=$REGION --wait"
