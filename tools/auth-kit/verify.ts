#!/usr/bin/env -S pnpm exec tsx
// 채널별 Keychain 항목 존재 + 1회성 read-only API 호출을 확인해 표로 찍는다.
// 값(토큰)은 절대 stdout에 찍지 않는다: 존재 확인은 `-w` 없이 하고, API 호출에만 값을
// 메모리로 읽어 바로 쓴다(A6 §9). 지금 배선된 채널은 어댑터가 실제로 있는 slack/gmail/gcal뿐
// (A1 §2.1-§2.3) — outlook/telegram은 어댑터 자체가 없어 대상 밖(각 README.ko.md 참고).

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
  /** 어댑터가 connect()에서 읽는 Keychain service 전부 — 하나라도 없으면 연결이 깨진다. */
  keychainServices: string[];
  keychainAccount: string;
  checkApi: () => Promise<{ ok: boolean; detail?: string }>;
}

type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const realExec: ExecFn = (cmd, args) => execFileAsync(cmd, args);

/** 존재만 확인한다 — `-w`를 안 써서 값은 절대 읽지도 찍지도 않는다. */
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

/** API 호출이 실제 값을 필요로 할 때만 쓴다. 반환값을 로그에 싣지 않는 건 호출자 책임. */
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

// ---- 실제 채널별 API 체크 — 구현된 어댑터만(slack/gmail/gcal). API는 어댑터가 쓰는 것과
// 같은 라이브러리를 쓰지만, connect()/subscribe()의 소켓·폴링 부담 없이 read-only 1콜만 한다. ----

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
      `${local} not found — cp tools/auth-kit/accounts.example.json tools/auth-kit/accounts.local.json 하고 값 채워넣기`,
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
      // connect()는 xoxb와 app-level(`.app`) 토큰을 둘 다 읽는다 —
      // packages/adapters/slack/src/index.ts. `.app`이 없으면 Socket Mode가 못 뜬다.
      keychainServices: [service, `${service}.app`],
      keychainAccount: teamId,
      checkApi: () => slackApiCheck(service, teamId),
    });
  }
  if (accounts.google) {
    const { email } = accounts.google;
    // Gmail·Calendar는 같은 refresh token을 공유한다(A1 §1.3 표, google-calendar adapter가
    // omnis.gmail.<email>을 그대로 재사용).
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
    console.log("accounts.local.json에 확인할 채널이 없다 (slack/google 둘 다 비어있음)");
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
