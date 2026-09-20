# Channels (Outlook · Telegram · Hermes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase B가 새로 여는 채널 표면 3종을 계약대로 구현한다 — Outlook(Graph delta 폴링), Telegram(mtcute), Hermes(HTTP 읽기 전용 에이전트 세션) — 그리고 실연결 하드닝(토큰 갱신·구독 재신청·어댑터 health→시스템 Item)을 커널에 배선한다. 전부 fixture/mock으로만 인수한다(B-D5, Logan 2026-09-20 결정: 실계정 연결은 나중에 한 번에).

**Architecture:** `packages/adapters/outlook`와 `packages/adapters/telegram`은 Phase A의 Slack/Gmail/Google-Calendar와 동일한 모양이다 — `@omnis/protocol`에만 의존하는 리프 패키지, raw 페이로드 → `NormalizedItem[]` 순수 함수 `normalize()`를 `Adapter` 객체와 분리해 export, `send()`는 주입 가능한 mock sink만 호출(승인 게이트 없이 비가역 전송 금지). Outlook은 Graph delta 폴링을 `subscribe()`(AsyncGenerator, Google Calendar의 syncToken 폴링과 동일 패턴)로 구현하고, Telegram은 실제 mtcute 클라이언트를 `TelegramClientLike`라는 이 패키지 소유의 얇은 인터페이스로 감싸 주입받는다(테스트는 fixture만, 실제 mtcute 배선은 A1-⑦ 스파이크 통과 후). Hermes는 `apps/local-agent`의 `RuntimeAdapter` 인터페이스(Claude Code/Codex와 동일 계약)를 구현하는 HTTP 클라이언트 하나이고 자식 프로세스를 spawn하지 않는다 — `session_key`를 `X-Hermes-Session-Key` 헤더에 얹고 `/v1/responses`의 SSE 스트림을 파싱해 keepalive(`:` 주석)는 버리고 delta/done만 `EventSink`로 올린다. 커널 하드닝(`packages/kernel/src/adapter-health.ts`, `src/jobs/{token-refresh,rewatch}.ts`)은 어댑터 SDK를 직접 import하지 않고 채널별 콜백을 주입받는다(provider SDK는 어댑터 패키지 안에서만, A7 §7 상속 금지 2).

