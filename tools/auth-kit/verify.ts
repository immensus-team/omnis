#!/usr/bin/env -S pnpm exec tsx
// Checks each channel's Keychain item existence plus a one-shot read-only API call, and prints a table.
// Token values are never printed to stdout: existence is checked without `-w`, and only the API call
// reads the value into memory and uses it immediately (A6 §9). The only channels wired up today are
// slack/gmail/gcal, which actually have adapters (A1 §2.1-§2.3) — outlook/telegram have no adapter at
// all, so they're out of scope (see each README.ko.md).

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACCOUNT = "281932556+jinhologankim@users.noreply.github.com";

export type KeychainStatus = "ok" | "missing";
export type ApiStatus = "ok" | "fail" | "skip";

export interface Row {
  channel: string;
  account: string;
  keychain: KeychainStatus;
  api: ApiStatus;
  detail: string;
}

export interface ChannelSpec {
  channel: string;
  account: string;
  /** Every Keychain service the adapter reads in connect() — missing even one breaks the connection. */
  keychainServices: string[];
  keychainAccount: string;
  checkApi: () => Promise<{ ok: boolean; detail?: string }>;
}

type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const realExec: ExecFn = (cmd, args) => execFileAsync(cmd, args);

/** Existence check only — `-w` is omitted, so the value is never read or printed. */
export async function checkKeychainItem(
  service: string,
  account: string,
  exec: ExecFn = realExec,
): Promise<KeychainStatus> {
  try {
    await exec("security", ["find-generic-password", "-s", service, "-a", account]);
    return "ok";
  } catch {
    return "missing";
  }
}

/** Use only when the API call genuinely needs the value. Keeping the return value out of logs is the caller's job. */
export async function readKeychainValue(
  service: string,
  account: string,
  exec: ExecFn = realExec,
): Promise<string> {
  const { stdout } = await exec("security", [
    "find-generic-password",
    "-s",
    service,
    "-a",
    account,
    "-w",
  ]);
  return stdout.trim();
}

export async function runVerify(
  specs: ChannelSpec[],
  checkKeychain: (service: string, account: string) => Promise<KeychainStatus> = checkKeychainItem,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const spec of specs) {
    let missing: string | undefined;
    for (const service of spec.keychainServices) {
      if ((await checkKeychain(service, spec.keychainAccount)) !== "ok") {
        missing = service;
        break;
      }
    }
    if (missing !== undefined) {
      rows.push({
        channel: spec.channel,
        account: spec.account,
        keychain: "missing",
        api: "skip",
        detail: `keychain item missing: ${missing}`,
      });
      continue;
    }
    const keychain: KeychainStatus = "ok";
    try {
      const result = await spec.checkApi();
      rows.push({
        channel: spec.channel,
        account: spec.account,
        keychain,
        api: result.ok ? "ok" : "fail",
        detail: result.detail ?? "",
      });
    } catch (cause) {
      rows.push({
        channel: spec.channel,
        account: spec.account,
        keychain,
        api: "fail",
        detail: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return rows;
}

export function formatReport(rows: Row[]): string {
  const header = ["channel", "keychain", "api", "account", "detail"];
  const table: string[][] = [
    header,
    ...rows.map((r) => [r.channel, r.keychain, r.api, r.account, r.detail]),
  ];
  const widths = header.map((_, col) => Math.max(...table.map((line) => line[col]?.length ?? 0)));
  return table
    .map((line) =>
      line
        .map((cell, col) => (cell ?? "").padEnd(widths[col] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

// ---- Actual per-channel API checks — implemented adapters only (slack/gmail/gcal). The API uses the
// same libraries the adapters do, but makes a single read-only call with none of connect()/subscribe()'s
// socket and polling overhead. ----

async function slackApiCheck(service: string, account: string) {
  const token = await readKeychainValue(service, account);
  const { WebClient } = await import("@slack/web-api");
  const res = await new WebClient(token).auth.test();
  return { ok: res.ok === true, detail: res.ok ? `team=${res.team}` : String(res.error ?? "") };
}

async function gmailApiCheck(service: string, account: string) {
  const [refreshToken, clientId, clientSecret] = await Promise.all([
    readKeychainValue(service, account),
    readKeychainValue("omnis.google.oauth_client_id", DEFAULT_ACCOUNT),
    readKeychainValue("omnis.google.oauth_client_secret", DEFAULT_ACCOUNT),
  ]);
  const { google } = await import("googleapis");
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth });
  const res = await gmail.users.getProfile({ userId: "me" });
  return { ok: true, detail: res.data.emailAddress ?? "" };
}

async function calendarApiCheck(service: string, account: string) {
  const [refreshToken, clientId, clientSecret] = await Promise.all([
    readKeychainValue(service, account),
    readKeychainValue("omnis.google.oauth_client_id", DEFAULT_ACCOUNT),
    readKeychainValue("omnis.google.oauth_client_secret", DEFAULT_ACCOUNT),
  ]);
  const { google } = await import("googleapis");
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  const calendar = google.calendar({ version: "v3", auth: oauth });
  const res = await calendar.calendarList.list({ maxResults: 1 });
  return { ok: true, detail: `${res.data.items?.length ?? 0} calendar(s)` };
}

interface AccountsConfig {
  slack?: { teamId: string };
  google?: { email: string };
}

function loadAccounts(): AccountsConfig {
  const local = path.join(DIR, "accounts.local.json");
  if (!existsSync(local)) {
    throw new Error(
      `${local} not found — run cp tools/auth-kit/accounts.example.json tools/auth-kit/accounts.local.json and fill in the values`,
    );
  }
  return JSON.parse(readFileSync(local, "utf8")) as AccountsConfig;
}

function buildSpecs(accounts: AccountsConfig): ChannelSpec[] {
  const specs: ChannelSpec[] = [];
  if (accounts.slack) {
    const { teamId } = accounts.slack;
    const service = `omnis.slack.xoxb.${teamId}`;
    specs.push({
      channel: "slack",
      account: teamId,
      // connect() reads both the xoxb and the app-level (`.app`) token —
      // packages/adapters/slack/src/index.ts. Without `.app`, Socket Mode can't come up.
      keychainServices: [service, `${service}.app`],
      keychainAccount: teamId,
      checkApi: () => slackApiCheck(service, teamId),
    });
  }
  if (accounts.google) {
    const { email } = accounts.google;
    // Gmail and Calendar share the same refresh token (A1 §1.3 table; the google-calendar adapter
    // reuses omnis.gmail.<email> as-is).
    const service = `omnis.gmail.${email}`;
    specs.push({
      channel: "gmail",
      account: email,
      keychainServices: [service],
      keychainAccount: email,
      checkApi: () => gmailApiCheck(service, email),
    });
    specs.push({
      channel: "gcal",
      account: email,
      keychainServices: [service],
      keychainAccount: email,
      checkApi: () => calendarApiCheck(service, email),
    });
  }
  return specs;
}

async function main() {
  const specs = buildSpecs(loadAccounts());
  if (specs.length === 0) {
    console.log("no channels to verify in accounts.local.json (both slack and google are empty)");
    return;
  }
  const rows = await runVerify(specs);
  console.log(formatReport(rows));
  if (rows.some((r) => r.api === "fail" || r.keychain === "missing")) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
