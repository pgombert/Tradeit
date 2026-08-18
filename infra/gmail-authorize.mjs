#!/usr/bin/env node
/**
 * One-time authorizer for the newsletter-inbox Gmail collector.
 *
 * Turns an OAuth client (client id + secret from the Google Cloud console) into
 * a long-lived refresh token, by running the consent flow against a loopback
 * server on this machine. Read-only scope: `gmail.readonly`, nothing else.
 *
 *   node infra/gmail-authorize.mjs
 *
 * It reads GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET from the environment if set,
 * and otherwise prompts for them with the terminal echo off. The refresh token
 * it prints is a secret — store it in `backend/.env` locally or Secret Manager
 * in production, never in a chat or a commit (docs/SETUP.md).
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { URL } from 'node:url';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const LOGIN_HINT = 'tradeit1971@gmail.com';
const PORT = Number(process.env.PORT ?? 3210);
const REDIRECT_URI = `http://localhost:${PORT}`;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Prompt on the terminal. When `hidden`, typed keystrokes are not echoed. */
function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Show the question, then mute the echo of whatever is typed after it.
      let questionShown = false;
      rl._writeToOutput = (str) => {
        if (!questionShown) rl.output.write(str);
      };
      rl.question(question, (answer) => {
        rl.output.write('\n');
        rl.close();
        resolve(answer.trim());
      });
      questionShown = true;
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    // Non-fatal — the URL is printed regardless.
  }
}

/** Wait for Google to redirect back to the loopback server with a code. */
function waitForCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url, REDIRECT_URI);
      if (reqUrl.pathname !== '/') {
        res.writeHead(404).end();
        return;
      }
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<html><body style="font:16px system-ui;padding:3rem;text-align:center">` +
          `<h2>${code ? 'Authorized ✅' : 'Authorization failed'}</h2>` +
          `<p>You can close this tab and return to the terminal.</p></body></html>`,
      );
      server.close();
      if (error) reject(new Error(`Google returned: ${error}`));
      else if (code) resolve(code);
      else reject(new Error('No code in the redirect.'));
    });
    server.on('error', reject);
    server.listen(PORT);
  });
}

async function exchangeCode(clientId, clientSecret, code) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.refresh_token) {
    const detail = json.error_description ?? json.error ?? `HTTP ${res.status}`;
    throw new Error(
      `Token exchange failed: ${detail}. ` +
        (json.refresh_token === undefined
          ? 'No refresh token was returned — Google only sends one on first consent. Remove Tradeit at ' +
            'https://myaccount.google.com/permissions and run this again.'
          : ''),
    );
  }
  return json.refresh_token;
}

async function main() {
  console.log('\nGmail newsletter-inbox authorizer\n' + '='.repeat(34) + '\n');

  const clientId = process.env.GMAIL_CLIENT_ID || (await prompt('GMAIL_CLIENT_ID: '));
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || (await prompt('GMAIL_CLIENT_SECRET (hidden): ', true));
  if (!clientId || !clientSecret) {
    console.error('\nBoth GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required.');
    process.exit(1);
  }

  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline'); // required for a refresh token
  authUrl.searchParams.set('prompt', 'consent'); // force a refresh token every time
  authUrl.searchParams.set('login_hint', LOGIN_HINT);

  console.log(`\nSign in as ${LOGIN_HINT} and grant read-only Gmail access.`);
  console.log('Opening your browser… if it does not open, paste this URL:\n');
  console.log(authUrl.toString() + '\n');
  openBrowser(authUrl.toString());

  const code = await waitForCode();
  const refreshToken = await exchangeCode(clientId, clientSecret, code);

  console.log('\n' + '='.repeat(60));
  console.log('SUCCESS. Your GMAIL_REFRESH_TOKEN (treat as a secret):\n');
  console.log(refreshToken);
  console.log('\n' + '='.repeat(60));
  console.log('\nNext:');
  console.log('  • Local:  put it in backend/.env alongside GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET,');
  console.log('            then run:  npm run collect -- gmail');
  console.log('  • Prod:   store it as the GMAIL_REFRESH_TOKEN secret (docs/SETUP.md).\n');
}

main().catch((err) => {
  console.error('\n' + (err instanceof Error ? err.message : String(err)) + '\n');
  process.exit(1);
});