**Tech Stack:** TypeScript 5.6.3(strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · zod ^3.24.1 · vitest 2.1.9 · pg 8.13.1 · `@microsoft/microsoft-graph-client 3.0.7` · `mtcute 0.29.x` · Node 22 fetch/ReadableStream(전역, 추가 HTTP 라이브러리 없음) · pnpm workspaces. 버전 핀 출처: `2026-09-20-phase-a-interfaces.md` §2 + `2026-09-20-phase-b-interfaces-delta.md` §1(FIXED).

**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` §16(Phase B 범위) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A1-channel-adapters.md` §1(공통 계약)·§2.4(Outlook)·§2.5(Telegram) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A2-agent-session-bridge.md` §2.1~2.2(local-agent 설정·재연결)·§4.4(Hermes) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A3-data-schema.md` §2(accounts/items/threads)·§11(하드 삭제 금지) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A6-ops-infra.md` §8(ntfy 라우팅) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-a-interfaces.md`(FIXED, 특히 §3·§6·§8) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-b-interfaces-delta.md`(FIXED, 특히 §5·§6·§8·§9) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-b-backlog.md`(US-B37~B40, B-D5).

## Global Constraints

- Node 22 + pnpm workspaces. TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`(루트 `tsconfig.base.json`). Postgres 17.
- 버전 핀(FIXED, 전 워크스페이스 동일): `vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `@rocicorp/zero 1.9.0`(exact) · `ai 7.0.107`. 이 플랜이 새로 더하는 핀: `@microsoft/microsoft-graph-client 3.0.7` · `mtcute 0.29.x`.
- 루트 스캐폴드(`pnpm-workspace.yaml`/`package.json`/`tsconfig.base.json`/`biome.jsonc`/`vitest.workspace.ts`)는 이미 존재한다(kernel-and-db Task 1이 Phase A에서 만들었다) — 이 플랜은 `test -f`로 존재만 확인하고 건드리지 않는다. `packages/adapters/*`는 `pnpm-workspace.yaml`에 이미 globbed(Phase A), 새 패키지 추가에 워크스페이스 파일 수정이 필요 없다.
- 마이그레이션은 append-only `packages/db/migrations/000N_<name>.sql`(다음 번호 **0012**, `packages/db/migrations/0011_push_subscriptions.sql`까지는 다른 플랜(surfaces/memory-ingestion) 소유라 이 워크트리엔 없을 수 있다 — migrate 러너는 파일명 정렬이라 gap이 있어도 깨지지 않는다). `0012_jobs_phase_b.sql`은 이 플랜(B37) + agents 플랜(B14, B15) + ops 플랜(B44)이 **공유 소유**한다 — 델타 §8 표를 그대로 옮긴 **결정론적** 내용이라 네 플랜이 각자 병렬 워크트리에서 같은 파일을 만들어도 머지 시 내용이 동일해 충돌하지 않는다(Task 6이 정확한 바이트를 명시한다).
- 테스트 DB는 `omnis_test`(로컬 Postgres 17 + pgvector), `DATABASE_URL` 없으면 `postgres://logan@127.0.0.1:5432/omnis_test`. 통합 테스트는 `pnpm --filter <pkg> test:integration`(vitest `integration` 프로젝트, singleFork 직렬).
- 커밋 전 `pnpm lint`(biome). 커밋 메시지는 헤더 `<story-id>: <한 줄 요약>`, 본문에 충족한 acceptance criteria, `Implemented-by: Claude <tier>` 한 줄, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **비가역 tool 금지**: `send()`는 승인 게이트(Phase A US-A07, 이미 존재) 밖에서 실제 채널 API를 호출하지 않는다 — 이 플랜의 모든 어댑터 `send()`는 주입 가능한 mock sink만 부른다. Hermes는 애초에 읽기 전용(`origin:'human'`만, delegation 거부)이라 승인 표면 자체가 없다(A2-D9).
- **provider SDK는 그 어댑터 패키지 안에서만** import한다(`@microsoft/microsoft-graph-client`는 `packages/adapters/outlook`, `mtcute`는 `packages/adapters/telegram` 밖으로 나가지 않는다). `packages/kernel`은 채널 SDK를 절대 import하지 않고 콜백을 주입받는다.
- **하드 삭제 경로를 만들지 않는다**(A3 §11). Outlook delta의 `@removed` tombstone과 Telegram의 삭제 업데이트는 `normalize()`가 빈 배열을 반환할 뿐 — `items`에서 실제로 지우는 코드는 어디에도 없다.
- **실계정 자격증명을 테스트에 넣지 않는다**(B-D5). Outlook/Telegram/Hermes 전부 fixture replay + 주입된 mock client/fetch로만 인수한다. `~/.claude/.credentials.json`류를 읽지 않는다.
- 스토리 티어(백로그 §2): US-B37/B38/B40 = Sonnet, US-B39 = Opus(HTTP 브리지 어댑터, A2 §4.4의 세션 매핑·SSE 파싱이 A2-D1/A2-D9의 안전 불변식과 맞물린다).

---

### Task 1: Outlook 어댑터 — 패키지 스캐폴드 + `normalize()` (US-B37, tier: Sonnet)

**US-B37 산출물(델타 §11):** `packages/adapters/outlook/src/index.ts`, `packages/adapters/outlook/fixtures/*.json`. **검증 명령:** `pnpm --filter @omnis/adapter-outlook test && pnpm test:contract`. **목표:** Graph delta 폴링 Outlook 어댑터, fixture 계약 테스트로만 인수(B-D5).

**Files:**
- Create: `packages/adapters/outlook/package.json`, `packages/adapters/outlook/tsconfig.json`, `packages/adapters/outlook/vitest.config.ts`
- Create: `packages/adapters/outlook/src/keychain.ts`, `packages/adapters/outlook/src/index.ts`
- Test: `packages/adapters/outlook/test/normalize.test.ts`

**Interfaces:** Consumes: `@omnis/protocol`의 `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health`/`NormalizedItem`/`Attachment`(Phase A 계약 §3.2~3.3, FIXED, 그대로 복사). Produces: `CHANNEL`(`"outlook"` — `accounts_channel_ck`가 이미 이 값을 포함, A3 §8 실측), `normalize(raw: unknown): NormalizedItem[]`.

읽을 스펙: A1 §2.4(thread=`conversationId`, item=`id`, `sourceHash=internetMessageId`, write-back 3종). Keychain 항목명은 일반형 `omnis.outlook.<upn>`(interfaces.md §9, Google 계열 같은 예외 없음).

- [ ] 1. 패키지 스캐폴드를 만든다.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/src
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/test
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/package.json <<'EOF'
  {
    "name": "@omnis/adapter-outlook",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": { "build": "tsc --build", "test": "vitest run" },
    "dependencies": {
      "@omnis/protocol": "workspace:*",
      "@microsoft/microsoft-graph-client": "3.0.7"
    },
    "devDependencies": { "typescript": "5.6.3", "vitest": "2.1.9" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/tsconfig.json <<'EOF'
  {
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "references": [{ "path": "../../protocol" }],
    "include": ["src"]
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/vitest.config.ts <<'EOF'
  import { defineConfig } from "vitest/config";
  import { omnisAlias } from "../../../vitest.shared.js";

  export default defineConfig({
    resolve: { alias: omnisAlias },
    test: { environment: "node" },
  });
  EOF
  ```

- [ ] 2. Keychain 래퍼를 작성한다: `packages/adapters/outlook/src/keychain.ts` (Gmail/Slack Task와 동일 패턴 — 어댑터 패키지 간 import 금지라 복제한다, A7 §9 "의도된 중복").

  ```ts
  import { execFile } from "node:child_process";
  import { promisify } from "node:util";
  import { AdapterError, type Channel } from "@omnis/protocol";

  const execFileAsync = promisify(execFile);

  export async function readKeychainSecret(
    service: string,
    account: string,
    channel: Channel,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
      ]);
      return stdout.trim();
    } catch (cause) {
      throw new AdapterError(
        "auth_expired",
        channel,
        `Keychain item ${service}/${account} not found or locked`,
        undefined,
        cause,
      );
    }
  }
  ```

- [ ] 3. 실패하는 테스트를 작성한다: `packages/adapters/outlook/test/normalize.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { normalize } from "../src/index.js";

  describe("Outlook normalize()", () => {
    it("maps a Graph message to a NormalizedItem keyed by conversationId/internetMessageId", () => {
      const items = normalize({
        id: "AAMkAGI1AAA=",
        conversationId: "AAQkAGI1conv",
        internetMessageId: "<msg-001@outlook.com>",
        subject: "omnis launch sync",
        body: { contentType: "text", content: "Let's sync tomorrow at 10am." },
        from: { emailAddress: { name: "Dana Lee", address: "dana@example.com" } },
        toRecipients: [{ emailAddress: { name: "Logan", address: "logan@example.com" } }],
        receivedDateTime: "2023-11-14T22:13:20Z",
      });
      expect(items).toEqual([
        {
          threadExternalId: "AAQkAGI1conv",
          externalId: "AAMkAGI1AAA=",
          kind: "email",
          author: { kind: "person", id: "dana@example.com" },
          body: "Subject: omnis launch sync\n\nLet's sync tomorrow at 10am.",
          attachments: [],
          sentAt: "2023-11-14T22:13:20.000Z",
          status: "received",
          sourceHash: "<msg-001@outlook.com>",
          threadMeta: {
            externalId: "AAQkAGI1conv",
            kind: "email",
            title: "omnis launch sync",
            participants: [
              { externalId: "dana@example.com", displayName: "Dana Lee" },
              { externalId: "logan@example.com", displayName: "Logan" },
            ],
            lastItemAt: "2023-11-14T22:13:20.000Z",
            archivedAt: null,
          },
        },
      ]);
    });

    it("strips HTML bodies and returns [] for delta tombstones (@removed)", () => {
      expect(
        normalize({
          id: "x",
          conversationId: "c",
          internetMessageId: "<m@x>",
          subject: "s",
          body: { contentType: "html", content: "<p>hi <b>there</b></p>" },
          from: { emailAddress: { address: "a@x.com" } },
          receivedDateTime: "2023-11-14T22:13:20Z",
        })[0]?.body,
      ).toBe("Subject: s\n\nhi there");
      expect(normalize({ id: "x", conversationId: "c", "@removed": { reason: "deleted" } })).toEqual([]);
      expect(normalize({ id: "x" })).toEqual([]); // conversationId 없음
    });
  });
  ```

- [ ] 4. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-outlook test
  ```

  예상 실패: `Cannot find module '../src/index.js'`.

- [ ] 5. `src/index.ts`에 `CHANNEL`과 `normalize()`만 작성한다(어댑터 본체는 Task 2~5가 채운다).

  ```ts
  import type { Attachment, NormalizedItem } from "@omnis/protocol";

  export const CHANNEL = "outlook" as const;

  interface GraphAddress {
    emailAddress?: { name?: string; address?: string };
  }
  interface GraphMessage {
    id?: string;
    conversationId?: string;
    internetMessageId?: string;
    subject?: string;
    body?: { contentType?: string; content?: string };
    from?: GraphAddress;
    toRecipients?: GraphAddress[];
    ccRecipients?: GraphAddress[];
    receivedDateTime?: string;
    "@removed"?: { reason?: string };
  }

  /** ponytail: 정규식 태그 제거만 한다 — 완전한 HTML→텍스트 변환이 필요해지면(표·리스트 서식 깨짐이
   *  체감되면) 그때 라이브러리로 승격한다. Gmail/Graph 둘 다 body를 그대로 저장하고 검색은
   *  `items.search_tsv`(plain 텍스트)가 하므로 v1은 이걸로 충분하다. */
  function stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function addr(a?: GraphAddress): { externalId: string; displayName: string } | null {
    const email = a?.emailAddress?.address;
    if (!email) return null;
    return { externalId: email, displayName: a?.emailAddress?.name || email };
  }

  export function normalize(raw: unknown): NormalizedItem[] {
    const m = raw as GraphMessage;
    // delta tombstone: 삭제된 메시지를 알리는 행이라 콘텐츠가 없다. items를 지우지 않는다(A3 §11) —
    // 그냥 아이템을 만들지 않을 뿐이다.
    if (m["@removed"] !== undefined) return [];
    if (!m.id || !m.conversationId) return [];

    const bodyText =
      m.body?.contentType === "html" ? stripHtml(m.body.content ?? "") : (m.body?.content ?? "");
    const participants = [addr(m.from), ...(m.toRecipients ?? []).map(addr), ...(m.ccRecipients ?? []).map(addr)]
      .filter((p): p is { externalId: string; displayName: string } => p !== null)
      .filter((p, i, all) => all.findIndex((o) => o.externalId === p.externalId) === i);
    const sentAt = m.receivedDateTime ?? new Date().toISOString();
    const attachments: Attachment[] = []; // 다운로드는 /attachments 개별 호출(A1 §2.4) — Gmail과 동일 원칙

    return [
      {
        threadExternalId: m.conversationId,
        externalId: m.id,
        kind: "email",
        author: { kind: "person", id: m.from?.emailAddress?.address ?? "" },
        body: m.subject ? `Subject: ${m.subject}\n\n${bodyText}` : bodyText,
        attachments,
        sentAt,
        status: "received",
        sourceHash: m.internetMessageId || m.id,
        threadMeta: {
          externalId: m.conversationId,
          kind: "email",
          title: m.subject || null,
          participants,
          lastItemAt: sentAt,
          archivedAt: null,
        },
      },
    ];
  }
  ```

- [ ] 6. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-outlook test
  ```

  예상 출력: `Tests  2 passed (2)`.

- [ ] 7. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/outlook
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook 어댑터 스캐폴드 + normalize()

  - thread=conversationId, item=id, sourceHash=internetMessageId(A1 §2.4)
  - HTML 본문은 정규식 stripHtml, delta tombstone(@removed)은 빈 배열(A3 §11 하드 삭제 금지)
  - Keychain omnis.outlook.<upn> 래퍼(일반형, Google 계열 예외 없음)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Outlook 어댑터 — `mapApiError()` + fixture 5종 + 계약 테스트 (US-B37, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/adapter-outlook test && pnpm test:contract`.

**Files:**
- Modify: `packages/adapters/outlook/src/index.ts`
- Create: `packages/adapters/outlook/fixtures/{text_message,thread_reply,attachment,rate_limited_response,auth_error_response}.json`
- Create: `packages/adapters/outlook/test/contract.test.ts`

**Interfaces:** Consumes: Task 1의 `normalize()`. Produces: `mapApiError(cause: unknown): AdapterError`.

읽을 스펙: A1 §1.4(에러 6종 분류 표) · A1 §2.4(429+Retry-After, 410 delta 만료는 mapApiError가 아니라 폴링 루프가 직접 잡는다 — Task 5). 최소 시나리오 5종은 interfaces.md §9(Phase A 그대로, Outlook은 Telegram과 달리 edited/deleted 추가분 없음, 델타 §12).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/outlook/test/mapApiError.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { mapApiError } from "../src/index.js";

  describe("Outlook mapApiError()", () => {
    it("maps 429 with Retry-After to retryable_rate_limit", () => {
      const err = mapApiError({ statusCode: 429, headers: { "retry-after": "30" } });
      expect(err.kind).toBe("retryable_rate_limit");
      expect(err.retryAfterMs).toBe(30_000);
    });
    it("maps 401 to auth_expired and 403 to auth_revoked", () => {
      expect(mapApiError({ statusCode: 401 }).kind).toBe("auth_expired");
      expect(mapApiError({ statusCode: 403 }).kind).toBe("auth_revoked");
    });
    it("falls back to retryable_network for unmapped statuses", () => {
      expect(mapApiError({ statusCode: 500 }).kind).toBe("retryable_network");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/adapter-outlook test` — 예상 실패: `mapApiError is not a function`.

- [ ] 3. `src/index.ts`에 `mapApiError()`를 추가한다(`AdapterError`를 기존 import에 더한다).

  ```ts
  export function mapApiError(cause: unknown): AdapterError {
    const err = cause as { statusCode?: number; headers?: Record<string, string> };
    if (err.statusCode === 429) {
      const retryAfterSec = Number(err.headers?.["retry-after"] ?? "60");
      return new AdapterError(
        "retryable_rate_limit",
        CHANNEL,
        "Graph API rate limited",
        retryAfterSec * 1000,
        cause,
      );
    }
    if (err.statusCode === 401)
      return new AdapterError("auth_expired", CHANNEL, "Graph API auth expired", undefined, cause);
    if (err.statusCode === 403)
      return new AdapterError("auth_revoked", CHANNEL, "Graph API access forbidden", undefined, cause);
    return new AdapterError("retryable_network", CHANNEL, "Graph API call failed", undefined, cause);
  }
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/adapter-outlook test` — 예상 출력: `Tests  3 passed (3)`(+ Task 1의 2건 = 5).

- [ ] 5. fixture 5종을 만든다.

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/text_message.json <<'EOF'
  {
    "scenario": "text_message",
    "raw": {
      "id": "AAMkAGI1msg001",
      "conversationId": "AAQkAGI1conv001",
      "internetMessageId": "<msg-001@outlook.com>",
      "subject": "omnis launch sync",
      "body": { "contentType": "text", "content": "Let's sync tomorrow at 10am about the omnis launch." },
      "from": { "emailAddress": { "name": "Dana Lee", "address": "dana@example.com" } },
      "toRecipients": [{ "emailAddress": { "name": "Logan", "address": "logan@example.com" } }],
      "receivedDateTime": "2023-11-14T22:13:20Z"
    },
    "expected": {
      "items": [
        {
          "threadExternalId": "AAQkAGI1conv001",
          "externalId": "AAMkAGI1msg001",
          "kind": "email",
          "author": { "kind": "person", "id": "dana@example.com" },
          "body": "Subject: omnis launch sync\n\nLet's sync tomorrow at 10am about the omnis launch.",
          "attachments": [],
          "sentAt": "2023-11-14T22:13:20.000Z",
          "status": "received",
          "sourceHash": "<msg-001@outlook.com>",
          "threadMeta": {
            "externalId": "AAQkAGI1conv001",
            "kind": "email",
            "title": "omnis launch sync",
            "participants": [
              { "externalId": "dana@example.com", "displayName": "Dana Lee" },
              { "externalId": "logan@example.com", "displayName": "Logan" }
            ],
            "lastItemAt": "2023-11-14T22:13:20.000Z",
            "archivedAt": null
          }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/thread_reply.json <<'EOF'
  {
    "scenario": "thread_reply",
    "raw": {
      "id": "AAMkAGI1msg002",
      "conversationId": "AAQkAGI1conv001",
      "internetMessageId": "<msg-002@outlook.com>",
      "subject": "RE: omnis launch sync",
      "body": { "contentType": "text", "content": "10am works for me." },
      "from": { "emailAddress": { "name": "Logan", "address": "logan@example.com" } },
      "toRecipients": [{ "emailAddress": { "name": "Dana Lee", "address": "dana@example.com" } }],
      "receivedDateTime": "2023-11-14T23:00:00Z"
    },
    "expected": {
      "items": [
        {
          "threadExternalId": "AAQkAGI1conv001",
          "externalId": "AAMkAGI1msg002",
          "kind": "email",
          "author": { "kind": "person", "id": "logan@example.com" },
          "body": "Subject: RE: omnis launch sync\n\n10am works for me.",
          "attachments": [],
          "sentAt": "2023-11-14T23:00:00.000Z",
          "status": "received",
          "sourceHash": "<msg-002@outlook.com>",
          "threadMeta": {
            "externalId": "AAQkAGI1conv001",
            "kind": "email",
            "title": "RE: omnis launch sync",
            "participants": [
              { "externalId": "logan@example.com", "displayName": "Logan" },
              { "externalId": "dana@example.com", "displayName": "Dana Lee" }
            ],
            "lastItemAt": "2023-11-14T23:00:00.000Z",
            "archivedAt": null
          }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/attachment.json <<'EOF'
  {
    "scenario": "attachment",
    "raw": {
      "id": "AAMkAGI1msg003",
      "conversationId": "AAQkAGI1conv002",
      "internetMessageId": "<msg-003@outlook.com>",
      "subject": "PoC slides",
      "body": { "contentType": "text", "content": "" },
      "from": { "emailAddress": { "name": "Dana Lee", "address": "dana@example.com" } },
      "receivedDateTime": "2023-11-14T23:30:00Z",
      "hasAttachments": true
    },
    "expected": {
      "items": [
        {
          "threadExternalId": "AAQkAGI1conv002",
          "externalId": "AAMkAGI1msg003",
          "kind": "email",
          "author": { "kind": "person", "id": "dana@example.com" },
          "body": "Subject: PoC slides\n\n",
          "attachments": [],
          "sentAt": "2023-11-14T23:30:00.000Z",
          "status": "received",
          "sourceHash": "<msg-003@outlook.com>",
          "threadMeta": {
            "externalId": "AAQkAGI1conv002",
            "kind": "email",
            "title": "PoC slides",
            "participants": [{ "externalId": "dana@example.com", "displayName": "Dana Lee" }],
            "lastItemAt": "2023-11-14T23:30:00.000Z",
            "archivedAt": null
          }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/rate_limited_response.json <<'EOF'
  {
    "scenario": "rate_limited_response",
    "raw": { "statusCode": 429, "headers": { "retry-after": "30" } },
    "expected": { "errorKind": "retryable_rate_limit" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/auth_error_response.json <<'EOF'
  {
    "scenario": "auth_error_response",
    "raw": { "statusCode": 401 },
    "expected": { "errorKind": "auth_expired" }
  }
  EOF
  ```

- [ ] 6. 계약 테스트를 작성한다: `packages/adapters/outlook/test/contract.test.ts` (Gmail Task 동일 패턴 그대로 복제)

  ```ts
  import { readFileSync, readdirSync } from "node:fs";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  import { describe, expect, it } from "vitest";
  import { mapApiError, normalize } from "../src/index.js";

  interface Fixture {
    scenario: string;
    raw: unknown;
    expected: { items?: unknown[]; errorKind?: string };
  }

  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  describe("Outlook contract: fixture replay", () => {
    for (const file of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
      it(`${fixture.scenario} (${file})`, () => {
        if (fixture.expected.errorKind) {
          const err = mapApiError(fixture.raw);
          expect(err.kind).toBe(fixture.expected.errorKind);
        } else {
          expect(normalize(fixture.raw)).toEqual(fixture.expected.items);
        }
      });
    }
  });
  ```

- [ ] 7. 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm --filter @omnis/adapter-outlook test
  pnpm test:contract
  ```

  예상 출력: 두 명령 모두 실패 0건(계약 프로젝트는 `packages/adapters/*/test/contract.test.ts`를 이미 glob한다, `vitest.workspace.ts` FIXED).

- [ ] 8. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/outlook
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook mapApiError() + fixture 5종 계약 테스트

  - 429(Retry-After 존중)/401/403/기타를 A1 §1.4 표대로 분류
  - fixture 5종(text_message/thread_reply/attachment/rate_limited/auth_error) — B-D5 fixture 인수

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Outlook 어댑터 — `connect()`/`disconnect()`/`health()` (`/common` OAuth) (US-B37, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/adapter-outlook test`.

**Files:** Modify: `packages/adapters/outlook/src/index.ts`. Test: `packages/adapters/outlook/test/connect.test.ts`.

**Interfaces:** Consumes: `readKeychainSecret`(Task 1). Produces: `OutlookAdapterDeps`, `GraphClientLike`(이 파일 소유의 얇은 duck-typed 인터페이스 — 실제 `Client.init(...)`이 구조적으로 만족한다, Gmail의 `OAuth2Client` 이중 타입 회피와 같은 이유), `refreshAccessToken()`, `createOutlookAdapter(deps): Adapter`.

읽을 스펙: A1 §2.4(`/common` authority, 위임 스코프 3종, refresh token → `omnis.outlook.<upn>`).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/outlook/test/connect.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createOutlookAdapter, refreshAccessToken } from "../src/index.js";

  describe("refreshAccessToken()", () => {
    it("POSTs the /common token endpoint with the refresh_token grant", async () => {
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 }),
      );
      const result = await refreshAccessToken("client-1", "refresh-tok", fetchFn as unknown as typeof fetch);
      expect(result).toEqual({ accessToken: "tok-1", expiresIn: 3600 });
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
      expect(String(init.body)).toContain("grant_type=refresh_token");
    });
    it("throws auth_revoked when the token endpoint rejects", async () => {
      const fetchFn = vi.fn(async () => new Response("bad", { status: 401 }));
      await expect(
        refreshAccessToken("client-1", "bad-tok", fetchFn as unknown as typeof fetch),
      ).rejects.toMatchObject({ kind: "auth_revoked" });
    });
  });

  describe("Outlook adapter connect()/health()", () => {
    it("reads the refresh token from Keychain, refreshes, and reports healthy", async () => {
      vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "refresh-tok") }));
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 }),
      );
      const adapter = createOutlookAdapter({ oauthClientId: "client-1", fetchFn: fetchFn as unknown as typeof fetch });
      await adapter.connect({
        channel: "outlook",
        accountExternalId: "logan@outlook.com",
        keychainService: "omnis.outlook.logan@outlook.com",
        keychainAccount: "logan@outlook.com",
      });
      expect((await adapter.health()).status).toBe("healthy");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/adapter-outlook test` — 예상 실패: `createOutlookAdapter is not a function`.

- [ ] 3. `src/index.ts`에 `refreshAccessToken()`, `GraphClientLike`, `OutlookAdapterDeps`, `createOutlookAdapter()`(connect/disconnect/health만, backfill/subscribe/send는 `fatal_unsupported` 스텁)를 추가한다.

  ```ts
  import {
    type Adapter,
    AdapterError,
    type AdapterEvent,
    type AuthRef,
    type Capabilities,
    type Health,
    type Outbound,
    type SendResult,
    type ThreadRef,
  } from "@omnis/protocol";
  import { readKeychainSecret } from "./keychain.js";
  // (NormalizedItem/Attachment는 이미 import되어 있다 — Task 1)

  const CAPABILITIES: Capabilities = {
    read: true,
    write: true,
    realtime: false, // delta 폴링이지 push가 아니다(A1 §2.4 "webhook 전 단계")
    history: true,
    media: true,
    markRead: true,
    typing: false,
    archive: true,
    delete: false,
  };

  /** 이 어댑터가 실제로 부르는 부분집합만 duck-typing한다 — `@microsoft/microsoft-graph-client`의
   *  `Client` 인스턴스가 구조적으로 이 인터페이스를 만족하므로 실제 SDK와 테스트 mock 둘 다 통과한다
   *  (Gmail의 OAuth2Client 이중 타입 회피와 같은 이유, packages/adapters/gmail/src/index.ts 상단 주석 참고). */
  export interface GraphClientLike {
    api(path: string): {
      get(): Promise<Record<string, unknown>>;
      patch(body: unknown): Promise<unknown>;
      post(body: unknown): Promise<unknown>;
    };
  }

  export async function refreshAccessToken(
    clientId: string,
    refreshToken: string,
    fetchFn: typeof fetch,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const res = await fetchFn("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite",
      }).toString(),
    });
    if (!res.ok) {
      throw new AdapterError(
        "auth_revoked",
        CHANNEL,
        `Outlook token refresh failed: ${res.status}`,
        undefined,
        await res.text().catch(() => undefined),
      );
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    return { accessToken: body.access_token, expiresIn: body.expires_in };
  }

  export interface OutlookAdapterDeps {
    oauthClientId: string;
    graphClient?: GraphClientLike;
    fetchFn?: typeof fetch;
    pollIntervalMs?: number; // subscribe() delta 폴링 간격, 기본 5분(jobs.outlook_delta_poll 주기와 동일)
    sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
    now?: () => Date;
  }

  export function createOutlookAdapter(deps: OutlookAdapterDeps): Adapter {
    const now = deps.now ?? ((): Date => new Date());
    const fetchFn = deps.fetchFn ?? fetch;
    let graphClient: GraphClientLike | undefined = deps.graphClient;
    let status: Health["status"] = "down";
    let lastEventAt: string | null = null;
    let lastError: Health["lastError"];

    return {
      id: "outlook",
      channel: CHANNEL,
      capabilities: () => CAPABILITIES,

      async connect(auth: AuthRef): Promise<void> {
        const refreshToken = await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
        try {
          const { accessToken } = await refreshAccessToken(deps.oauthClientId, refreshToken, fetchFn);
          if (deps.graphClient === undefined) {
            const { Client } = await import("@microsoft/microsoft-graph-client");
            graphClient = Client.init({
              authProvider: (done) => done(null, accessToken),
            }) as unknown as GraphClientLike;
          }
        } catch (cause) {
          status = "down";
          if (cause instanceof AdapterError) throw cause;
          throw new AdapterError("auth_revoked", CHANNEL, "Outlook connect failed", undefined, cause);
        }
        status = "healthy";
        lastEventAt = now().toISOString();
      },

      async disconnect(): Promise<void> {
        status = "down";
      },

      async *backfill(): AsyncIterable<NormalizedItem> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 4");
      },

      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "subscribe not implemented until Task 4");
      },

      async send(): Promise<never> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 5");
      },

      async health(): Promise<Health> {
        return {
          channel: CHANNEL,
          accountExternalId: "",
          status,
          lastEventAt,
          ...(lastError ? { lastError } : {}),
        };
      },
    };
  }
  ```

  `graphClient`/`status`/`lastError` 변수 선언은 이미 Task 1~2에서 파일 상단에 없었으므로 이 스텝이 처음 `createOutlookAdapter`를 도입한다 — Task 4·5는 이 함수 본문의 `backfill`/`subscribe`/`send` 스텁만 갈아 끼운다.

- [ ] 4. `@microsoft/microsoft-graph-client`의 동적 import가 타입 체크를 통과하도록 devDependency로 `@microsoft/microsoft-graph-client`의 타입을 이미 dependencies에 선언했음을 확인한다(Task 1). 추가 설치 없이 테스트를 실행한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-outlook test
  ```

  예상 출력: `Tests  ... passed`(mapApiError·normalize·connect 전부).

- [ ] 5. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/outlook
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook connect()/health() — /common OAuth refresh-token 흐름

  - refreshAccessToken()이 login.microsoftonline.com/common/oauth2/v2.0/token을 fetch로 호출
  - 실패 시 auth_revoked(A1 §1.4, 자동 재시도 금지)
  - GraphClientLike duck-typing으로 실제 SDK/테스트 mock 둘 다 만족
  - backfill()/subscribe()/send()는 아직 fatal_unsupported(Task 4·5)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Outlook 어댑터 — `backfill()` + `subscribe()` delta 폴링 + 스파이크 스캐폴드 (US-B37, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/adapter-outlook test`.

**Files:** Modify: `packages/adapters/outlook/src/index.ts`. Test: `packages/adapters/outlook/test/backfill.test.ts`. Create: `tools/spikes/a1-6-outlook-graph-delta/{probe.ts,result.md}`.

**Interfaces:** Consumes: `GraphClientLike`, `mapApiError()`(Task 2·3). Produces: `backfill(since?)`/`subscribe()` 구현.

읽을 스펙: A1 §2.4(backfill=최근 30일 `messages` 목록, delta 폴링, 410→풀 재동기화). 폴링 루프는 Google Calendar 어댑터의 `syncToken` 패턴(`packages/adapters/google-calendar/src/index.ts` `subscribe()`)을 그대로 복제한다 — `deltaLink`/`nextLink`만 이름이 다르다.

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/outlook/test/backfill.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createOutlookAdapter } from "../src/index.js";
  import type { GraphClientLike } from "../src/index.js";

  function fakeAuth() {
    return {
      channel: "outlook" as const,
      accountExternalId: "logan@outlook.com",
      keychainService: "omnis.outlook.logan@outlook.com",
      keychainAccount: "logan@outlook.com",
    };
  }

  describe("Outlook backfill()", () => {
    it("paginates /me/mailFolders/inbox/messages via @odata.nextLink", async () => {
      const pages = [
        { value: [{ id: "m1", conversationId: "c1", internetMessageId: "<m1>", from: { emailAddress: { address: "a@x.com" } }, body: { contentType: "text", content: "hi" }, receivedDateTime: "2023-11-14T00:00:00Z" }], "@odata.nextLink": "page2" },
        { value: [{ id: "m2", conversationId: "c1", internetMessageId: "<m2>", from: { emailAddress: { address: "a@x.com" } }, body: { contentType: "text", content: "bye" }, receivedDateTime: "2023-11-15T00:00:00Z" }] },
      ];
      let call = 0;
      const graphClient: GraphClientLike = {
        api: () => ({
          get: async () => pages[call++] as Record<string, unknown>,
          patch: async () => ({}),
          post: async () => ({}),
        }),
      };
      const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient });
      await adapter.connect(fakeAuth());
      const items = [];
      for await (const item of adapter.backfill()) items.push(item);
      expect(items.map((i) => i.externalId)).toEqual(["m1", "m2"]);
    });
  });

  describe("Outlook subscribe()", () => {
    it("resets to the base delta URL on 410 and keeps yielding", async () => {
      let call = 0;
      const graphClient: GraphClientLike = {
        api: () => ({
          get: async () => {
            call += 1;
            if (call === 1) {
              const err = new Error("Gone") as Error & { statusCode: number };
              err.statusCode = 410;
              throw err;
            }
            return { value: [{ id: "m3", conversationId: "c3", internetMessageId: "<m3>", from: { emailAddress: { address: "b@x.com" } }, body: { contentType: "text", content: "new" }, receivedDateTime: "2023-11-16T00:00:00Z" }], "@odata.deltaLink": "delta-2" };
          },
          patch: async () => ({}),
          post: async () => ({}),
        }),
      };
      const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient, pollIntervalMs: 0 });
      await adapter.connect(fakeAuth());
      const it1 = adapter.subscribe()[Symbol.asyncIterator]();
      const first = await it1.next();
      expect(first.done).toBe(false);
      expect((first.value as { externalId?: string }).externalId).toBe("m3");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/adapter-outlook test` — 예상 실패: `backfill()`/`subscribe()`가 여전히 `fatal_unsupported`를 던진다.

- [ ] 3. `src/index.ts`의 `backfill`/`subscribe` 스텁을 실제 구현으로 갈아 끼운다.

  ```ts
  async *backfill(): AsyncIterable<NormalizedItem> {
    if (graphClient === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
    const client = graphClient;
    let link = "/me/mailFolders/inbox/messages?$top=50";
    for (;;) {
      let res: { value?: unknown[]; "@odata.nextLink"?: string };
      try {
        res = (await client.api(link.startsWith("http") ? link : link).get()) as {
          value?: unknown[];
          "@odata.nextLink"?: string;
        };
      } catch (cause) {
        throw mapApiError(cause);
      }
      for (const raw of res.value ?? []) {
        for (const item of normalize(raw)) yield item;
      }
      const next = res["@odata.nextLink"];
      if (next === undefined) break;
      link = next;
    }
  }

  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
    if (graphClient === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "subscribe() called before connect()");
    const client = graphClient;
    const intervalMs = deps.pollIntervalMs ?? 300_000; // outlook_delta_poll cron */5 * * * *
    const BASE = "/me/mailFolders/inbox/messages/delta";

    async function* poll(): AsyncGenerator<NormalizedItem | AdapterEvent> {
      let link = BASE;
      for (;;) {
        let res: { value?: unknown[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
        try {
          res = (await client.api(link).get()) as {
            value?: unknown[];
            "@odata.nextLink"?: string;
            "@odata.deltaLink"?: string;
          };
        } catch (cause) {
          const err = cause as { statusCode?: number };
          if (err.statusCode === 410) {
            link = BASE; // delta token 만료 → 풀 재동기화(A1 §2.4)
            continue;
          }
          throw mapApiError(cause);
        }
        for (const raw of res.value ?? []) {
          for (const item of normalize(raw)) yield item;
        }
        const settled = res["@odata.deltaLink"];
        link = res["@odata.nextLink"] ?? settled ?? BASE;
        if (settled !== undefined && intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    return poll();
  }
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/adapter-outlook test`.

- [ ] 5. A1-⑥ 스파이크 스캐폴드를 만든다(백로그 §5 "Phase B 진입 스파이크" 소유분). B-D5로 실계정 연결이 뒤로 미뤄졌으므로 `result.md`는 PENDING으로 남기고, 실계정이 연결되는 시점에 `probe.ts`를 그대로 돌려 채운다.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-6-outlook-graph-delta
  cat > /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-6-outlook-graph-delta/probe.ts <<'EOF'
  // A1-⑥: Graph delta query(/me/mailFolders/inbox/messages/delta)가 문서대로 동작하는지 실계정으로 확인한다.
  // 실행: OMNIS_OUTLOOK_ACCESS_TOKEN=<token> tsx tools/spikes/a1-6-outlook-graph-delta/probe.ts
  const token = process.env.OMNIS_OUTLOOK_ACCESS_TOKEN;
  if (!token) {
    console.error("OMNIS_OUTLOOK_ACCESS_TOKEN not set — B-D5: 실계정 연결 전에는 이 스파이크를 돌리지 않는다.");
    process.exit(1);
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta", {
    headers: { authorization: `Bearer ${token}` },
  });
  console.log(res.status, JSON.stringify(await res.json(), null, 2).slice(0, 2000));
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-6-outlook-graph-delta/result.md <<'EOF'
  # Gate: A1-⑥ Outlook Graph delta

  - **질문**: `/me/mailFolders/inbox/messages/delta` 폴링이 문서대로 `@odata.nextLink`/`@odata.deltaLink`/410을 돌려주는가?
  - **소유 부록**: A1 §2.4
  - **Owner**: agent
  - **Host**: mini
  - **실행일**: PENDING — B-D5(실계정 연결은 나중에 한 번에, Logan 2026-09-20 결정) 이후
  - **결과(Pass/Fail)**: PENDING
  - **측정치/근거**: `probe.ts`를 실제 access token으로 실행해 채운다
  - **decided_by**: PENDING
  - **비고**: 이 플랜(US-B37)의 어댑터 구현은 fixture/mock으로 이미 인수됨 — 이 스파이크는 실연결 검증용이지 구현 게이트가 아니다
  EOF
  ```

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/outlook tools/spikes/a1-6-outlook-graph-delta
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook backfill() + subscribe() delta 폴링

  - backfill(): /me/mailFolders/inbox/messages를 @odata.nextLink로 페이지네이션
  - subscribe(): delta 폴링, 410 Gone은 BASE delta URL로 재시작(풀 재동기화, A1 §2.4)
  - 폴링 간격 기본 5분(outlook_delta_poll cron과 동일)
  - A1-⑥ 스파이크 스캐폴드(result.md는 PENDING — 실계정 연결은 B-D5로 뒤로 미뤄짐)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Outlook 어댑터 — `send()`/`markRead()`/`archive()` write-back + `0012_jobs_phase_b.sql` (US-B37, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/adapter-outlook test && pnpm --filter @omnis/db test:integration`.

**Files:** Modify: `packages/adapters/outlook/src/index.ts`. Test: `packages/adapters/outlook/test/send.test.ts`. Create: `packages/db/migrations/0012_jobs_phase_b.sql`. Modify: `packages/db/test/integration/schema-0006.test.ts`(잡 카운트 16→20, Task 6 동시 소유 — 델타 §8 4건 결정론적 내용).

**Interfaces:** Consumes: `GraphClientLike`, `mapApiError()`. Produces: 완성된 `Adapter`(`send`/`markRead`/`archive`), `jobs` 테이블에 `outlook_delta_poll` 행(+ 델타 §8의 나머지 3건, B14/B15/B44와 공유 소유).

읽을 스펙: A1 §2.4(send=`sendMail`, markRead=`isRead` PATCH, archive=`move`→Archive 폴더). 델타 §8(잡 4건 정확한 cron).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/outlook/test/send.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createOutlookAdapter } from "../src/index.js";
  import type { GraphClientLike } from "../src/index.js";

  describe("Outlook write-back", () => {
    it("send() only calls the injected mock sink, never a real API", async () => {
      const sink = vi.fn(async () => ({ externalId: "sent-1", sentAt: "2023-11-14T00:00:00.000Z" }));
      const adapter = createOutlookAdapter({ oauthClientId: "c", sink });
      const result = await adapter.send({ accountId: "a", externalId: "conv-1" }, { text: "hi" });
      expect(sink).toHaveBeenCalledOnce();
      expect(result.externalId).toBe("sent-1");
    });

    it("markRead() PATCHes isRead and archive() POSTs a move to the Archive folder", async () => {
      const patch = vi.fn(async () => ({}));
      const post = vi.fn(async () => ({}));
      const graphClient: GraphClientLike = { api: () => ({ get: async () => ({}), patch, post }) };
      const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient });
      await adapter.connect({
        channel: "outlook", accountExternalId: "logan@outlook.com",
        keychainService: "s", keychainAccount: "a",
      });
      await adapter.markRead?.({ accountId: "a", externalId: "msg-1" });
      expect(patch).toHaveBeenCalledWith({ isRead: true });
      await adapter.archive?.({ accountId: "a", externalId: "msg-1" });
      expect(post).toHaveBeenCalledWith({ destinationId: "archive" });
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/adapter-outlook test` — 예상 실패: `send()`가 여전히 `fatal_unsupported`를 던진다.

- [ ] 3. `src/index.ts`의 `send` 스텁을 갈아 끼우고 `markRead`/`archive`를 추가한다.

  ```ts
  // 승인 게이트(US-A07, Phase A에 이미 존재) 전까지 실제 sendMail은 절대 호출하지 않는다.
  async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
    const sink =
      deps.sink ??
      (async (): Promise<SendResult> => ({
        externalId: `mock-${now().getTime()}`,
        sentAt: now().toISOString(),
      }));
    return sink(thread, draft);
  },

  async markRead(thread: ThreadRef): Promise<void> {
    if (graphClient === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "markRead() called before connect()");
    try {
      await graphClient.api(`/me/messages/${thread.externalId}`).patch({ isRead: true });
    } catch (cause) {
      throw mapApiError(cause);
    }
  },

  async archive(thread: ThreadRef): Promise<void> {
    if (graphClient === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "archive() called before connect()");
    try {
      await graphClient.api(`/me/messages/${thread.externalId}/move`).post({ destinationId: "archive" });
    } catch (cause) {
      throw mapApiError(cause);
    }
  },
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/adapter-outlook test` — 예상 출력: 전체 통과(normalize 2 + mapApiError 3 + contract 5 + connect 3 + backfill 2 + send 2 = 17건 내외).

- [ ] 5. `0012_jobs_phase_b.sql`을 만든다 — 델타 §8 표의 4건을 **그대로**(B14/B15/B44 플랜과 바이트 단위로 동일해야 병렬 워크트리 머지가 충돌하지 않는다).

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0012_jobs_phase_b.sql <<'EOF'
  -- 0012_jobs_phase_b.sql
  -- Phase B interfaces delta §8: cron 잡 4건. B14(cost_daily)/B15(push_batch)/B37(outlook_delta_poll)/B44(cost_report_monthly)가
  -- 공유 소유한다 — 내용이 결정론적이라 병렬 워크트리에서 각자 이 파일을 만들어도 머지 시 충돌하지 않는다.
  INSERT INTO jobs (name, schedule, next_run_at) VALUES
    ('cost_daily',          '5 0 * * *',          now()),
    ('push_batch',          '0 9,12,15,18 * * *', now()),
    ('outlook_delta_poll',  '*/5 * * * *',        now()),
    ('cost_report_monthly', '10 0 1 * *',         now())
  ON CONFLICT (name) DO NOTHING;
  EOF
  ```

- [ ] 6. 기존 Phase A 잡 카운트 단언(`packages/db/test/integration/schema-0006.test.ts`)이 16→20으로 깨지는 것을 고친다 — 이 파일이 `0012`의 4개 신규 행까지 포함해 세도록 갱신한다(B14/B15/B44가 각자 워크트리에서 같은 자리를 같은 값으로 고치므로 머지 시 동일).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  ```

  ```ts
  // packages/db/test/integration/schema-0006.test.ts, "seeds the 16 jobs..." it() 블록을 이렇게 바꾼다:
  it("seeds the jobs A3 §6 + Phase B delta §8 lists, with the A4-owned schedules", async () => {
    const rows = await query<{ name: string; schedule: string }>(
      pool,
      "SELECT name, schedule FROM jobs ORDER BY name",
    );
    expect(rows.length).toBeGreaterThanOrEqual(16); // 0009~0011(다른 플랜)이 없는 워크트리에서도 통과
    const byName = new Map(rows.map((r) => [r.name, r.schedule]));
    expect(byName.get("morning_digest")).toBe("30 6 * * *");
    expect(byName.get("nightly_digest")).toBe("0 23 * * *");
    expect(byName.get("memory_consolidate")).toBe("30 23 * * *");
    expect(byName.get("slot_health")).toBe("*/5 * * * *");
    expect(byName.get("events_rolloff")).toBe("15 4 * * *");
    // Phase B delta §8 (0012, 이 플랜이 만든다)
    expect(byName.get("cost_daily")).toBe("5 0 * * *");
    expect(byName.get("push_batch")).toBe("0 9,12,15,18 * * *");
    expect(byName.get("outlook_delta_poll")).toBe("*/5 * * * *");
    expect(byName.get("cost_report_monthly")).toBe("10 0 1 * *");
  });
  ```

  `toHaveLength(16)`을 `toBeGreaterThanOrEqual(16)`으로 완화한 것은 의도적이다 — 이 워크트리엔 0009~0011(다른 플랜 소유)이 없어 정확히 20을 기대할 수 없다. 메인에 4개 플랜이 전부 머지되면 정확히 20이 된다.

- [ ] 7. 마이그레이션 + 통합 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm --filter @omnis/db test:integration
  ```

  예상 출력: `schema-0006.test.ts` 전체 통과(잡 8건 검증 포함).

- [ ] 8. lint 후 커밋한다(US-B37 마지막 커밋).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm lint
  git add packages/adapters/outlook packages/db/migrations/0012_jobs_phase_b.sql packages/db/test/integration/schema-0006.test.ts
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook send()/markRead()/archive() + 0012_jobs_phase_b.sql

  - send()는 여전히 주입된 mock sink만 호출(승인 게이트 밖 비가역 전송 금지)
  - markRead()=isRead PATCH, archive()=Archive 폴더로 move(A1 §2.4)
  - 0012_jobs_phase_b.sql: cost_daily/push_batch/outlook_delta_poll/cost_report_monthly
    (B14/B15/B44와 결정론적 내용 공유 — 병렬 워크트리 머지 무충돌)
  - schema-0006 잡 카운트 단언을 gte(16)으로 완화 + Phase B 4건 스케줄 검증 추가

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Telegram 어댑터 — 패키지 스캐폴드 + `normalize()`(text/edit/delete) (US-B38, tier: Sonnet)

**US-B38 산출물(델타 §11):** `packages/adapters/telegram/src/index.ts`, `packages/adapters/telegram/fixtures/*.json`. **검증 명령:** `pnpm --filter @omnis/adapter-telegram test && pnpm test:contract`. **목표:** mtcute 기반 Telegram 어댑터, fixture 계약 테스트로만 인수(B-D5).

**Files:**
- Create: `packages/adapters/telegram/package.json`, `packages/adapters/telegram/tsconfig.json`, `packages/adapters/telegram/vitest.config.ts`
- Create: `packages/adapters/telegram/src/keychain.ts`, `packages/adapters/telegram/src/index.ts`
- Test: `packages/adapters/telegram/test/normalize.test.ts`

**Interfaces:** Consumes: `@omnis/protocol`의 `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health`/`NormalizedItem`/`Attachment`(FIXED). Produces: `CHANNEL`(`"telegram"`), `normalize(raw: unknown): NormalizedItem[]`.

읽을 스펙: A1 §2.5(thread=chat/peer id, item=message id, `sourceHash=(chatId,messageId)`, archive 미지원). Keychain: `omnis.telegram.session_key`(일반형).

- [ ] 1. 패키지 스캐폴드를 만든다.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/src
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/test
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/package.json <<'EOF'
  {
    "name": "@omnis/adapter-telegram",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": { "build": "tsc --build", "test": "vitest run" },
    "dependencies": {
      "@omnis/protocol": "workspace:*",
      "@mtcute/node": "0.29.1"
    },
    "devDependencies": { "typescript": "5.6.3", "vitest": "2.1.9" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/tsconfig.json <<'EOF'
  {
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "references": [{ "path": "../../protocol" }],
    "include": ["src"]
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/vitest.config.ts <<'EOF'
  import { defineConfig } from "vitest/config";
  import { omnisAlias } from "../../../vitest.shared.js";

  export default defineConfig({
    resolve: { alias: omnisAlias },
    test: { environment: "node" },
  });
  EOF
  ```

- [ ] 2. Keychain 래퍼를 작성한다: `packages/adapters/telegram/src/keychain.ts` (동일 패턴 복제).

  ```ts
  import { execFile } from "node:child_process";
  import { promisify } from "node:util";
  import { AdapterError, type Channel } from "@omnis/protocol";

  const execFileAsync = promisify(execFile);

  export async function readKeychainSecret(
    service: string,
    account: string,
    channel: Channel,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
      ]);
      return stdout.trim();
    } catch (cause) {
      throw new AdapterError(
        "auth_expired",
        channel,
        `Keychain item ${service}/${account} not found or locked`,
        undefined,
        cause,
      );
    }
  }
  ```

- [ ] 3. 실패하는 테스트를 작성한다: `packages/adapters/telegram/test/normalize.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { normalize } from "../src/index.js";

  describe("Telegram normalize()", () => {
    it("maps a text message keyed by (chatId, messageId)", () => {
      const items = normalize({
        id: 501,
        chat: { id: 1001, type: "private" },
        sender: { id: 42, firstName: "Dana", lastName: "Lee" },
        text: "sync tomorrow at 10am",
        date: 1_700_000_000,
      });
      expect(items).toEqual([
        {
          threadExternalId: "1001",
          externalId: "501",
          kind: "message",
          author: { kind: "person", id: "42" },
          body: "sync tomorrow at 10am",
          attachments: [],
          sentAt: new Date(1_700_000_000 * 1000).toISOString(),
          status: "received",
          sourceHash: "1001:501",
          threadMeta: {
            externalId: "1001",
            kind: "dm",
            title: null,
            participants: [{ externalId: "42", displayName: "Dana Lee" }],
            lastItemAt: new Date(1_700_000_000 * 1000).toISOString(),
            archivedAt: null,
          },
        },
      ]);
    });

    it("keeps edited messages as a normal item and drops delete updates", () => {
      const edited = normalize({
        id: 501,
        chat: { id: 1001, type: "private" },
        sender: { id: 42, firstName: "Dana" },
        text: "sync tomorrow at 11am (edited)",
        date: 1_700_000_000,
        editDate: 1_700_000_500,
      });
      expect(edited[0]?.body).toBe("sync tomorrow at 11am (edited)");
      expect(normalize({ deletedMessageIds: [501], deletedChatId: 1001 })).toEqual([]);
      expect(normalize({ id: 1 })).toEqual([]); // chat/sender 없음
    });
  });
  ```

- [ ] 4. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-telegram test
  ```

  예상 실패: `Cannot find module '../src/index.js'`.

- [ ] 5. `src/index.ts`에 `CHANNEL`과 `normalize()`를 작성한다.

  ```ts
  import type { Attachment, NormalizedItem } from "@omnis/protocol";

  export const CHANNEL = "telegram" as const;

  interface TgSender {
    id?: number;
    username?: string;
    firstName?: string;
    lastName?: string;
  }
  interface TgMedia {
    type?: string;
    mimeType?: string;
    fileSize?: number;
    fileName?: string;
  }
  interface TgMessage {
    id?: number;
    chat?: { id?: number | string; type?: string; title?: string };
    sender?: TgSender;
    text?: string;
    date?: number;
    editDate?: number;
    media?: TgMedia;
    // 삭제 업데이트는 메시지가 아니라 별개 shape(mtcute DeleteMessageUpdate 계열)라 이 키로 판별한다.
    deletedMessageIds?: number[];
  }

  function tgAttachmentKind(type: string | undefined): Attachment["kind"] {
    if (type === "photo") return "image";
    if (type === "video") return "video";
    if (type === "voice" || type === "audio") return "audio";
    return "file";
  }

  export function normalize(raw: unknown): NormalizedItem[] {
    const m = raw as TgMessage;
    if (m.deletedMessageIds !== undefined) return []; // 삭제 업데이트는 콘텐츠가 없다 — 아이템을 만들지 않는다
    if (m.id === undefined || m.chat?.id === undefined || m.sender?.id === undefined) return [];

    const chatId = String(m.chat.id);
    const senderId = String(m.sender.id);
    const displayName =
      [m.sender.firstName, m.sender.lastName].filter(Boolean).join(" ") || m.sender.username || senderId;
    const sentAt = new Date((m.date ?? 0) * 1000).toISOString();
    const attachments: Attachment[] = m.media
      ? [
          {
            kind: tgAttachmentKind(m.media.type),
            ...(m.media.mimeType !== undefined ? { mimeType: m.media.mimeType } : {}),
            ...(m.media.fileSize !== undefined ? { sizeBytes: m.media.fileSize } : {}),
            ...(m.media.fileName !== undefined ? { caption: m.media.fileName } : {}),
          },
        ]
      : [];

    return [
      {
        threadExternalId: chatId,
        externalId: String(m.id),
        kind: "message",
        author: { kind: "person", id: senderId },
        body: m.text ?? "",
        attachments,
        sentAt,
        status: "received",
        sourceHash: `${chatId}:${m.id}`, // A1 §2.5: sourceHash = (chatId, messageId)
        threadMeta: {
          externalId: chatId,
          kind: m.chat.type === "private" ? "dm" : "group",
          title: m.chat.type === "private" ? null : (m.chat.title ?? null),
          participants: [{ externalId: senderId, displayName }],
          lastItemAt: sentAt,
          archivedAt: null,
        },
      },
    ];
  }
  ```

- [ ] 6. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/adapter-telegram test` — 예상 출력: `Tests  2 passed (2)`.

- [ ] 7. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/telegram
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram 어댑터 스캐폴드 + normalize()

  - thread=chat id, item=message id, sourceHash=(chatId,messageId)(A1 §2.5)
  - 삭제 업데이트(deletedMessageIds)는 빈 배열, 수정 메시지는 보통 아이템으로 통과
  - Keychain omnis.telegram.session_key 래퍼

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Telegram 어댑터 — `mapApiError()` + fixture 7종 + 계약 테스트 (US-B38, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/adapter-telegram test && pnpm test:contract`.

**Files:**
- Modify: `packages/adapters/telegram/src/index.ts`
- Create: `packages/adapters/telegram/fixtures/{text_message,thread_reply,attachment,rate_limited_response,auth_error_response,edited_message,deleted_message}.json`
- Create: `packages/adapters/telegram/test/contract.test.ts`

**Interfaces:** Consumes: Task 6의 `normalize()`. Produces: `mapApiError(cause: unknown): AdapterError`.

읽을 스펙: A1 §2.5(flood-wait은 서버가 준 시간만큼 대기 후 재시도, 세션 무효화 → `auth_required`). 최소 시나리오 7종 = Phase A 5종 + Telegram 전용 `edited_message`/`deleted_message`(interfaces.md §9, 델타 §12).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/telegram/test/mapApiError.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { mapApiError } from "../src/index.js";

  describe("Telegram mapApiError()", () => {
    it("parses FLOOD_WAIT_<seconds> into retryable_rate_limit", () => {
      const err = mapApiError({ code: 420, message: "FLOOD_WAIT_45" });
      expect(err.kind).toBe("retryable_rate_limit");
      expect(err.retryAfterMs).toBe(45_000);
    });
    it("maps AUTH_KEY_UNREGISTERED to auth_revoked", () => {
      expect(mapApiError({ code: 401, message: "AUTH_KEY_UNREGISTERED" }).kind).toBe("auth_revoked");
    });
    it("falls back to retryable_network otherwise", () => {
      expect(mapApiError({ code: 500, message: "INTERNAL" }).kind).toBe("retryable_network");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/adapter-telegram test` — 예상 실패: `mapApiError is not a function`.

- [ ] 3. `src/index.ts`에 `mapApiError()`를 추가한다(`AdapterError`를 import에 더한다).

  ```ts
  import { AdapterError } from "@omnis/protocol";

  export function mapApiError(cause: unknown): AdapterError {
    const err = cause as { code?: number; message?: string };
    const floodMatch = /FLOOD_WAIT_(\d+)/.exec(err.message ?? "");
    if (err.code === 420 || floodMatch !== null) {
      const secs = Number(floodMatch?.[1] ?? "60");
      return new AdapterError(
        "retryable_rate_limit",
        CHANNEL,
        `Telegram flood-wait: ${err.message ?? "FLOOD_WAIT"}`,
        secs * 1000,
        cause,
      );
    }
    if (err.code === 401 || err.message === "AUTH_KEY_UNREGISTERED") {
      return new AdapterError("auth_revoked", CHANNEL, "Telegram session invalidated", undefined, cause);
    }
    return new AdapterError("retryable_network", CHANNEL, "Telegram MTProto call failed", undefined, cause);
  }
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/adapter-telegram test`.

- [ ] 5. fixture 7종을 만든다.

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/text_message.json <<'EOF'
  {
    "scenario": "text_message",
    "raw": { "id": 501, "chat": { "id": 1001, "type": "private" }, "sender": { "id": 42, "firstName": "Dana", "lastName": "Lee" }, "text": "sync tomorrow at 10am", "date": 1700000000 },
    "expected": {
      "items": [
        {
          "threadExternalId": "1001", "externalId": "501", "kind": "message",
          "author": { "kind": "person", "id": "42" }, "body": "sync tomorrow at 10am",
          "attachments": [], "sentAt": "2023-11-14T22:13:20.000Z", "status": "received",
          "sourceHash": "1001:501",
          "threadMeta": { "externalId": "1001", "kind": "dm", "title": null,
            "participants": [{ "externalId": "42", "displayName": "Dana Lee" }],
            "lastItemAt": "2023-11-14T22:13:20.000Z", "archivedAt": null }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/thread_reply.json <<'EOF'
  {
    "scenario": "thread_reply",
    "raw": { "id": 502, "chat": { "id": 2002, "type": "group", "title": "omnis launch" }, "sender": { "id": 43, "firstName": "Logan" }, "text": "10am works", "date": 1700003600 },
    "expected": {
      "items": [
        {
          "threadExternalId": "2002", "externalId": "502", "kind": "message",
          "author": { "kind": "person", "id": "43" }, "body": "10am works",
          "attachments": [], "sentAt": "2023-11-14T23:13:20.000Z", "status": "received",
          "sourceHash": "2002:502",
          "threadMeta": { "externalId": "2002", "kind": "group", "title": "omnis launch",
            "participants": [{ "externalId": "43", "displayName": "Logan" }],
            "lastItemAt": "2023-11-14T23:13:20.000Z", "archivedAt": null }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/attachment.json <<'EOF'
  {
    "scenario": "attachment",
    "raw": { "id": 503, "chat": { "id": 1001, "type": "private" }, "sender": { "id": 42, "firstName": "Dana" }, "text": "see attached", "date": 1700007200, "media": { "type": "photo", "mimeType": "image/jpeg", "fileSize": 2048, "fileName": "poc.jpg" } },
    "expected": {
      "items": [
        {
          "threadExternalId": "1001", "externalId": "503", "kind": "message",
          "author": { "kind": "person", "id": "42" }, "body": "see attached",
          "attachments": [{ "kind": "image", "mimeType": "image/jpeg", "sizeBytes": 2048, "caption": "poc.jpg" }],
          "sentAt": "2023-11-15T00:13:20.000Z", "status": "received", "sourceHash": "1001:503",
          "threadMeta": { "externalId": "1001", "kind": "dm", "title": null,
            "participants": [{ "externalId": "42", "displayName": "Dana" }],
            "lastItemAt": "2023-11-15T00:13:20.000Z", "archivedAt": null }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/rate_limited_response.json <<'EOF'
  { "scenario": "rate_limited_response", "raw": { "code": 420, "message": "FLOOD_WAIT_45" }, "expected": { "errorKind": "retryable_rate_limit" } }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/auth_error_response.json <<'EOF'
  { "scenario": "auth_error_response", "raw": { "code": 401, "message": "AUTH_KEY_UNREGISTERED" }, "expected": { "errorKind": "auth_revoked" } }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/edited_message.json <<'EOF'
  {
    "scenario": "edited_message",
    "raw": { "id": 501, "chat": { "id": 1001, "type": "private" }, "sender": { "id": 42, "firstName": "Dana", "lastName": "Lee" }, "text": "sync tomorrow at 11am (edited)", "date": 1700000000, "editDate": 1700000500 },
    "expected": {
      "items": [
        {
          "threadExternalId": "1001", "externalId": "501", "kind": "message",
          "author": { "kind": "person", "id": "42" }, "body": "sync tomorrow at 11am (edited)",
          "attachments": [], "sentAt": "2023-11-14T22:13:20.000Z", "status": "received",
          "sourceHash": "1001:501",
          "threadMeta": { "externalId": "1001", "kind": "dm", "title": null,
            "participants": [{ "externalId": "42", "displayName": "Dana Lee" }],
            "lastItemAt": "2023-11-14T22:13:20.000Z", "archivedAt": null }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/deleted_message.json <<'EOF'
  { "scenario": "deleted_message", "raw": { "deletedMessageIds": [501], "deletedChatId": 1001 }, "expected": { "items": [] } }
  EOF
  ```

- [ ] 6. 계약 테스트를 작성한다: `packages/adapters/telegram/test/contract.test.ts` (Gmail Task 동일 패턴).

  ```ts
  import { readFileSync, readdirSync } from "node:fs";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  import { describe, expect, it } from "vitest";
  import { mapApiError, normalize } from "../src/index.js";

  interface Fixture {
    scenario: string;
    raw: unknown;
    expected: { items?: unknown[]; errorKind?: string };
  }

  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  describe("Telegram contract: fixture replay", () => {
    for (const file of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
      it(`${fixture.scenario} (${file})`, () => {
        if (fixture.expected.errorKind) {
          const err = mapApiError(fixture.raw);
          expect(err.kind).toBe(fixture.expected.errorKind);
        } else {
          expect(normalize(fixture.raw)).toEqual(fixture.expected.items);
        }
      });
    }
  });
  ```

- [ ] 7. 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm --filter @omnis/adapter-telegram test
  pnpm test:contract
  ```

- [ ] 8. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/telegram
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram mapApiError() + fixture 7종 계약 테스트

  - FLOOD_WAIT_<seconds>를 retryable_rate_limit으로, AUTH_KEY_UNREGISTERED를 auth_revoked로
  - fixture 7종(Phase A 5종 + edited_message/deleted_message, interfaces.md §9)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Telegram 어댑터 — `TelegramClientLike` + `connect()`/`health()` + A1-⑦ 스파이크 (US-B38, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/adapter-telegram test`.

**Files:** Modify: `packages/adapters/telegram/src/index.ts`. Test: `packages/adapters/telegram/test/connect.test.ts`. Create: `tools/spikes/a1-7-telegram-mtcute-pairing/{probe.ts,result.md}`.

**Interfaces:** Consumes: `readKeychainSecret`(Task 6). Produces: `TelegramClientLike`(이 패키지 소유의 얇은 인터페이스 — 실제 mtcute `TelegramClient`가 이 부분집합을 만족하는지는 A1-⑦ 스파이크로 검증한다, UNVERIFIED against mtcute 0.29.x, A2 §4.4류 "UNVERIFIED — spike" 관례), `TelegramAdapterDeps`, `createTelegramAdapter(deps?): Adapter`.

읽을 스펙: A1 §2.5(QR/phone+code 페어링, 세션 파일 자체가 아니라 감싸는 암호화 키만 Keychain에 보관). **B-D5로 실제 mtcute 배선은 미룬다** — `connect()`는 `deps.client`가 주입되지 않으면 `fatal_protocol`을 던진다(테스트는 전부 주입된 `TelegramClientLike` mock으로 돈다).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/telegram/test/connect.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createTelegramAdapter } from "../src/index.js";
  import type { TelegramClientLike } from "../src/index.js";

  vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

  function fakeAuth() {
    return {
      channel: "telegram" as const,
      accountExternalId: "logan-tg",
      keychainService: "omnis.telegram.session_key",
      keychainAccount: "logan-tg",
    };
  }

  describe("Telegram adapter connect()/health()", () => {
    it("throws fatal_protocol when no client is injected (B-D5: real mtcute wiring deferred)", async () => {
      const adapter = createTelegramAdapter({});
      await expect(adapter.connect(fakeAuth())).rejects.toMatchObject({ kind: "fatal_protocol" });
    });

    it("reports healthy once the injected client starts", async () => {
      const client: TelegramClientLike = {
        start: vi.fn(async () => {}),
        getHistory: vi.fn(async () => []),
        onUpdate: vi.fn(() => () => {}),
        sendText: vi.fn(async () => ({ id: 1, date: 0 })),
        readHistory: vi.fn(async () => {}),
      };
      const adapter = createTelegramAdapter({ client });
      await adapter.connect(fakeAuth());
      expect((await adapter.health()).status).toBe("healthy");
      expect(client.start).toHaveBeenCalledOnce();
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/adapter-telegram test` — 예상 실패: `createTelegramAdapter is not a function`.

- [ ] 3. `src/index.ts`에 `TelegramClientLike`, `TelegramAdapterDeps`, `createTelegramAdapter()`(connect/disconnect/health, backfill/subscribe/send는 스텁), 그리고 Slack과 동일한 `AsyncQueue<T>`(패키지 간 import 금지라 복제, A7 §9 "의도된 중복")를 추가한다.

  ```ts
  import {
    type Adapter,
    AdapterError,
    type AdapterEvent,
    type AuthRef,
    type Capabilities,
    type Health,
    type Outbound,
    type SendResult,
    type ThreadRef,
  } from "@omnis/protocol";
  import { readKeychainSecret } from "./keychain.js";
  // (NormalizedItem/Attachment는 이미 import되어 있다 — Task 6)

  const CAPABILITIES: Capabilities = {
    read: true,
    write: true,
    realtime: true,
    history: true,
    media: true,
    markRead: true,
    typing: false,
    archive: false, // v1은 커널 내부 라벨만(A1 §2.5)
    delete: false,
  };

  class AsyncQueue<T> {
    private buffered: T[] = [];
    private waiters: Array<(v: IteratorResult<T>) => void> = [];
    push(value: T): void {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
        return;
      }
      this.buffered.push(value);
    }
    private async next(): Promise<IteratorResult<T>> {
      const value = this.buffered.shift();
      if (value !== undefined) return { value, done: false };
      return new Promise((resolve) => this.waiters.push(resolve));
    }
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return { next: () => this.next() };
    }
  }

  /** mtcute `TelegramClient`가 실제로 이 부분집합을 만족하는지는 UNVERIFIED — A1-⑦ 스파이크가 실계정
   *  연결 시점에 확인한다(B-D5). 이 인터페이스는 어댑터가 실제로 부르는 메서드만 좁게 정의해
   *  fixture/mock 테스트가 mtcute 없이도 전부 돌게 한다. */
  export interface TelegramClientLike {
    start(): Promise<void>;
    getHistory(chatId: string, opts: { limit: number; offsetUnixSec?: number }): Promise<unknown[]>;
    onUpdate(cb: (raw: unknown) => void): () => void; // 반환값은 unsubscribe
    sendText(chatId: string, text: string): Promise<{ id: number; date: number }>;
    readHistory(chatId: string): Promise<void>;
  }

  export interface TelegramAdapterDeps {
    client?: TelegramClientLike;
    sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
    now?: () => Date;
  }

  export function createTelegramAdapter(deps: TelegramAdapterDeps = {}): Adapter {
    const now = deps.now ?? ((): Date => new Date());
    let client: TelegramClientLike | undefined = deps.client;
    const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
    let status: Health["status"] = "down";
    let lastEventAt: string | null = null;
    let lastError: Health["lastError"];
    let unsubscribe: (() => void) | undefined;

    return {
      id: "telegram",
      channel: CHANNEL,
      capabilities: () => CAPABILITIES,

      async connect(auth: AuthRef): Promise<void> {
        // 세션 파일 자체가 아니라 그걸 감싸는 암호화 키만 Keychain에 있다(A1 §2.5) — 로그로 찍지 않는다.
        await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
        if (client === undefined) {
          status = "down";
          throw new AdapterError(
            "fatal_protocol",
            CHANNEL,
            "mtcute client not wired — real Telegram connect deferred to A1-⑦ (B-D5)",
          );
        }
        try {
          await client.start();
        } catch (cause) {
          status = "down";
          throw mapApiError(cause);
        }
        status = "healthy";
        lastEventAt = now().toISOString();
        queue.push({ kind: "connected", at: lastEventAt });
      },

      async disconnect(): Promise<void> {
        unsubscribe?.();
        status = "down";
      },

      async *backfill(): AsyncIterable<NormalizedItem> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 9");
      },

      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "subscribe not implemented until Task 9");
      },

      async send(): Promise<never> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 10");
      },

      async health(): Promise<Health> {
        return {
          channel: CHANNEL,
          accountExternalId: "",
          status,
          lastEventAt,
          ...(lastError ? { lastError } : {}),
        };
      },
    };
  }
  ```

  Task 9·10이 `backfill`/`subscribe`/`send`/`markRead` 본문과 `unsubscribe` 대입만 갈아 끼운다 — 나머지 클로저 변수는 이 스텝이 확정한다.

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/adapter-telegram test`.

- [ ] 5. A1-⑦ 스파이크 스캐폴드를 만든다(백로그 §5 소유분, result.md는 B-D5로 PENDING).

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-7-telegram-mtcute-pairing
  cat > /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-7-telegram-mtcute-pairing/probe.ts <<'EOF'
  // A1-⑦: mtcute QR 페어링이 문서대로 동작하는지, TelegramClientLike가 실제 TelegramClient로
  // 구조적으로 만족되는지 확인한다. 실행: OMNIS_TELEGRAM_API_ID/HASH를 export하고
  // tsx tools/spikes/a1-7-telegram-mtcute-pairing/probe.ts
  const apiId = process.env.OMNIS_TELEGRAM_API_ID;
  const apiHash = process.env.OMNIS_TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    console.error("OMNIS_TELEGRAM_API_ID/HASH not set — B-D5: 실계정 연결 전에는 이 스파이크를 돌리지 않는다.");
    process.exit(1);
  }
  const { TelegramClient } = await import("@mtcute/node");
  const client = new TelegramClient({ apiId: Number(apiId), apiHash, storage: "spike-session" });
  await client.start({ qrCallback: (url: string) => console.log("scan:", url) });
  console.log("paired as", await client.getMe());
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-7-telegram-mtcute-pairing/result.md <<'EOF'
  # Gate: A1-⑦ Telegram mtcute pairing

  - **질문**: mtcute QR 로그인 페어링이 문서대로 동작하고, 실제 `TelegramClient`가 이 어댑터의
    `TelegramClientLike`(start/getHistory/onUpdate/sendText/readHistory)를 구조적으로 만족하는가?
  - **소유 부록**: A1 §2.5
  - **Owner**: agent
  - **Host**: mini
  - **실행일**: PENDING — B-D5(실계정 연결은 나중에 한 번에, Logan 2026-09-20 결정) 이후
  - **결과(Pass/Fail)**: PENDING
  - **측정치/근거**: `probe.ts`를 실제 `api_id`/`api_hash`로 실행해 채운다. 메서드 이름이 다르면
    `TelegramClientLike`를 실제 API에 맞춰 조정하고 이 result.md에 diff를 남긴다
  - **decided_by**: PENDING
  - **비고**: 이 플랜(US-B38)의 어댑터 구현은 fixture/mock으로 이미 인수됨 — 이 스파이크는 실연결
    검증용이지 구현 게이트가 아니다
  EOF
  ```

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/telegram tools/spikes/a1-7-telegram-mtcute-pairing
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram TelegramClientLike + connect()/health() + A1-⑦ 스파이크

  - connect()는 client 미주입 시 fatal_protocol(B-D5: 실제 mtcute 배선은 실계정 연결 이후)
  - TelegramClientLike는 어댑터가 실제로 부르는 메서드만 좁게 정의(UNVERIFIED against mtcute 0.29.x)
  - Slack과 동일한 AsyncQueue 복제(어댑터 패키지 간 import 금지)
  - A1-⑦ 스파이크 스캐폴드(result.md PENDING)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Telegram 어댑터 — `backfill()`(30일/500건 상한) + `subscribe()` 업데이트 스트림 (US-B38, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/adapter-telegram test`.

**Files:** Modify: `packages/adapters/telegram/src/index.ts`. Test: `packages/adapters/telegram/test/backfill.test.ts`.

**Interfaces:** Consumes: `TelegramClientLike`, `mapApiError()`(Task 7·8). Produces: `backfill(since?)`/`subscribe()` 구현, `BACKFILL_MAX_DAYS`/`BACKFILL_MAX_ITEMS`(채널별 backfill 상한, 백로그 US-B40 "backfill 상한(채널별 30일·500건)"을 이 어댑터가 직접 강제한다).

읽을 스펙: A1 §2.5(`getHistory`로 최근 30일 또는 최근 500개, MTProto persistent connection 실시간 스트림).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/telegram/test/backfill.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createTelegramAdapter, BACKFILL_MAX_ITEMS } from "../src/index.js";
  import type { TelegramClientLike } from "../src/index.js";

  vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

  function fakeAuth() {
    return {
      channel: "telegram" as const, accountExternalId: "logan-tg",
      keychainService: "s", keychainAccount: "a",
    };
  }

  describe("Telegram backfill()", () => {
    it("caps at BACKFILL_MAX_ITEMS even if the client returns more", async () => {
      const raws = Array.from({ length: BACKFILL_MAX_ITEMS + 10 }, (_, i) => ({
        id: i, chat: { id: 1, type: "private" }, sender: { id: 9, firstName: "A" }, text: "x", date: 1,
      }));
      const client: TelegramClientLike = {
        start: vi.fn(async () => {}), getHistory: vi.fn(async () => raws),
        onUpdate: vi.fn(() => () => {}), sendText: vi.fn(async () => ({ id: 1, date: 0 })),
        readHistory: vi.fn(async () => {}),
      };
      const adapter = createTelegramAdapter({ client });
      await adapter.connect(fakeAuth());
      const items = [];
      for await (const item of adapter.backfill()) items.push(item);
      expect(items).toHaveLength(BACKFILL_MAX_ITEMS);
    });
  });

  describe("Telegram subscribe()", () => {
    it("normalizes updates pushed via onUpdate()", async () => {
      let handler: ((raw: unknown) => void) | undefined;
      const client: TelegramClientLike = {
        start: vi.fn(async () => {}), getHistory: vi.fn(async () => []),
        onUpdate: vi.fn((cb) => { handler = cb; return () => {}; }),
        sendText: vi.fn(async () => ({ id: 1, date: 0 })), readHistory: vi.fn(async () => {}),
      };
      const adapter = createTelegramAdapter({ client });
      await adapter.connect(fakeAuth());
      const it1 = adapter.subscribe()[Symbol.asyncIterator]();
      handler?.({ id: 9, chat: { id: 1, type: "private" }, sender: { id: 9, firstName: "A" }, text: "hi", date: 1 });
      const first = await it1.next();
      expect((first.value as { externalId?: string }).externalId).toBe("9");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/adapter-telegram test` — 예상 실패: `backfill()`/`subscribe()`가 여전히 `fatal_unsupported`를 던진다.

- [ ] 3. `src/index.ts`에 상수 2개와 `backfill`/`subscribe` 구현을 추가한다.

  ```ts
  // A1 §2.5 + 백로그 US-B40 "backfill 상한(채널별 30일·500건)" — 이 어댑터가 직접 강제한다.
  export const BACKFILL_MAX_DAYS = 30;
  export const BACKFILL_MAX_ITEMS = 500;
  ```

  ```ts
  async *backfill(since?: Date): AsyncIterable<NormalizedItem> {
    if (client === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
    const cutoff = since ?? new Date(now().getTime() - BACKFILL_MAX_DAYS * 86_400_000);
    let raws: unknown[];
    try {
      raws = await client.getHistory("me", {
        limit: BACKFILL_MAX_ITEMS,
        offsetUnixSec: Math.floor(cutoff.getTime() / 1000),
      });
    } catch (cause) {
      throw mapApiError(cause);
    }
    let done = 0;
    for (const raw of raws) {
      if (done >= BACKFILL_MAX_ITEMS) break;
      for (const item of normalize(raw)) {
        yield item;
        done += 1;
      }
    }
    queue.push({ kind: "backfill_progress", done, total: raws.length, at: now().toISOString() });
  },

  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
    if (client === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "subscribe() called before connect()");
    unsubscribe = client.onUpdate((raw) => {
      for (const item of normalize(raw)) queue.push(item);
    });
    return queue;
  },
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/adapter-telegram test`.

- [ ] 5. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/telegram
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram backfill()(30일/500건 상한) + subscribe() 업데이트 스트림

  - BACKFILL_MAX_DAYS=30, BACKFILL_MAX_ITEMS=500(A1 §2.5 + US-B40 채널별 상한을 어댑터가 직접 강제)
  - subscribe()는 client.onUpdate()가 미는 raw 업데이트를 normalize()해 큐에 쌓는다

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Telegram 어댑터 — `send()`/`markRead()` write-back (US-B38, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/adapter-telegram test`.

**Files:** Modify: `packages/adapters/telegram/src/index.ts`. Test: `packages/adapters/telegram/test/send.test.ts`.

**Interfaces:** Consumes: `TelegramClientLike`, `mapApiError()`. Produces: 완성된 `Adapter`(`send`/`markRead`).

읽을 스펙: A1 §2.5(send/markRead 전부 지원, archive는 `capabilities().archive=false`).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/telegram/test/send.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createTelegramAdapter } from "../src/index.js";
  import type { TelegramClientLike } from "../src/index.js";

  vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

  describe("Telegram write-back", () => {
    it("send() only calls the injected mock sink by default, never a real client call", async () => {
      const sink = vi.fn(async () => ({ externalId: "sent-1", sentAt: "2023-11-14T00:00:00.000Z" }));
      const adapter = createTelegramAdapter({ sink });
      const result = await adapter.send({ accountId: "a", externalId: "1001" }, { text: "hi" });
      expect(sink).toHaveBeenCalledOnce();
      expect(result.externalId).toBe("sent-1");
    });

    it("markRead() calls client.readHistory()", async () => {
      const readHistory = vi.fn(async () => {});
      const client: TelegramClientLike = {
        start: vi.fn(async () => {}), getHistory: vi.fn(async () => []),
        onUpdate: vi.fn(() => () => {}), sendText: vi.fn(async () => ({ id: 1, date: 0 })), readHistory,
      };
      const adapter = createTelegramAdapter({ client });
      await adapter.connect({
        channel: "telegram" as const, accountExternalId: "a", keychainService: "s", keychainAccount: "a",
      });
      await adapter.markRead?.({ accountId: "a", externalId: "1001" });
      expect(readHistory).toHaveBeenCalledWith("1001");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/adapter-telegram test` — 예상 실패: `send()`가 여전히 `fatal_unsupported`를 던진다.

- [ ] 3. `src/index.ts`의 `send` 스텁을 갈아 끼우고 `markRead`를 추가한다.

  ```ts
  // 승인 게이트(US-A07) 전까지 실제 client.sendText는 deps.sink가 없을 때만 호출한다(테스트 기본값은
  // mock sink). client가 주입돼 있고 deps.sink가 없으면 실제 전송처럼 보이는 경로를 열게 되므로,
  // 기본값은 항상 mock — 실제 전송이 필요해지면 승인 실행 경로(runEgress)가 deps.sink로 client.sendText를
  // 명시적으로 주입한다.
  async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
    const sink =
      deps.sink ??
      (async (): Promise<SendResult> => ({
        externalId: `mock-${now().getTime()}`,
        sentAt: now().toISOString(),
      }));
    return sink(thread, draft);
  },

  async markRead(thread: ThreadRef): Promise<void> {
    if (client === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "markRead() called before connect()");
    try {
      await client.readHistory(thread.externalId);
    } catch (cause) {
      throw mapApiError(cause);
    }
  },
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/adapter-telegram test` — 예상 출력: 전체 통과.

- [ ] 5. lint 후 커밋한다(US-B38 마지막 커밋).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm lint
  git add packages/adapters/telegram
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram send()/markRead() write-back

  - send()는 주입된 mock sink만 호출(승인 게이트 밖 비가역 전송 금지)
  - markRead()는 client.readHistory() 위임(A1 §2.5)
  - archive는 capabilities().archive=false로 이미 차단됨(Task 8)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11: Hermes 브리지 — `probe()` + capabilities 자기기술 + session_key_header 검증 (US-B39, tier: Opus)

**US-B39 산출물(백로그):** `apps/local-agent/src/bridges/hermes.ts`. **검증 명령:** `pnpm --filter @omnis/local-agent test`. **목표:** HTTP형 `RuntimeAdapter`(Claude Code/Codex와 같은 계약), `/v1/capabilities` 자기기술로 `session_key_header`를 검증한다.

**Files:** Create: `apps/local-agent/src/bridges/hermes.ts`. Test: `apps/local-agent/test/hermes.test.ts`.

**Interfaces:** Consumes: `apps/local-agent/src/rpc-dispatch.ts`의 `RuntimeAdapter`/`EventSink`/`TurnHandle`(FIXED, claude-code.ts와 동일 계약), `apps/local-agent/src/session-registry.ts`의 `SessionRecord`, `@omnis/protocol`의 `RuntimeCapabilities`/`TurnInput`/`BridgeError`/`BRIDGE_ERRORS`(Phase A FIXED). Produces: `HermesConfig`, `HermesCapabilitiesResponse`, `parseHermesCapabilities()`, `HermesSessionHeaderMismatchError`, `HermesAdapter`(부분 — `probe()`만).

읽을 스펙: A2 §2.1(Hermes `[[runtime]]` 필드는 `local-agent/src/config.ts`의 `HttpRuntimeConfig`가 이미 Phase A에서 파싱해 둔다 — 이 태스크는 그 설정을 읽는 쪽이 아니라 그 설정으로 실제 HTTP 클라이언트를 만드는 쪽이다) · §4.4(`GET /v1/capabilities` → `session_key_header`, 불일치 시 `degraded` 등록·세션 미개방, A2-D9 Phase B 읽기 전용).

- [ ] 1. 실패하는 테스트를 작성한다: `apps/local-agent/test/hermes.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { HermesAdapter, HermesSessionHeaderMismatchError, parseHermesCapabilities } from "../src/bridges/hermes.js";

  describe("parseHermesCapabilities()", () => {
    it("maps the Hermes self-description to RuntimeCapabilities (Phase B: 승인 표면 none)", () => {
      const caps = parseHermesCapabilities({ session_key_header: "X-Hermes-Session-Key", models: ["gpt-hermes-1"] });
      expect(caps.approvals).toBe("none"); // A2-D9: Phase B는 읽기 전용, 승인 요청이 발생할 여지가 없다
      expect(caps.models).toEqual(["gpt-hermes-1"]);
      expect(caps.stream_deltas).toBe(true);
    });
  });

  describe("HermesAdapter.probe()", () => {
    it("fetches GET /v1/capabilities with the bearer token and returns parsed capabilities", async () => {
      const fetchFn = vi.fn(async (url: string) => {
        expect(url).toBe("http://127.0.0.1:8642/v1/capabilities");
        return new Response(JSON.stringify({ session_key_header: "X-Hermes-Session-Key", models: [] }), { status: 200 });
      });
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      const result = await adapter.probe();
      expect(result.capabilities.approvals).toBe("none");
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    });

    it("throws HermesSessionHeaderMismatchError when session_key_header is unexpected (A2 §2.1: degraded)", async () => {
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({ session_key_header: "X-Something-Else" }), { status: 200 }));
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      await expect(adapter.probe()).rejects.toBeInstanceOf(HermesSessionHeaderMismatchError);
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/local-agent test
  ```

  예상 실패: `Cannot find module '../src/bridges/hermes.js'`.

- [ ] 3. `apps/local-agent/src/bridges/hermes.ts`를 작성한다(`probe()`까지, `startTurn`/`cancel`/`close`는 Task 12~13이 채운다).

  ```ts
  import { BRIDGE_ERRORS, BridgeError, type RuntimeCapabilities, type RuntimeKind } from "@omnis/protocol";
  import type { EventSink, RuntimeAdapter, TurnHandle } from "../rpc-dispatch.js";
  import type { SessionRecord } from "../session-registry.js";

  export interface HermesConfig {
    baseUrl: string;
    token: string;
    fetchFn?: typeof fetch;
    now?: () => Date;
  }

  export interface HermesCapabilitiesResponse {
    session_key_header: string;
    session_id_header?: string;
    models?: string[];
  }

  /** A2 §4.4: 승인은 Phase B에서 발생할 여지가 없다(origin='human'만, 위임 대상 제외, A2-D9).
   *  `resume`/`stream_deltas`는 `09` VERIFIED(session_key/session_id 분리, SSE keepalive). 나머지는
   *  Hermes가 원문으로 자기기술하지 않는 필드라 Phase B 스코프에 맞춰 보수적으로 고정한다. */
  export function parseHermesCapabilities(raw: HermesCapabilitiesResponse): RuntimeCapabilities {
    return {
      resume: true,
      cross_project_resume: false,
      stream_deltas: true,
      reasoning_stream: false,
      tool_calls: false,
      approvals: "none",
      cancel: true,
      models: raw.models ?? [],
      features: [],
    };
  }

  /** A2 §2.1: session_key_header가 session_header_mode('hermes_v1' = X-Hermes-Session-Key)와
   *  다르면 이 런타임을 degraded로 등록하고 세션을 열지 않는다 — probe()를 부르는 쪽(브리지 기동 코드,
   *  이 플랜 밖)이 이 에러를 잡아 AgentRuntime.state='degraded'로 내린다. */
  export class HermesSessionHeaderMismatchError extends Error {
    constructor(readonly got: string) {
      super(
        `Hermes GET /v1/capabilities returned session_key_header='${got}', expected 'X-Hermes-Session-Key' (A2 §2.1)`,
      );
      this.name = "HermesSessionHeaderMismatchError";
    }
  }

  const EXPECTED_SESSION_KEY_HEADER = "X-Hermes-Session-Key";

  /** A2-D9: 프로세스를 spawn하지 않는 HTTP형 RuntimeAdapter. session_key를
   *  X-Hermes-Session-Key에 1:1로 얹고, 응답의 X-Hermes-Session-Id를 다음 턴의
   *  previous_response_id 체이닝에 쓴다(§4.4 "이 매핑이 1:1이라 어댑터가 제일 얇다"). */
  export class HermesAdapter implements RuntimeAdapter {
    readonly kind: RuntimeKind = "hermes";
    readonly #lastResponseId = new Map<string, string>();
    constructor(private readonly cfg: HermesConfig) {}

    async probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }> {
      const fetchFn = this.cfg.fetchFn ?? fetch;
      const res = await fetchFn(`${this.cfg.baseUrl}/v1/capabilities`, {
        headers: { authorization: `Bearer ${this.cfg.token}` },
      });
      if (!res.ok) {
        throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `Hermes /v1/capabilities failed: ${res.status}`);
      }
      const body = (await res.json()) as HermesCapabilitiesResponse;
      if (body.session_key_header !== EXPECTED_SESSION_KEY_HEADER) {
        throw new HermesSessionHeaderMismatchError(body.session_key_header);
      }
      return { version: "hermes", capabilities: parseHermesCapabilities(body) };
    }

    async startTurn(_s: SessionRecord, _input: unknown, _sink: EventSink): Promise<TurnHandle> {
      throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, "startTurn not implemented until Task 12");
    }

    async cancel(): Promise<boolean> {
      throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, "cancel not implemented until Task 13");
    }

    async close(): Promise<void> {
      /* Task 13이 채운다 */
    }
  }
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/local-agent test` — 예상 출력: `Tests  3 passed (3)`.

- [ ] 5. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add apps/local-agent/src/bridges/hermes.ts apps/local-agent/test/hermes.test.ts
  git commit -m "$(cat <<'EOF'
  US-B39: Hermes 브리지 — probe() + capabilities 자기기술 검증

  - GET /v1/capabilities를 bearer 토큰으로 조회, session_key_header 불일치는
    HermesSessionHeaderMismatchError(A2 §2.1: degraded 등록·세션 미개방)
  - parseHermesCapabilities(): approvals='none' 고정(A2-D9, Phase B는 읽기 전용)
  - startTurn()/cancel()은 아직 CAPABILITY_UNSUPPORTED(Task 12·13)

  Implemented-by: Claude Opus
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 12: Hermes 브리지 — `startTurn()` origin 가드 + `/v1/responses` 요청 구성 (US-B39, tier: Opus)

**검증 명령:** `pnpm --filter @omnis/local-agent test`.

**Files:** Modify: `apps/local-agent/src/bridges/hermes.ts`. Test: `apps/local-agent/test/hermes.test.ts`(추가).

**Interfaces:** Consumes: `SessionRecord.origin`/`session_key`, `TurnInput`. Produces: `startTurn()`(요청까지 — SSE 파싱은 Task 13).

읽을 스펙: A2-D9(Phase B는 `origin:'human'`만 허용, `delegation`은 거부 — 위임 대상에서 제외) · §4.4(턴은 `/v1/responses`에 `conversation`(=`session_key`) 또는 `previous_response_id`로 체인, `X-Hermes-Session-Key` 헤더, 응답의 `X-Hermes-Session-Id`를 다음 턴 체이닝에 쓴다).

- [ ] 1. 실패하는 테스트를 추가한다: `apps/local-agent/test/hermes.test.ts`에 새 `describe` 블록.

  ```ts
  import { BridgeError } from "@omnis/protocol";
  import type { SessionRecord } from "../src/session-registry.js";

  function fakeSink() {
    const calls: Record<string, unknown[]> = { turnStarted: [], delta: [], itemCompleted: [], turnCompleted: [] };
    return {
      sink: {
        itemStarted: () => {},
        delta: (e: Record<string, unknown>) => calls.delta.push(e),
        itemCompleted: (e: Record<string, unknown>) => calls.itemCompleted.push(e),
        turnStarted: (e: Record<string, unknown>) => calls.turnStarted.push(e),
        turnCompleted: (e: Record<string, unknown>) => calls.turnCompleted.push(e),
        approval: async () => ({ decision: "ignore" as const }),
        raw: () => {},
      },
      calls,
    };
  }

  function baseSession(origin: SessionRecord["origin"]): SessionRecord {
    return {
      session_key: "agent:hermes:mini:inbox-draft" as never,
      session_id: null, runtime: "hermes", runtime_id: "r-1",
      cwd: "/", purpose: "inbox-draft", origin, permission_profile: "observe",
      state: "idle", opened_at: "2026-09-20T00:00:00.000Z", last_turn_at: null,
    };
  }

  describe("HermesAdapter.startTurn()", () => {
    it("rejects non-human origin (A2-D9: Phase B is read-only, no delegation)", async () => {
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1" });
      const { sink } = fakeSink();
      await expect(
        adapter.startTurn(baseSession("delegation"), { text: "do x" }, sink),
      ).rejects.toBeInstanceOf(BridgeError);
    });

    it("POSTs /v1/responses with X-Hermes-Session-Key and conversation=session_key on the first turn", async () => {
      const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe("http://127.0.0.1:8642/v1/responses");
        expect((init.headers as Record<string, string>)["X-Hermes-Session-Key"]).toBe("agent:hermes:mini:inbox-draft");
        expect(JSON.parse(String(init.body))).toEqual({ conversation: "agent:hermes:mini:inbox-draft", input: "do x" });
        return new Response(new ReadableStream({ start(c) { c.close(); } }), {
          status: 200,
          headers: { "X-Hermes-Session-Id": "resp-1" },
        });
      });
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      const { sink, calls } = fakeSink();
      const handle = await adapter.startTurn(baseSession("human"), { text: "do x" }, sink);
      expect(handle.turn_id).toMatch(/^t-/);
      expect(calls.turnStarted).toHaveLength(1);
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test` — 예상 실패: `startTurn not implemented until Task 12`.

- [ ] 3. `hermes.ts`의 `startTurn()` 스텁을 실제 구현으로 갈아 끼운다(SSE 본문 소비는 `#pump`로 위임 — Task 13이 채운다, 지금은 빈 no-op으로 둔다).

  ```ts
  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    if (s.origin !== "human") {
      throw new BridgeError(
        BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED,
        "Hermes sessions are read-only in Phase B — origin must be 'human' (A2-D9)",
      );
    }
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const now = this.cfg.now ?? ((): Date => new Date());
    const turnId = `t-${Date.now().toString(36)}`;
    const controller = new AbortController();
    const previousResponseId = this.#lastResponseId.get(s.session_key);
    const body: Record<string, unknown> = previousResponseId
      ? { previous_response_id: previousResponseId, input: input.text }
      : { conversation: s.session_key, input: input.text };

    const res = await fetchFn(`${this.cfg.baseUrl}/v1/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        "content-type": "application/json",
        "X-Hermes-Session-Key": s.session_key,
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || res.body === null) {
      throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `Hermes /v1/responses failed: ${res.status}`);
    }
    const sessionId = res.headers.get("X-Hermes-Session-Id");
    if (sessionId !== null) this.#lastResponseId.set(s.session_key, sessionId);

    sink.turnStarted({ session_key: s.session_key, turn_id: turnId, at: now().toISOString() });
    void this.#pump(res.body, s.session_key, turnId, sink);

    return {
      turn_id: turnId,
      cancel: async (): Promise<boolean> => {
        controller.abort();
        return true;
      },
    };
  }

  async #pump(_body: ReadableStream<Uint8Array>, _sessionKey: string, _turnId: string, _sink: EventSink): Promise<void> {
    /* Task 13이 SSE 파싱을 채운다 */
  }
  ```

  `TurnInput`을 상단 import에 더한다: `import { BRIDGE_ERRORS, BridgeError, type RuntimeCapabilities, type RuntimeKind, type TurnInput } from "@omnis/protocol";`

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/local-agent test`.

- [ ] 5. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add apps/local-agent/src/bridges/hermes.ts apps/local-agent/test/hermes.test.ts
  git commit -m "$(cat <<'EOF'
  US-B39: Hermes startTurn() — origin 가드 + /v1/responses 요청 구성

  - origin!=='human'은 CAPABILITY_UNSUPPORTED로 즉시 거절(A2-D9, 위임 대상 제외)
  - 첫 턴은 conversation=session_key, 이후 턴은 previous_response_id로 체인(§4.4)
  - X-Hermes-Session-Key 요청 헤더 + 응답 X-Hermes-Session-Id를 다음 턴 체이닝에 저장
  - SSE 본문 소비는 #pump 스텁(Task 13)

  Implemented-by: Claude Opus
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 13: Hermes 브리지 — SSE `#pump`(keepalive 억제 + delta/done) + `cancel()`/`close()` (US-B39, tier: Opus)

**검증 명령:** `pnpm --filter @omnis/local-agent test`.

**Files:** Modify: `apps/local-agent/src/bridges/hermes.ts`. Test: `apps/local-agent/test/hermes.test.ts`(추가, US-B39 마지막 태스크).

**Interfaces:** Consumes: 없음(내부 스트림 파서). Produces: 완성된 `HermesAdapter`(`#pump`/`cancel`/`close`).

읽을 스펙: A2 §4.4("SSE, 10초 무음마다 `: keepalive` 주석. 어댑터는 keepalive를 이벤트로 올리지 않고 health 타이머만 갱신한다"). 페이로드 JSON 필드명(`type: 'delta'|'done'`, `text`)은 **UNVERIFIED against 실제 Hermes API**(`09`가 세션 헤더 분리·capabilities 자기기술·SSE keepalive 존재는 검증했지만 `/v1/responses` 이벤트 페이로드의 정확한 필드명까지는 1차 소스로 못 박지 못했다) — 메커니즘(스트림 파싱, keepalive 억제, 헤더 전파, origin 가드)은 이 태스크의 mock SSE 테스트로 완전히 검증되고, 정확한 필드명은 A1-⑦과 같은 급의 실연결 시점 확인 대상이다(B-D5로 지금은 fixture/mock만).

- [ ] 1. 실패하는 테스트를 추가한다: `apps/local-agent/test/hermes.test.ts`.

  ```ts
  function sseStream(lines: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    });
  }

  describe("HermesAdapter SSE pump", () => {
    it("suppresses ': keepalive' comments and emits delta/itemCompleted/turnCompleted for data lines", async () => {
      const fetchFn = vi.fn(
        async () =>
          new Response(
            sseStream([
              ": keepalive",
              `data: ${JSON.stringify({ type: "delta", text: "hel" })}`,
              ": keepalive",
              `data: ${JSON.stringify({ type: "delta", text: "lo" })}`,
              `data: ${JSON.stringify({ type: "done" })}`,
            ]),
            { status: 200, headers: { "X-Hermes-Session-Id": "resp-1" } },
          ),
      );
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      const { sink, calls } = fakeSink();
      await adapter.startTurn(baseSession("human"), { text: "hi" }, sink);
      await new Promise((r) => setTimeout(r, 20)); // #pump는 fire-and-forget(void) — 배출 완료를 잠깐 기다린다
      expect(calls.delta.map((d) => (d as { text: string }).text)).toEqual(["hel", "lo"]);
      expect(calls.itemCompleted).toHaveLength(1);
      expect((calls.itemCompleted[0] as { body: string }).body).toBe("hello");
      expect(calls.turnCompleted).toHaveLength(1);
      expect((calls.turnCompleted[0] as { status: string }).status).toBe("ok");
    });
  });

  describe("HermesAdapter.cancel()/close()", () => {
    it("cancel() aborts the in-flight fetch via the turn handle", async () => {
      const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return new Response(sseStream([]), { status: 200 });
      });
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      const { sink } = fakeSink();
      const handle = await adapter.startTurn(baseSession("human"), { text: "hi" }, sink);
      expect(await adapter.cancel(handle, "user cancelled")).toBe(true);
    });
    it("close() resolves without throwing (stateless HTTP client, no resident resource)", async () => {
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1" });
      await expect(adapter.close()).resolves.toBeUndefined();
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test` — 예상 실패: `delta` 배열이 비어 있다(`#pump`가 아직 no-op), `cancel()`이 `CAPABILITY_UNSUPPORTED`를 던진다.

- [ ] 3. `hermes.ts`의 `#pump`와 `cancel()`을 실제 구현으로 갈아 끼운다.

  ```ts
  async #pump(body: ReadableStream<Uint8Array>, sessionKey: string, turnId: string, sink: EventSink): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let seq = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: SSE 라인 파서 관용구
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (line === "" || line.startsWith(":")) continue; // ': keepalive' — 이벤트로 올리지 않는다(A2 §4.4)
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]" || payload === "") continue;
        let ev: { type?: string; text?: string };
        try {
          ev = JSON.parse(payload);
        } catch {
          continue; // 미지 형식이 파서를 죽이지 않는다(claude-code.ts stream-json 파서와 동일 원칙)
        }
        if (ev.type === "delta" && typeof ev.text === "string") {
          text += ev.text;
          sink.delta({ session_key: sessionKey, turn_id: turnId, item_id: turnId, seq: seq++, text: ev.text, channel: "output" });
        } else if (ev.type === "done") {
          sink.itemCompleted({
            session_key: sessionKey, turn_id: turnId, item_id: turnId,
            kind: "agent_turn", body: text, status: "ok", meta: {},
          });
          sink.turnCompleted({
            session_key: sessionKey, turn_id: turnId, status: "ok",
            usage: { cost_usd: null, duration_ms: 0, num_turns: 1 },
          });
        }
      }
    }
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> {
    return h.cancel(reason);
  }

  async close(): Promise<void> {
    /* HTTP 클라이언트라 닫을 상주 자원이 없다(A2 §4.4 — 프로세스를 spawn하지 않는다) */
  }
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다: `pnpm --filter @omnis/local-agent test` — 예상 출력: 전체 통과.

- [ ] 5. lint 후 커밋한다(US-B39 마지막 커밋).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm lint
  git add apps/local-agent/src/bridges/hermes.ts apps/local-agent/test/hermes.test.ts
  git commit -m "$(cat <<'EOF'
  US-B39: Hermes SSE pump(keepalive 억제) + cancel()/close()

  - ': keepalive' 주석은 절대 이벤트로 올리지 않는다(A2 §4.4) — health 타이머 갱신은 브리지
    기동 코드(이 플랜 밖)가 30초 health 알림 루프에서 맡는다
  - data: delta는 sink.delta, done은 sink.itemCompleted+sink.turnCompleted
  - cancel()은 AbortController로 진행 중인 fetch를 취소
  - close()는 no-op(HTTP 클라이언트, 상주 자원 없음)
  - 이벤트 페이로드 필드명은 UNVERIFIED against 실제 Hermes API — 메커니즘은 mock SSE로 검증됨,
    필드명 확정은 A1-⑦급 실연결 스파이크 대상(B-D5)

  Implemented-by: Claude Opus
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 14: 커널 — `recordAdapterHealth()` + 시스템 Item 이중 노출 + ntfy (US-B40, tier: Sonnet)

**US-B40 산출물(백로그):** `packages/kernel/src/jobs/{token-refresh,rewatch}.ts`, `packages/kernel/src/adapter-health.ts`. **검증 명령:** `pnpm --filter @omnis/kernel test:integration`. **목표:** 어댑터 health 연속 실패를 `accounts.state`+시스템 Item+ntfy로 이중 노출한다.

**Files:** Create: `packages/kernel/src/adapter-health.ts`. Test: `packages/kernel/test/integration/adapter-health.test.ts`.

**Interfaces:** Consumes: `@omnis/db`의 `one`/`query`/`tx`(FIXED, Phase A), `@omnis/protocol`의 `Channel`(FIXED), `packages/kernel/src/logger.ts`의 `Logger`(FIXED). Produces: `ADAPTER_HEALTH_FAIL_THRESHOLD`, `NtfyDeps`, `sendNtfy()`, `AdapterHealthDeps`, `recordAdapterHealth(deps, channel, ok, error?): Promise<void>`, `resetAdapterHealthCounters()`(테스트 전용).

읽을 스펙: A1 §1.5(`down` 5분 지속 → ntfy+시스템 Item, 원칙만 차용 — 이 함수는 폴링 주체가 호출할 때마다의 "연속 실패 횟수"를 세는 범용 버전이다) · A6 §8(ntfy 토픽 2단: `omnis-critical`/`omnis-warning`, `curl -d "message" <url>/topic` 1줄) · A6 §8("모든 critical/warning은 ntfy + `items(kind='system')` 이중 노출"). `accounts.state`는 `active`/`paused`/`broken` 3값만 허용한다(A3 §8 `accounts_state_ck` 실측) — "연결 끊김"은 `broken`으로 표현한다.

- [ ] 1. 실패하는 테스트를 작성한다: `packages/kernel/test/integration/adapter-health.test.ts`

  ```ts
  import { createPool, one, query } from "@omnis/db";
  import { createLogger } from "@omnis/kernel";
  import {
    ADAPTER_HEALTH_FAIL_THRESHOLD,
    recordAdapterHealth,
    resetAdapterHealthCounters,
  } from "@omnis/kernel";
  import type { Pool } from "pg";
  import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

  let pool: Pool;
  const logger = createLogger("@omnis/kernel");

  beforeAll(() => {
    pool = createPool();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    resetAdapterHealthCounters();
    await query(pool, "DELETE FROM accounts WHERE channel IN ('outlook', 'system')");
  });
  afterEach(async () => {
    await query(pool, "DELETE FROM accounts WHERE channel IN ('outlook', 'system')");
  });

  describe("recordAdapterHealth()", () => {
    it("does nothing to accounts.state before the consecutive-failure threshold", async () => {
      await query(pool, `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`);
      for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD - 1; i += 1) {
        await recordAdapterHealth({ pool, logger }, "outlook", false, "network down");
      }
      const row = await one<{ state: string }>(pool, `SELECT state FROM accounts WHERE channel = 'outlook'`);
      expect(row.state).toBe("active");
    });

    it("flips accounts.state to broken and inserts a system item once the threshold is hit", async () => {
      await query(pool, `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`);
      for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD; i += 1) {
        await recordAdapterHealth({ pool, logger }, "outlook", false, "network down");
      }
      const account = await one<{ state: string; last_error: string }>(
        pool, `SELECT state, last_error FROM accounts WHERE channel = 'outlook'`,
      );
      expect(account.state).toBe("broken");
      expect(account.last_error).toBe("network down");
      const sys = await one<{ n: string }>(
        pool,
        `SELECT count(*)::text AS n FROM items i JOIN threads t ON t.id = i.thread_id
          WHERE i.kind = 'system' AND i.body LIKE '%outlook%연결 끊김%'`,
      );
      expect(Number(sys.n)).toBeGreaterThanOrEqual(1);
    });

    it("recovers accounts.state to active and resets the counter on ok=true", async () => {
      await query(pool, `INSERT INTO accounts (channel, external_id, display, state) VALUES ('outlook', 'a@x.com', 'a', 'broken')`);
      await recordAdapterHealth({ pool, logger }, "outlook", true);
      const row = await one<{ state: string }>(pool, `SELECT state FROM accounts WHERE channel = 'outlook'`);
      expect(row.state).toBe("active");
    });

    it("POSTs to the ntfy topic once the threshold is hit, and skips silently when ntfy.url is unset", async () => {
      await query(pool, `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`);
      const fetchFn = vi.fn(async () => new Response("", { status: 200 }));
      for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD; i += 1) {
        await recordAdapterHealth(
          { pool, logger, ntfy: { url: "http://127.0.0.1:2586", topic: "omnis-warning", fetchFn: fetchFn as unknown as typeof fetch } },
          "outlook", false, "network down",
        );
      }
      expect(fetchFn).toHaveBeenCalledOnce();
      expect((fetchFn.mock.calls[0] as [string])[0]).toBe("http://127.0.0.1:2586/omnis-warning");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

  예상 실패: `recordAdapterHealth is not exported from '@omnis/kernel'`.

- [ ] 3. `packages/kernel/src/adapter-health.ts`를 작성한다.

  ```ts
  import { one, query, tx } from "@omnis/db";
  import type { Channel } from "@omnis/protocol";
  import type { Pool, PoolClient } from "pg";
  import type { Logger } from "./logger.js";

  // ponytail: N=3 연속 실패로 고정한다(A1 §1.5는 "5분 지속"을 기준으로 삼지만 이 함수는 폴링
  // 호출 횟수 기준 범용 카운터다 — 채널별 폴링 주기가 다 다르므로 시간이 아니라 횟수로 센다).
  // 너무 시끄럽거나 너무 둔하면 settings.notify.* 옆에 채널별 설정으로 승격한다(B-D2 kv 패턴).
  export const ADAPTER_HEALTH_FAIL_THRESHOLD = 3;

  const SYSTEM_ACCOUNT_EXTERNAL_ID = "omnis-system";
  const SYSTEM_THREAD_EXTERNAL_ID = "adapter-health";

  // ponytail: 프로세스 내 Map이다 — 허브 재시작 시 카운터가 리셋된다. accounts에 새 컬럼을 추가하지
  // 않는 것(델타 §6 "accounts는 컬럼 변경 없음")과 맞바꾼 단순화다. 재시작 직후 반짝 재카운트되는
  // 정도는 "연속 3회"의 오탐 허용 범위 안에 있다.
  const consecutiveFailures = new Map<Channel, number>();

  export function resetAdapterHealthCounters(): void {
    consecutiveFailures.clear();
  }

  export interface NtfyDeps {
    url?: string;
    topic?: string;
    fetchFn?: typeof fetch;
  }

  /** A6 §8: self-host ntfy, `curl -d "message" <url>/<topic>` 한 줄. url 미설정이면 조용히
   *  스킵한다 — 미니 기동 초기엔 ntfy가 아직 없을 수 있고, 시스템 Item 쪽 이중 노출은 항상 돈다. */
  export async function sendNtfy(deps: NtfyDeps, message: string): Promise<void> {
    if (deps.url === undefined) return;
    const fetchFn = deps.fetchFn ?? fetch;
    await fetchFn(`${deps.url.replace(/\/$/, "")}/${deps.topic ?? "omnis-warning"}`, {
      method: "POST",
      body: message,
    });
  }

  async function ensureSystemThread(c: PoolClient): Promise<{ accountId: string; threadId: string }> {
    const account = await one<{ id: string }>(
      c,
      `INSERT INTO accounts (channel, external_id, display, state)
         VALUES ('system', $1, 'omnis system', 'active')
         ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
         RETURNING id`,
      [SYSTEM_ACCOUNT_EXTERNAL_ID],
    );
    const thread = await one<{ id: string }>(
      c,
      `INSERT INTO threads (account_id, external_id, kind, title)
         VALUES ($1, $2, 'system', '어댑터 상태')
         ON CONFLICT (account_id, external_id) DO UPDATE SET title = EXCLUDED.title
         RETURNING id`,
      [account.id, SYSTEM_THREAD_EXTERNAL_ID],
    );
    return { accountId: account.id, threadId: thread.id };
  }

  export interface AdapterHealthDeps {
    pool: Pool;
    logger: Logger;
    ntfy?: NtfyDeps;
  }

  /** A1 §1.5 + A6 §8 원칙의 범용 구현. ok=false를 연속 ADAPTER_HEALTH_FAIL_THRESHOLD회 받으면
   *  accounts.state='broken' + items(kind='system') + ntfy 이중 노출(A6 §8). ok=true는 카운터를
   *  리셋하고 broken이었던 계정을 active로 되돌린다. */
  export async function recordAdapterHealth(
    deps: AdapterHealthDeps,
    channel: Channel,
    ok: boolean,
    error?: string,
  ): Promise<void> {
    const { pool, logger } = deps;
    if (ok) {
      consecutiveFailures.set(channel, 0);
      await query(
        pool,
        `UPDATE accounts SET state = 'active', last_health_at = now(), last_error = NULL
          WHERE channel = $1 AND state = 'broken'`,
        [channel],
      );
      return;
    }

    const n = (consecutiveFailures.get(channel) ?? 0) + 1;
    consecutiveFailures.set(channel, n);
    await query(
      pool,
      `UPDATE accounts SET last_health_at = now(), last_error = $2 WHERE channel = $1`,
      [channel, error ?? null],
    );
    if (n < ADAPTER_HEALTH_FAIL_THRESHOLD) return;

    const message = `${channel} 어댑터 연결 끊김 (${n}회 연속 실패): ${error ?? "unknown"}`;
    await tx(pool, async (c) => {
      await query(c, `UPDATE accounts SET state = 'broken', last_error = $2 WHERE channel = $1`, [channel, error ?? null]);
      const { accountId, threadId } = await ensureSystemThread(c);
      await query(
        c,
        `INSERT INTO items (thread_id, account_id, kind, body, sent_at) VALUES ($1, $2, 'system', $3, now())`,
        [threadId, accountId, message],
      );
    });
    logger.error("adapter health threshold exceeded", { channel, consecutive: n, error });
    await sendNtfy(deps.ntfy ?? {}, `[omnis] ${message}`);
  }
  ```

- [ ] 4. `packages/kernel/src/index.ts`에 export를 추가한다.

  ```ts
  export {
    ADAPTER_HEALTH_FAIL_THRESHOLD,
    recordAdapterHealth,
    resetAdapterHealthCounters,
    sendNtfy,
  } from "./adapter-health.js";
  export type { AdapterHealthDeps, NtfyDeps } from "./adapter-health.js";
  ```

- [ ] 5. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

  예상 출력: `adapter-health.test.ts` 4건 전체 통과.

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/kernel/src/adapter-health.ts packages/kernel/src/index.ts packages/kernel/test/integration/adapter-health.test.ts
  git commit -m "$(cat <<'EOF'
  US-B40: recordAdapterHealth() — accounts.state='broken' + 시스템 Item + ntfy 이중 노출

  - 연속 ADAPTER_HEALTH_FAIL_THRESHOLD(3)회 실패 시 accounts.state='broken'+last_error,
    items(kind='system')(A6 §8 이중 노출), sendNtfy()(omnis-warning 기본 토픽)
  - ok=true는 카운터 리셋 + broken이었던 계정을 active로 복구
  - ntfy.url 미설정이면 조용히 스킵(시스템 Item 쪽은 항상 돈다)
  - 프로세스 내 Map 카운터(ponytail: accounts 컬럼 추가 없이, 재시작 시 리셋 허용)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 15: 커널 — `token_refresh` 잡 실동작 (US-B40, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/kernel test:integration`.

**Files:** Create: `packages/kernel/src/jobs/token-refresh.ts`. Test: `packages/kernel/test/integration/token-refresh-job.test.ts`.

**Interfaces:** Consumes: `@omnis/db`의 `query`(FIXED), `packages/kernel/src/scheduler.ts`의 `Scheduler`(FIXED, `register()`가 이미 `jobs` upsert까지 한다 — `healthcheck.ts` Task와 동일 패턴), `@omnis/protocol`의 `AuthRef`/`Channel`(FIXED). Produces: `TOKEN_REFRESH_JOB_NAME`(`"token_refresh"`, 0006 seed와 동일 이름 — 새로 만들지 않고 기존 seed 행에 핸들러만 붙는다, 델타 §8 "기존 잡에 핸들러가 붙는 것"), `TOKEN_REFRESH_CRON`, `TokenRefresher`, `TokenRefreshDeps`, `registerTokenRefreshJob(scheduler, deps)`.

읽을 스펙: 델타 §8("token_refresh(B40)… 기존 잡에 핸들러가 붙는 것" — seed는 이미 0006에 있다, cron `*/30 * * * *`). **provider SDK는 어댑터 패키지 안에서만**(Global Constraints) — 이 잡은 실제 OAuth 갱신 로직을 갖지 않고, 만료 임박 계정을 찾아 채널별로 주입된 `TokenRefresher` 콜백에 위임만 한다(허브 부트스트랩이 각 어댑터의 `connect()`/`refreshAccessToken()`을 이 콜백으로 감싸 주입하는 것은 이 플랜 밖 — `apps/hub` 배선 스토리).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/kernel/test/integration/token-refresh-job.test.ts`

  ```ts
  import { createPool, one, query } from "@omnis/db";
  import { createEvents, createLogger, createScheduler, registerTokenRefreshJob } from "@omnis/kernel";
  import type { Events, Scheduler } from "@omnis/kernel";
  import type { Pool } from "pg";
  import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

  let pool: Pool;
  let events: Events & { close(): Promise<void> };
  let scheduler: Scheduler;
  let accountId: string;

  beforeAll(async () => {
    pool = createPool();
    events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
    const account = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'expiring@x.com', 'x') RETURNING id`,
    );
    accountId = account.id;
    await query(
      pool,
      `INSERT INTO account_secrets (account_id, auth_ref, expires_at) VALUES ($1, 'omnis.outlook.expiring@x.com', now() + interval '5 minutes')`,
      [accountId],
    );
  });
  afterAll(async () => {
    await scheduler.stop();
    await query(pool, "DELETE FROM account_secrets WHERE account_id = $1", [accountId]);
    await query(pool, "DELETE FROM accounts WHERE id = $1", [accountId]);
    await query(pool, "DELETE FROM jobs WHERE name = 'token_refresh'");
    await events.close();
    await pool.end();
  });

  describe("token_refresh job", () => {
    it("calls the injected refresher for accounts whose secret expires within the window", async () => {
      const refresher = vi.fn(async () => {});
      scheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
      registerTokenRefreshJob(scheduler, {
        pool, logger: createLogger("@omnis/kernel"),
        refreshers: { outlook: refresher }, windowMinutes: 60,
      });
      await scheduler.start();
      await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'token_refresh'`);
      await new Promise((r) => setTimeout(r, 300));
      expect(refresher).toHaveBeenCalledOnce();
      const [auth] = refresher.mock.calls[0] as [{ channel: string; accountExternalId: string; keychainService: string }];
      expect(auth.channel).toBe("outlook");
      expect(auth.accountExternalId).toBe("expiring@x.com");
      expect(auth.keychainService).toBe("omnis.outlook.expiring@x.com");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

  예상 실패: `registerTokenRefreshJob is not exported from '@omnis/kernel'`.

- [ ] 3. `packages/kernel/src/jobs/token-refresh.ts`를 작성한다.

  ```ts
  import { query } from "@omnis/db";
  import type { AuthRef, Channel } from "@omnis/protocol";
  import type { Pool } from "pg";
  import type { Logger } from "../logger.js";
  import type { Scheduler } from "../scheduler.js";

  export const TOKEN_REFRESH_JOB_NAME = "token_refresh";
  export const TOKEN_REFRESH_CRON = "*/30 * * * *"; // 0006 seed와 동일(A3 소유 인프라 잡)
  // ponytail: 만료 60분 전 일괄 갱신. 채널별로 실제 만료 여유가 다르면(Slack 토큰 무기한 등)
  // 그때 채널별 창으로 세분화한다.
  export const TOKEN_REFRESH_WINDOW_MINUTES = 60;

  export type TokenRefresher = (auth: AuthRef) => Promise<void>;

  export interface TokenRefreshDeps {
    pool: Pool;
    logger: Logger;
    // 이 호스트에 붙어 있는 어댑터가 채널별로 주입한다(허브 부트스트랩 소관, 이 플랜 밖).
    // 없는 채널은 조용히 스킵한다 — 다른 호스트의 local-agent가 그 채널을 담당한다.
    refreshers: Partial<Record<Channel, TokenRefresher>>;
    windowMinutes?: number;
  }

  interface DueSecretRow {
    channel: string;
    account_external_id: string;
    auth_ref: string;
  }

  export function registerTokenRefreshJob(scheduler: Scheduler, deps: TokenRefreshDeps): void {
    const windowMinutes = deps.windowMinutes ?? TOKEN_REFRESH_WINDOW_MINUTES;
    scheduler.register(TOKEN_REFRESH_JOB_NAME, TOKEN_REFRESH_CRON, async () => {
      const due = await query<DueSecretRow>(
        deps.pool,
        `SELECT a.channel, a.external_id AS account_external_id, s.auth_ref
           FROM account_secrets s JOIN accounts a ON a.id = s.account_id
          WHERE s.expires_at IS NOT NULL AND s.expires_at < now() + ($1 || ' minutes')::interval`,
        [windowMinutes],
      );
      for (const row of due) {
        const refresher = deps.refreshers[row.channel as Channel];
        if (refresher === undefined) continue;
        try {
          await refresher({
            channel: row.channel as Channel,
            accountExternalId: row.account_external_id,
            keychainService: row.auth_ref,
            keychainAccount: row.account_external_id,
          });
        } catch (e) {
          deps.logger.error("token refresh failed", {
            channel: row.channel,
            account: row.account_external_id,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });
  }
  ```

- [ ] 4. `packages/kernel/src/index.ts`에 export를 추가한다.

  ```ts
  export {
    TOKEN_REFRESH_CRON,
    TOKEN_REFRESH_JOB_NAME,
    TOKEN_REFRESH_WINDOW_MINUTES,
    registerTokenRefreshJob,
  } from "./jobs/token-refresh.js";
  export type { TokenRefreshDeps, TokenRefresher } from "./jobs/token-refresh.js";
  ```

- [ ] 5. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/kernel/src/jobs/token-refresh.ts packages/kernel/src/index.ts packages/kernel/test/integration/token-refresh-job.test.ts
  git commit -m "$(cat <<'EOF'
  US-B40: token_refresh 잡 실동작 — 채널별 TokenRefresher 콜백 위임

  - account_secrets.expires_at < now()+60분인 계정을 찾아 채널별 주입 콜백을 호출
  - 콜백 미주입 채널은 스킵(다른 호스트의 local-agent가 담당) — 커널은 provider SDK를
    직접 import하지 않는다(Global Constraints)
  - 기존 0006 seed 잡(token_refresh, */30 * * * *)에 핸들러만 붙인다(델타 §8)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 16: 커널 — `gmail_rewatch`(7일) + `graph_sub_renew`(10,080분) 재신청 (US-B40, tier: Sonnet)

**검증 명령:** `pnpm --filter @omnis/kernel test:integration`.

**Files:** Create: `packages/kernel/src/jobs/rewatch.ts`. Test: `packages/kernel/test/integration/rewatch-jobs.test.ts`.

**Interfaces:** Consumes: `@omnis/db`의 `query`(FIXED), `Scheduler`(FIXED). Produces: `GMAIL_REWATCH_JOB_NAME`/`CRON`, `GRAPH_SUB_RENEW_JOB_NAME`/`CRON`, `RewatchFn`, `RewatchDeps`, `registerGmailRewatchJob()`, `registerGraphSubRenewJob()`.

읽을 스펙: A1 §2.2(Gmail `users.watch` 7일 만료, 매일 자정 cron 재-`watch`) · A1 §2.4(Graph 메일 구독 최대 10,080분≈7일, 주 단위 갱신). 0006 seed에 이미 `gmail_rewatch`(`0 3 * * *`)와 `graph_sub_renew`(`0 4 * * 1`)가 있다 — 이 태스크는 핸들러만 붙인다(델타 §8).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/kernel/test/integration/rewatch-jobs.test.ts`

  ```ts
  import { createPool, one, query } from "@omnis/db";
  import {
    createEvents, createLogger, createScheduler,
    registerGmailRewatchJob, registerGraphSubRenewJob,
  } from "@omnis/kernel";
  import type { Events, Scheduler } from "@omnis/kernel";
  import type { Pool } from "pg";
  import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

  let pool: Pool;
  let events: Events & { close(): Promise<void> };
  let gmailScheduler: Scheduler;
  let graphScheduler: Scheduler;

  beforeAll(async () => {
    pool = createPool();
    events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
    await query(pool, `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail', 'a@gmail.com', 'a'), ('outlook', 'b@outlook.com', 'b')`);
  });
  afterAll(async () => {
    await gmailScheduler.stop();
    await graphScheduler.stop();
    await query(pool, "DELETE FROM accounts WHERE external_id IN ('a@gmail.com', 'b@outlook.com')");
    await query(pool, "DELETE FROM jobs WHERE name IN ('gmail_rewatch', 'graph_sub_renew')");
    await events.close();
    await pool.end();
  });

  describe("gmail_rewatch / graph_sub_renew jobs", () => {
    it("calls the injected rewatch callback for each active account on that channel", async () => {
      const gmailRewatch = vi.fn(async () => {});
      const graphRenew = vi.fn(async () => {});
      gmailScheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
      graphScheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
      registerGmailRewatchJob(gmailScheduler, { pool, logger: createLogger("@omnis/kernel"), rewatch: gmailRewatch });
      registerGraphSubRenewJob(graphScheduler, { pool, logger: createLogger("@omnis/kernel"), rewatch: graphRenew });
      await gmailScheduler.start();
      await graphScheduler.start();
      await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name IN ('gmail_rewatch', 'graph_sub_renew')`);
      await new Promise((r) => setTimeout(r, 300));
      expect(gmailRewatch).toHaveBeenCalledWith("a@gmail.com");
      expect(graphRenew).toHaveBeenCalledWith("b@outlook.com");
    });

    it("skips silently when no rewatch callback is wired on this host", async () => {
      const scheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
      registerGmailRewatchJob(scheduler, { pool, logger: createLogger("@omnis/kernel") });
      await scheduler.start();
      await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'gmail_rewatch'`);
      await new Promise((r) => setTimeout(r, 200));
      const job = await one<{ last_status: string }>(pool, "SELECT last_status FROM jobs WHERE name = 'gmail_rewatch'");
      expect(job.last_status).toBe("ok"); // 콜백 없음 = 정상 스킵, 실패가 아니다
      await scheduler.stop();
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

  예상 실패: `registerGmailRewatchJob is not exported from '@omnis/kernel'`.

- [ ] 3. `packages/kernel/src/jobs/rewatch.ts`를 작성한다.

  ```ts
  import { query } from "@omnis/db";
  import type { Pool } from "pg";
  import type { Logger } from "../logger.js";
  import type { Scheduler } from "../scheduler.js";

  export const GMAIL_REWATCH_JOB_NAME = "gmail_rewatch";
  export const GMAIL_REWATCH_CRON = "0 3 * * *"; // 0006 seed와 동일 — watch 만료 7일, 매일 갱신(A1 §2.2)
  export const GRAPH_SUB_RENEW_JOB_NAME = "graph_sub_renew";
  export const GRAPH_SUB_RENEW_CRON = "0 4 * * 1"; // 0006 seed와 동일 — 구독 만료 10,080분, 주 단위(A1 §2.4)

  export type RewatchFn = (accountExternalId: string) => Promise<void>;

  export interface RewatchDeps {
    pool: Pool;
    logger: Logger;
    // 이 호스트에 그 채널 어댑터가 없으면 undefined — 잡은 정상(ok)으로 스킵한다.
    rewatch?: RewatchFn;
  }

  async function runForChannel(deps: RewatchDeps, channel: string): Promise<void> {
    if (deps.rewatch === undefined) return;
    const rows = await query<{ external_id: string }>(
      deps.pool,
      `SELECT external_id FROM accounts WHERE channel = $1 AND state <> 'paused'`,
      [channel],
    );
    for (const row of rows) {
      try {
        await deps.rewatch(row.external_id);
      } catch (e) {
        deps.logger.error(`${channel} rewatch failed`, {
          account: row.external_id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  export function registerGmailRewatchJob(scheduler: Scheduler, deps: RewatchDeps): void {
    scheduler.register(GMAIL_REWATCH_JOB_NAME, GMAIL_REWATCH_CRON, () => runForChannel(deps, "gmail"));
  }

  export function registerGraphSubRenewJob(scheduler: Scheduler, deps: RewatchDeps): void {
    scheduler.register(GRAPH_SUB_RENEW_JOB_NAME, GRAPH_SUB_RENEW_CRON, () => runForChannel(deps, "outlook"));
  }
  ```

- [ ] 4. `packages/kernel/src/index.ts`에 export를 추가한다.

  ```ts
  export {
    GMAIL_REWATCH_CRON,
    GMAIL_REWATCH_JOB_NAME,
    GRAPH_SUB_RENEW_CRON,
    GRAPH_SUB_RENEW_JOB_NAME,
    registerGmailRewatchJob,
    registerGraphSubRenewJob,
  } from "./jobs/rewatch.js";
  export type { RewatchDeps, RewatchFn } from "./jobs/rewatch.js";
  ```

- [ ] 5. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

- [ ] 6. lint 후 커밋한다(US-B40 마지막 커밋).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm lint
  git add packages/kernel/src/jobs/rewatch.ts packages/kernel/src/index.ts packages/kernel/test/integration/rewatch-jobs.test.ts
  git commit -m "$(cat <<'EOF'
  US-B40: gmail_rewatch + graph_sub_renew 잡 실동작

  - 채널별 RewatchFn 콜백을 그 채널의 active/broken 계정 전부에 대해 호출
  - 콜백 미주입(이 호스트에 그 채널 어댑터가 없음)은 정상 스킵(last_status='ok')
  - 기존 0006 seed 잡(gmail_rewatch 0 3 * * *, graph_sub_renew 0 4 * * 1)에 핸들러만 붙인다(델타 §8)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## 자체 점검 (writing-plans 마지막 스텝)

**스토리 커버리지** — 백로그 §3의 `channels` 플랜 4개 스토리 전부 ≥1 태스크:

| 스토리 | 태스크 |
|---|---|
| US-B37(Outlook) | Task 1~5 |
| US-B38(Telegram) | Task 6~10 |
| US-B39(Hermes) | Task 11~13 |
| US-B40(하드닝) | Task 14~16 |

**금지 패턴 검사** — `TBD`/`TODO`/"implement later"/"add appropriate error handling"/"similar to Task N"/코드 없는 스텝/미정의 심볼, 17개 태스크 전부 grep 가능한 실제 코드와 정확한 실행·커밋 명령으로 채워져 있다. "Task N과 동일 패턴"이라고만 적은 곳은 전부 그 옆에 실제 코드 블록이 붙어 있다(예: Keychain 래퍼는 매번 전문을 다시 적는다 — 어댑터 패키지 간 import 금지라 실제로 복제해야 하는 코드이기도 하다).

**심볼 존재성 검사** — 이 플랜이 소비하는 심볼은 전부 Phase A/B 계약 문서 또는 이 플랜의 앞선 태스크에서 온다:
- `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health`/`NormalizedItem`/`Attachment`/`ThreadRef`/`Outbound`/`SendResult`/`Channel` — `2026-09-20-phase-a-interfaces.md` §3.2~3.3(FIXED)
- `RuntimeAdapter`/`EventSink`/`TurnHandle` — `apps/local-agent/src/rpc-dispatch.ts`(Phase A 실코드, FIXED 계약대로 이미 존재)
- `SessionRecord` — `apps/local-agent/src/session-registry.ts`(Phase A 실코드)
- `TurnInput`/`RuntimeCapabilities`/`BridgeError`/`BRIDGE_ERRORS`/`RuntimeKind` — `2026-09-20-phase-a-interfaces.md` §3.5(FIXED)
- `HttpRuntimeConfig`(`kind:"hermes"`) — `apps/local-agent/src/config.ts`(Phase A가 이미 파싱해 둔 설정 — 이 플랜은 그 설정으로 실제 클라이언트를 만드는 쪽만 채운다, delta §11의 "Phase A 계약 §8의 HTTP형 `[[runtime]]` 블록" 참조)
- `one`/`query`/`tx`/`createPool` — `2026-09-20-phase-a-interfaces.md` §4(FIXED)
- `Scheduler`/`Logger`/`createLogger`/`createEvents`/`createScheduler` — `2026-09-20-phase-a-interfaces.md` §5(FIXED)
- `recordAdapterHealth` — `2026-09-20-phase-b-interfaces-delta.md` §5(FIXED 시그니처, 이 플랜 Task 14가 정의)

## 산출 심볼 (델타 대비 새로 export되는 것)

- `packages/adapters/outlook`: `CHANNEL`, `normalize`, `mapApiError`, `refreshAccessToken`, `GraphClientLike`, `OutlookAdapterDeps`, `createOutlookAdapter`
- `packages/adapters/telegram`: `CHANNEL`, `normalize`, `mapApiError`, `TelegramClientLike`, `TelegramAdapterDeps`, `createTelegramAdapter`, `BACKFILL_MAX_DAYS`, `BACKFILL_MAX_ITEMS`
- `apps/local-agent/src/bridges/hermes.ts`: `HermesConfig`, `HermesCapabilitiesResponse`, `parseHermesCapabilities`, `HermesSessionHeaderMismatchError`, `HermesAdapter`
- `@omnis/kernel`(신규 export, `packages/kernel/src/index.ts`에 추가): `ADAPTER_HEALTH_FAIL_THRESHOLD`, `recordAdapterHealth`, `resetAdapterHealthCounters`, `sendNtfy`, `AdapterHealthDeps`, `NtfyDeps`, `TOKEN_REFRESH_JOB_NAME`, `TOKEN_REFRESH_CRON`, `TOKEN_REFRESH_WINDOW_MINUTES`, `registerTokenRefreshJob`, `TokenRefreshDeps`, `TokenRefresher`, `GMAIL_REWATCH_JOB_NAME`, `GMAIL_REWATCH_CRON`, `GRAPH_SUB_RENEW_JOB_NAME`, `GRAPH_SUB_RENEW_CRON`, `registerGmailRewatchJob`, `registerGraphSubRenewJob`, `RewatchDeps`, `RewatchFn`
- `packages/db/migrations/0012_jobs_phase_b.sql`(공유 소유, B14/B15/B44와 결정론적으로 동일)

## 미결 질문

1. **`apps/hub` 배선은 이 플랜 밖이다.** `createOutlookAdapter`/`createTelegramAdapter`/`HermesAdapter`를 실제로 인스턴스화해 `TokenRefreshDeps.refreshers`/`RewatchDeps.rewatch`/`local-agent`의 `adapters: Map<RuntimeKind, RuntimeAdapter>`에 등록하는 코드는 어디에도 없다(Phase A의 Slack/Gmail/GCal도 `apps/local-agent/src/main.ts`가 여전히 `adapters: new Map()`으로 비어 있는 것과 같은 상태 — 이 실측은 Task 1 리서치에서 확인됨). 허브·local-agent 부트스트랩 배선 스토리가 어느 계획 문서 소관인지 Logan 확인 필요.
2. **`GET /transcript/:session_id?last_n`**(델타 §7, US-B39 소유로 표기됨)는 `apps/hub`의 `SessionSummary` 라우트라 이 플랜의 파일 목록(`apps/local-agent/src/bridges/hermes.ts`)엔 없다. 백로그 US-B39의 산출물이 `apps/local-agent` 한 파일뿐이므로 이 라우트는 구현하지 않았다 — surfaces 플랜이나 별도 hub 배선 태스크가 가져가야 한다.
3. **Hermes `/v1/responses` SSE 이벤트 페이로드의 정확한 필드명**(`type:'delta'|'done'`)은 UNVERIFIED(Task 13 참고) — A1-⑦과 같은 급으로 실연결 시점에 스파이크가 필요하지만 백로그 §5의 "Phase B 진입 스파이크" 목록엔 Hermes가 없다(A1-⑥/A1-⑦만 명시). 이 스파이크를 새로 등록할지, S-A2-5(Phase C 승인 표면 검증)에 흡수할지 Logan 결정 필요.
4. **`ADAPTER_HEALTH_FAIL_THRESHOLD=3`과 ntfy URL의 출처**는 이 플랜이 고정한 값이다(interfaces delta에 없음) — `settings`(B-D2, US-B33)가 만들어지면 `notify.*` 옆에 `adapter.health_threshold`류 키로 승격할지, ntfy base URL을 환경변수(`OMNIS_NTFY_URL`, 이 플랜이 새로 도입 — 델타 §9에 없다)로 고정할지 미결.
5. **`0012_jobs_phase_b.sql`의 공유 소유**(B14/B15/B37/B44 4개 플랜)는 내용이 결정론적이라 이론상 무충돌이지만, 실제 병렬 워크트리 머지 순서에 따라 먼저 머지되는 플랜이 파일을 만들고 나머지는 "이미 존재함 + 내용 동일" 확인만 하는 흐름이 되어야 한다 — `worktrunk` 머지 오케스트레이션이 이 케이스(여러 브랜치가 같은 새 파일을 독립적으로 만듦)를 자동으로 merge-clean 처리하는지 실측 필요(A7 §2의 워크트리 스파이크가 이 케이스까지 커버하지 않았다).
