# omnis Phase A Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Tauri 2 macOS shell of omnis — design tokens, Liquid Glass primitives, the Zero read client, and the Inbox/Thread/Agent Session/⌘K/ApprovalCard/Onboarding screens — so Logan can see and triage a real (once A05~A21 land) inbox on his Mac.
**Architecture:** `packages/ui` holds pure-presentation React components (design tokens + shadcn/Radix primitives + 5 custom omnis components) with zero `@omnis/*` runtime dependencies; `apps/desktop` is the Tauri 2 shell that wires those components to a read/write Zero client and to the hub's `/approvals` HTTP surface. Screens never talk to Postgres directly — all data flows through `@rocicorp/zero` (durable tier) or the hub's typed HTTP endpoints (approval decisions), per master §4.1 L4/L0 boundary.
**Tech Stack:** React 18 + TypeScript 5 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tailwind v4, shadcn/ui (Radix primitives) + `class-variance-authority`, `react-virtuoso`, `cmdk`, `lucide-react`, Tauri 2 + `window-vibrancy`, `@rocicorp/zero`, Vite 5, vitest + `@testing-library/react` + `jsdom`, Biome, Rust (Tauri backend) with `cargo test`.
**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` (§4.1 L4, §6 데이터 모델, §12 표면) + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A5-ui-ux.md` (전체: §1 토큰, §2 내비/팔레트, §3.1/3.2/3.3/3.9 화면, §5 컴포넌트 맵, §6 Tauri 셸, §7 온보딩, §8 마이크로카피) + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A3-data-schema.md` §7 (Zero 복제 범위) + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A7-dev-process.md` (§1 모노레포, §2 툴체인, §5 테스트, §7 스토리 카드) + `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` (패키지명·심볼·명령 정본).

## Global Constraints

- Node 22 + pnpm workspaces.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`(A7 §1).
- Postgres 17(A3) — 이 플랜의 화면은 Postgres에 직접 접속하지 않고 Zero/hub HTTP로만 접근한다.
- hub binds `127.0.0.1:8787`(master §4.2).
- migrations are append-only files `packages/db/migrations/000N_<name>.sql` with tracking table `_omnis_migrations`(A3 §8) — 이 플랜은 마이그레이션을 만들지 않는다(참조만).
- no irreversible tool(send/delete/delegate/calendar_write) wired before the approval gate exists(A7 §7 공통 금지) — `ApprovalCard`의 `onDecide`는 사람이 명시적으로 누른 뒤에만 hub `/approvals/:id/decide`를 호출하고, 클라이언트는 `pending_approvals`를 직접 `executed`로 못 바꾼다(A3 §7 Zero 권한 규칙).
- provider SDKs only inside their adapter package — 이 플랜은 어댑터를 만들지 않으므로 해당 없음, `@omnis/desktop`은 어떤 채널 provider SDK도 직접 import하지 않는다.
- Keychain item naming per A1 / 인터페이스 계약 §9(기본형 `omnis.<channel>.<kind>.<external_id>`; bridge token `omnis.bridge.token.<host>`) — 온보딩(US-A31)이 이 스킴으로 Keychain에 쓴다. **단 두 예외(계약 §9, 계약 리뷰 M7·M8)**: Google 계열(`gmail`/`gcal`)은 `omnis.gmail.<email>` 1항목을 공유하고 `<kind>` 세그먼트를 생략하며, Slack은 `omnis.slack.xoxb.<team_id>`(bot)와 `omnis.slack.xoxb.<team_id>.app`(app) 2항목이고 둘 다 account가 `<team_id>`다 — account가 항상 `281932556+jinhologankim@users.noreply.github.com` 고정이라는 단순 규칙은 Slack에는 적용되지 않는다.
- story tier per A7 §4 and every DeepSeek diff reviewed by Sonnet+ — 이 플랜의 스토리(US-A22, A24~A31)는 전부 **Sonnet** 티어(A7 §4 표)이므로 DeepSeek 위임 절차는 이 플랜에 없다.
- commit messages end with `Co-Authored-By: Claude Sonnet <noreply@anthropic.com>`(커널 플랜과 동일한 규칙 — A7-D8 · 인터페이스 계약 §9의 실제 포맷 `Co-Authored-By: Claude <tier> <noreply@anthropic.com>`을 이 플랜의 전 스토리 티어인 Sonnet에 대입한 값, `2026-09-20-phase-a-kernel-and-db.md` Global Constraints와 같은 해석: 계약 §9가 정본이고 작업 지시의 `Claude Fable 5.1`/`<story-id>: <한 줄 요약>` + acceptance-criteria 본문 지시는 커밋 본문 구조만 채택한다 — 작업 지시에 있던 "Claude Fable 5.1"은 A7-D6이 fable을 헤드리스 개발 루프에서 명시적으로 배제한다는 사실과 정면으로 모순되므로 채택하지 않았다. 근거는 open_questions에 기록).

## 패키지 경계 판정 (인터페이스 계약 §1 `@omnis/ui` = "React만" 조항의 적용)

인터페이스 계약 §1은 `@omnis/ui`의 의존을 "React만"으로 고정한다. 그러나 A5 §5.2~5.3은 `ToolCallBadge`가 Lucide 아이콘을, `CommandPalette`가 `cmdk`를, `DraftCard`/`ApprovalSheet`가 shadcn(Radix 기반, `class-variance-authority`/`clsx`/`tailwind-merge` 필요)을 쓴다고 명시한다. 이 플랜은 다음과 같이 판정한다: "React만"은 **`@omnis/*` 내부 패키지 의존 금지**(특히 `@omnis/protocol`의 zod 스키마·`ai`·`@rocicorp/zero` 같은 네트워크/비즈니스 로직 라이브러리)를 뜻하고, A7 §1의 "네트워크 호출도 비즈니스 로직도 없다"는 원칙과 같은 것을 가리킨다 — 렌더링 전용 서드파티(Lucide, cmdk, Radix, cva, clsx, tailwind-merge)는 대상이 아니다. 따라서 `packages/ui`의 컴포넌트는 `@omnis/protocol`의 타입을 **import하지 않고**, protocol의 값 집합을 미러링한 로컬 string-literal 유니온을 자체 정의한다(예: `UiChannel`은 `Channel` enum과 같은 10개 리터럴). `apps/desktop`(= `@omnis/protocol`에 의존 가능)은 Zero/HTTP에서 받은 protocol 타입 값을 그대로 넘긴다 — 리터럴 집합이 동일하므로 TS 구조적 타이핑상 변환 함수가 필요 없다.

---

### Task 1: 디자인 토큰 + shadcn/ui 셋업 + Liquid Glass 프리미티브 (US-A24, tier: Sonnet)

**목표(A7 §7)**: 디자인 토큰 + shadcn/ui 셋업(Liquid Glass 프리미티브)
**산출물(A7 §7)**: `packages/ui/src/tokens.ts`, `packages/ui/src/components/*`
**검증 명령(A7 §7)**: `pnpm --filter @omnis/ui test`
**티어**: Sonnet
**읽을 스펙**: A5 §1(전체), §1.5(Liquid Glass 코드 규칙), §9 QA 체크리스트(색/토큰/모션/Glass 항목)
**하지 말 것(YAGNI)**: shadcn CLI(`pnpm dlx shadcn@latest ...`)를 네트워크로 호출하지 않는다 — ralph 루프는 무인이고 CLI는 대화형 프롬프트를 띄운다(A7 §3 "ralph 루프는 무인"). `components.json` + `Button`은 손으로 shadcn의 표준 산출물을 그대로 옮겨 적는다(shadcn은 애초에 "복사해서 네 코드로 만드는" 배포 방식). 9개 커스텀 컴포넌트(`InboxRow` 등)는 여기서 만들지 않는다 — 각자 필요한 화면 태스크(A26~A30)가 만든다.

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vitest.config.ts`, `packages/ui/src/tokens.css`, `packages/ui/src/tokens.ts`, `packages/ui/src/lib/cn.ts`, `packages/ui/src/components/glass-surface.tsx`, `packages/ui/src/components/button.tsx`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/tokens.test.ts`, `packages/ui/test/glass-surface.test.tsx`, `packages/ui/test/button.test.tsx`

**Interfaces:**
- Consumes: 없음(리프 패키지 — React, 서드파티 UI 라이브러리만).
- Produces: `TYPE_SCALE`, `SPACE`, `RADIUS`, `DURATION`, `EASE_SPRING`, `WEIGHT`(모두 `packages/ui/src/tokens.ts`), `GlassSurface`, `GlassSlot`, `OpaqueSurface`(`packages/ui/src/components/glass-surface.tsx`), `cn`(`packages/ui/src/lib/cn.ts`), `Button`(`packages/ui/src/components/button.tsx`) — 이후 모든 태스크가 이 심볼들을 import한다.

**Steps:**

1. [ ] 패키지 스캐폴드 생성.
   ```json
   // packages/ui/package.json
   {
     "name": "@omnis/ui",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "main": "./src/index.ts",
     "types": "./src/index.ts",
     "exports": {
       ".": "./src/index.ts",
       "./tokens.css": "./src/tokens.css",
       "./*": "./src/*.ts",
       "./components/*": "./src/components/*.tsx"
     },
     "scripts": { "test": "vitest run", "typecheck": "tsc --build" },
     "dependencies": {
       "class-variance-authority": "^0.7.0",
       "clsx": "^2.1.1",
       "tailwind-merge": "^2.5.0",
       "lucide-react": "^0.445.0",
       "cmdk": "^1.0.0"
     },
     "peerDependencies": { "react": "^18.3.0" },
     "devDependencies": {
       "react": "^18.3.0",
       "react-dom": "^18.3.0",
       "@testing-library/react": "^16.0.0",
       "@testing-library/jest-dom": "^6.5.0",
       "jsdom": "^25.0.0",
       "vitest": "2.1.9",
       "typescript": "5.6.3"
     }
   }
   ```
   버전은 인터페이스 계약 §2 FIXED 핀 그대로 고정한다(`vitest 2.1.9` · `typescript 5.6.3`, 캐럿 없음) — 다른 플랜이 쓴 `^2.1.8`/`5.0.1`/`^5.7.2` 등은 전부 이 값으로 수렴한다(계약 리뷰 M1).
   ```ts
   // packages/ui/vitest.config.ts
   import { defineConfig } from "vitest/config";
   export default defineConfig({
     test: { environment: "jsdom", setupFiles: ["./test/setup.ts"] },
   });
   ```
   ```ts
   // packages/ui/test/setup.ts
   import "@testing-library/jest-dom/vitest";
   ```
   ```json
   // packages/ui/tsconfig.json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "jsx": "react-jsx", "outDir": "dist", "rootDir": "src" },
     "include": ["src"]
   }
   ```

2. [ ] 토큰 테스트를 먼저 쓴다(실패 상태).
   ```ts
   // packages/ui/test/tokens.test.ts
   import { describe, it, expect } from "vitest";
   import { TYPE_SCALE, SPACE, RADIUS, DURATION, EASE_SPRING, WEIGHT } from "../src/tokens";

   describe("A5 §1 design tokens", () => {
     it("type scale has exactly the 6 A5-D2 steps", () => {
       expect(Object.keys(TYPE_SCALE)).toEqual(["xs", "sm", "base", "lg", "xl", "2xl"]);
       expect(TYPE_SCALE.base).toEqual({ size: "14px", leading: "20px" });
     });
     it("spacing ladder matches A5 §1.3 exactly", () => {
       expect(SPACE).toEqual({ 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 16: "96px" });
     });
     it("radius has the 4 A5-D3 steps", () => {
       expect(RADIUS).toEqual({ sm: "6px", md: "10px", lg: "16px", full: "999px" });
     });
     it("motion has 3 durations + one spring easing (A5-D4)", () => {
       expect(DURATION).toEqual({ fast: "100ms", base: "160ms", slow: "400ms" });
       expect(EASE_SPRING).toBe("cubic-bezier(0.2, 0, 0, 1)");
     });
     it("weight caps at semibold — no 700+ bold (A5 §9 체크리스트)", () => {
       expect(WEIGHT).toEqual({ regular: 400, medium: 510, semibold: 590 });
     });
   });
   ```

3. [ ] 테스트 실행 → 모듈이 없어 실패하는지 확인.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `Cannot find module '../src/tokens'` (또는 동등한 resolve 실패) — `tokens.ts`가 아직 없음.

4. [ ] 토큰을 구현한다(A5 §1.1~§1.4 값 그대로).
   ```ts
   // packages/ui/src/tokens.ts
   export const TYPE_SCALE = {
     xs: { size: "12px", leading: "16px" },
     sm: { size: "13px", leading: "18px" },
     base: { size: "14px", leading: "20px" },
     lg: { size: "16px", leading: "24px" },
     xl: { size: "20px", leading: "26px" },
     "2xl": { size: "26px", leading: "32px" },
   } as const;

   export const SPACE = { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 16: "96px" } as const;
   export const RADIUS = { sm: "6px", md: "10px", lg: "16px", full: "999px" } as const;
   export const DURATION = { fast: "100ms", base: "160ms", slow: "400ms" } as const;
   export const EASE_SPRING = "cubic-bezier(0.2, 0, 0, 1)" as const;
   export const EASE_STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)" as const;
   export const WEIGHT = { regular: 400, medium: 510, semibold: 590 } as const;
   ```
   ```css
   /* packages/ui/src/tokens.css — A5 §1.1~§1.4 그대로 옮김, 컴포넌트가 import 한다 */
   :root {
     --gray-950: oklch(0.14 0.005 260);
     --gray-900: oklch(0.17 0.006 260);
     --gray-850: oklch(0.19 0.006 260);
     --gray-700: oklch(0.32 0.006 260);
     --gray-500: oklch(0.55 0.006 260);
     --gray-300: oklch(0.78 0.004 260);
     --gray-100: oklch(0.94 0.002 260);
     --gray-000: oklch(0.99 0.001 260);
     --accent-500: oklch(0.70 0.15 230);
     --accent-600: oklch(0.62 0.16 230);
     --danger-500: oklch(0.62 0.19 25);
     --warn-500: oklch(0.75 0.15 80);
     --success-500: oklch(0.68 0.14 150);
     --bg-base: var(--gray-950);
     --bg-elevated: var(--gray-850);
     --bg-overlay: color-mix(in oklch, var(--gray-900) 72%, transparent);
     --border-hairline: oklch(1 0 0 / 0.08);
     --border-hairline-strong: oklch(1 0 0 / 0.14);
     --text-primary: var(--gray-100);
     --text-secondary: var(--gray-500);
     --text-tertiary: oklch(0.55 0.006 260 / 0.7);
     --accent: var(--accent-500);
     --accent-fg: oklch(0.14 0 0);
     --shadow-row-selected: 0 4px 16px oklch(0 0 0 / 0.35), 0 1px 2px oklch(0 0 0 / 0.4);
     --font-sans: "Pretendard Variable", "Inter Variable", -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
     --hairline: 1px solid var(--border-hairline);
     --dur-fast: 100ms; --dur-base: 160ms; --dur-slow: 400ms;
     --ease-spring: cubic-bezier(0.2, 0, 0, 1);
   }
   :root[data-theme="light"] {
     --bg-base: var(--gray-000);
     --bg-elevated: oklch(0.97 0.002 260);
     --bg-overlay: color-mix(in oklch, var(--gray-000) 78%, transparent);
     --border-hairline: oklch(0 0 0 / 0.08);
     --border-hairline-strong: oklch(0 0 0 / 0.14);
     --text-primary: oklch(0.20 0.006 260);
     --text-secondary: oklch(0.42 0.006 260);
     --text-tertiary: oklch(0.55 0.006 260 / 0.75);
     --accent: var(--accent-600);
     --accent-fg: oklch(0.99 0 0);
     --shadow-row-selected: 0 4px 16px oklch(0 0 0 / 0.10), 0 1px 2px oklch(0 0 0 / 0.08);
   }
   @media (prefers-reduced-motion: reduce) {
     :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
   }
   .glass-surface {
     background: var(--bg-overlay);
     backdrop-filter: blur(24px) saturate(1.4);
     -webkit-backdrop-filter: blur(24px) saturate(1.4);
     border: var(--hairline);
   }
   .opaque-surface { background: var(--bg-base); }
   ```

5. [ ] 테스트 재실행 → 통과 확인.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `tokens.test.ts` 5개 테스트 PASS.

6. [ ] 커밋.
   ```bash
   git add packages/ui/package.json packages/ui/tsconfig.json packages/ui/vitest.config.ts packages/ui/test/setup.ts packages/ui/test/tokens.test.ts packages/ui/src/tokens.ts packages/ui/src/tokens.css
   git commit -m "$(cat <<'EOF'
   US-A24: design tokens (A5 §1) scaffolded with passing unit tests

   - TYPE_SCALE/SPACE/RADIUS/DURATION/EASE_SPRING/WEIGHT match A5 §1.1~§1.4 verbatim
   - tokens.css carries the OKLCH color layer (dark default + light override) + reduced-motion fallback

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

7. [ ] Liquid Glass 레이어 규칙(A5 §1.5, A5-D5) 테스트를 먼저 쓴다.
   ```tsx
   // packages/ui/test/glass-surface.test.tsx
   import { describe, it, expect } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { GlassSurface, OpaqueSurface } from "../src/components/glass-surface";

   describe("A5-D5 Liquid Glass layer rule", () => {
     it("only accepts the 4 allowed slots (sidebar/toolbar/sheet/palette)", () => {
       render(<GlassSurface slot="sidebar">nav</GlassSurface>);
       const el = screen.getByText("nav");
       expect(el).toHaveClass("glass-surface");
       expect(el).toHaveAttribute("data-glass-slot", "sidebar");
     });
     it("OpaqueSurface always renders the opaque class (lists/body/editor)", () => {
       render(<OpaqueSurface>row</OpaqueSurface>);
       expect(screen.getByText("row")).toHaveClass("opaque-surface");
     });
   });
   ```

8. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `Cannot find module '../src/components/glass-surface'`.

9. [ ] `GlassSurface`/`OpaqueSurface`를 구현한다. `slot`을 리터럴 유니온으로 제한해 "4곳 외 사용 금지"(A5 §1.5)를 **타입 레벨에서** 강제한다 — 다른 문자열을 넘기면 컴파일이 안 된다.
   ```tsx
   // packages/ui/src/components/glass-surface.tsx
   import type { ReactNode } from "react";
   import { cn } from "../lib/cn";

   /** A5 §1.5: 유리는 컨트롤/내비게이션 레이어 4곳에만. 콘텐츠 레이어는 항상 OpaqueSurface. */
   export type GlassSlot = "sidebar" | "toolbar" | "sheet" | "palette";

   export function GlassSurface(props: { slot: GlassSlot; className?: string; children: ReactNode }) {
     return (
       <div className={cn("glass-surface", props.className)} data-glass-slot={props.slot}>
         {props.children}
       </div>
     );
   }

   export function OpaqueSurface(props: { className?: string; children: ReactNode }) {
     return <div className={cn("opaque-surface", props.className)}>{props.children}</div>;
   }
   ```
   ```ts
   // packages/ui/src/lib/cn.ts — shadcn 표준 유틸(clsx + tailwind-merge)
   import { clsx, type ClassValue } from "clsx";
   import { twMerge } from "tailwind-merge";

   export function cn(...inputs: ClassValue[]) {
     return twMerge(clsx(inputs));
   }
   ```

10. [ ] 테스트 재실행 → 통과 확인.
    ```bash
    pnpm --filter @omnis/ui test
    ```
    기대 출력: 7개 테스트(토큰 5 + glass 2) PASS.

11. [ ] 커밋.
    ```bash
    git add packages/ui/src/components/glass-surface.tsx packages/ui/src/lib/cn.ts packages/ui/test/glass-surface.test.tsx
    git commit -m "$(cat <<'EOF'
    US-A24: GlassSurface/OpaqueSurface enforce the A5-D5 layer rule at the type level

    - slot prop is a 4-literal union (sidebar/toolbar/sheet/palette) — no other value compiles
    - cn() is the shared clsx+tailwind-merge helper every later component reuses

    Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
    EOF
    )"
    ```

12. [ ] shadcn `Button` 프리미티브 테스트를 먼저 쓴다(§9 "pill 남용 금지" — 버튼은 sm/md radius만).
    ```tsx
    // packages/ui/test/button.test.tsx
    import { describe, it, expect, vi } from "vitest";
    import { render, screen, fireEvent } from "@testing-library/react";
    import { Button } from "../src/components/button";

    describe("Button (shadcn primitive)", () => {
      it("renders children and fires onClick", () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>승인</Button>);
        fireEvent.click(screen.getByRole("button", { name: "승인" }));
        expect(onClick).toHaveBeenCalledOnce();
      });
      it("default variant is not pill-radius (A5 §9 pill 남용 금지)", () => {
        render(<Button>보내기</Button>);
        expect(screen.getByRole("button")).not.toHaveClass("rounded-full");
      });
    });
    ```

13. [ ] 테스트 실행 → 실패 확인, 이어서 shadcn 표준 패턴 그대로 구현.
    ```bash
    pnpm --filter @omnis/ui test
    ```
    기대 출력: `Cannot find module '../src/components/button'`.
    ```tsx
    // packages/ui/src/components/button.tsx — shadcn/ui 표준 산출물(cva 기반), 手写(네트워크 CLI 없이)
    import { forwardRef, type ButtonHTMLAttributes } from "react";
    import { cva, type VariantProps } from "class-variance-authority";
    import { cn } from "../lib/cn";

    const buttonVariants = cva(
      "inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
      {
        variants: {
          variant: {
            primary: "bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md,10px)] px-3 py-1.5",
            ghost: "bg-transparent text-[var(--text-primary)] rounded-[var(--radius-sm,6px)] px-2 py-1",
          },
        },
        defaultVariants: { variant: "primary" },
      },
    );

    export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

    export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, ...rest }, ref) => (
      <button ref={ref} className={cn(buttonVariants({ variant }), className)} {...rest} />
    ));
    Button.displayName = "Button";
    ```
    ```json
    // packages/ui/components.json — shadcn 설정(문서화 목적, CLI는 호출하지 않음)
    {
      "$schema": "https://ui.shadcn.com/schema.json",
      "style": "default",
      "tsx": true,
      "tailwind": { "config": "tailwind.config.ts", "css": "src/tokens.css", "baseColor": "neutral", "cssVariables": true },
      "aliases": { "components": "src/components", "utils": "src/lib/cn" }
    }
    ```

14. [ ] 테스트 재실행 → 통과 확인.
    ```bash
    pnpm --filter @omnis/ui test
    ```
    기대 출력: 9개 테스트 전부 PASS.

15. [ ] `packages/ui/src/index.ts`에서 재export하고 커밋.
    ```ts
    // packages/ui/src/index.ts
    export * from "./tokens";
    export * from "./components/glass-surface";
    export * from "./components/button";
    ```
    ```bash
    git add packages/ui/src/index.ts packages/ui/src/components/button.tsx packages/ui/components.json packages/ui/test/button.test.tsx
    git commit -m "$(cat <<'EOF'
    US-A24: shadcn Button primitive + package barrel export

    - Button hand-copied from shadcn's standard cva pattern (no network CLI call in the ralph loop)
    - components.json documents the shadcn config without ever invoking `shadcn add`

    Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
    EOF
    )"
    ```

---

### Task 2: Tauri 2 스캐폴드 + window-vibrancy (US-A25, tier: Sonnet)

**목표(A7 §7)**: Tauri 2 스캐폴드(`window-vibrancy` 연동, 빈 셸)
**산출물(A7 §7)**: `apps/desktop/src-tauri/*`
**검증 명령(A7 §7)**: `pnpm tauri:build`
**티어**: Sonnet
**의존**: A24
**읽을 스펙**: A5 §6(Tauri 셸 전체), A5 §1.5 마지막 문단(vibrancy 실패 시 CSS 폴백 feature-detect)
**하지 말 것(YAGNI)**: 메뉴바 트레이·전역 단축키·딥링크(A5 §6의 나머지 항목)는 스토리 목표("빈 셸")를 넘는다 — 이 태스크는 윈도우 생성 + vibrancy 적용/폴백만 만든다. 트레이·딥링크는 이 백로그(A7 §7)에 없으므로 만들지 않는다.

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/vite.config.ts`, `apps/desktop/vitest.config.ts`, `apps/desktop/index.html`, `apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/build.rs`
- Test: `apps/desktop/src-tauri/src/main.rs`(인라인 `#[cfg(test)]` 모듈)

**Interfaces:**
- Consumes: 없음(스캐폴드).
- Produces: `vibrancy_attr(bool) -> &'static str`(Rust, `main.rs`), `data-vibrancy` HTML 속성(런타임에 window가 설정, CSS가 §1.5 `.glass-surface`/네이티브 분기에 씀), 빈 `<App />` 셸.

**Steps:**

1. [ ] `apps/desktop` Vite+React 스캐폴드.
   ```json
   // apps/desktop/package.json
   {
     "name": "@omnis/desktop",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "scripts": {
       "vite:dev": "vite",
       "vite:build": "tsc --build && vite build",
       "tauri": "tauri",
       "test": "vitest run",
       "typecheck": "tsc --build"
     },
     "dependencies": {
       "react": "^18.3.0",
       "react-dom": "^18.3.0",
       "@omnis/ui": "workspace:*",
       "@omnis/kernel": "workspace:*",
       "@tauri-apps/api": "^2.1.0"
     },
     "devDependencies": {
       "@tauri-apps/cli": "^2.1.0",
       "@vitejs/plugin-react": "^4.3.0",
       "vite": "^5.4.0",
       "vitest": "2.1.9",
       "@testing-library/react": "^16.0.0",
       "jsdom": "^25.0.0",
       "typescript": "5.6.3"
     }
   }
   ```
   `@omnis/kernel`은 인터페이스 계약 §1("`apps/desktop`은 `@omnis/kernel`을 통째로 import하지 않고 `@omnis/kernel/zero` 서브패스만 쓴다 — 그래도 `package.json`에 workspace dep은 선언한다")에 따라 여기서 미리 선언한다. 실제 import(`import { zeroSchema } from "@omnis/kernel/zero"`)는 Task 3이 쓴다 — 이 태스크는 `@omnis/kernel`의 어떤 export도 참조하지 않는다.
   ```ts
   // apps/desktop/vite.config.ts
   import { defineConfig } from "vite";
   import react from "@vitejs/plugin-react";
   export default defineConfig({ plugins: [react()], clearScreen: false, server: { port: 5173, strictPort: true } });
   ```
   ```json
   // apps/desktop/tsconfig.json — A7 §2 루트 tsconfig.base.json을 extend(packages/ui와 동일 패턴)
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "jsx": "react-jsx", "outDir": "dist", "rootDir": "src", "types": ["vite/client"] },
     "references": [{ "path": "../../packages/ui" }],
     "include": ["src"]
   }
   ```
   ```ts
   // apps/desktop/vitest.config.ts — jsdom 필수(US-A31 Onboarding 테스트가 @testing-library/react의 render()를 쓴다)
   import { defineConfig } from "vitest/config";
   export default defineConfig({
     test: { environment: "jsdom" },
   });
   ```
   ```html
   <!-- apps/desktop/index.html -->
   <!doctype html>
   <html lang="ko">
     <head><meta charset="UTF-8" /><title>omnis</title></head>
     <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
   </html>
   ```
   ```tsx
   // apps/desktop/src/main.tsx
   import { StrictMode } from "react";
   import { createRoot } from "react-dom/client";
   import "@omnis/ui/tokens.css";
   import { App } from "./App";

   createRoot(document.getElementById("root")!).render(
     <StrictMode><App /></StrictMode>,
   );
   ```
   ```tsx
   // apps/desktop/src/App.tsx — 빈 셸(A25 목표: "빈 셸"). 화면 라우팅은 A26~A31이 채운다.
   export function App() {
     return <main data-testid="app-shell">omnis</main>;
   }
   ```

2. [ ] Tauri 설정(A5 §6: 단일 윈도우, `titleBarStyle: overlay`, 최소 1024×640).
   ```json
   // apps/desktop/src-tauri/tauri.conf.json
   {
     "$schema": "https://schema.tauri.app/config/2",
     "productName": "omnis",
     "version": "0.1.0",
     "identifier": "ai.onwardlab.omnis",
     "build": {
       "beforeDevCommand": "pnpm --filter @omnis/desktop vite:dev",
       "beforeBuildCommand": "pnpm --filter @omnis/desktop vite:build",
       "devUrl": "http://localhost:5173",
       "frontendDist": "../dist"
     },
     "app": {
       "windows": [
         {
           "label": "main",
           "title": "omnis",
           "width": 1280,
           "height": 800,
           "minWidth": 1024,
           "minHeight": 640,
           "titleBarStyle": "Overlay",
           "hiddenTitle": true
         }
       ]
     },
     "bundle": { "active": true, "targets": ["dmg", "app"] }
   }
   ```
   ```rust
   // apps/desktop/src-tauri/build.rs
   fn main() { tauri_build::build() }
   ```

3. [ ] `main.rs`에 vibrancy 적용 로직을 **순수 함수 + 부수효과 함수**로 분리해서 쓴다(순수 함수는 플랫폼 mock 없이 테스트 가능 — ponytail: 플랫폼별 mocking 없이 최소 실제 테스트).
   ```rust
   // apps/desktop/src-tauri/src/main.rs
   #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

   use tauri::Manager;

   /// A5 §1.5: vibrancy가 성공하면 네이티브 유리, 실패하면 CSS `.glass-surface` 폴백으로
   /// 다운그레이드한다는 사실을 `<html data-vibrancy>`로 프론트엔드에 알린다.
   fn vibrancy_attr(applied: bool) -> &'static str {
       if applied { "native" } else { "css-fallback" }
   }

   #[cfg(target_os = "macos")]
   fn apply_glass(window: &tauri::WebviewWindow) -> bool {
       use window_vibrancy::{apply_liquid_glass, apply_vibrancy, NSVisualEffectMaterial};
       // A5 §1.5: apply_liquid_glass(macOS 26 Tahoe) 우선, 실패 시 apply_vibrancy(Sidebar) 폴백.
       apply_liquid_glass(window, None, None).is_ok()
           || apply_vibrancy(window, NSVisualEffectMaterial::Sidebar, None, None).is_ok()
   }

   #[cfg(not(target_os = "macos"))]
   fn apply_glass(_window: &tauri::WebviewWindow) -> bool {
       false
   }

   fn main() {
       tauri::Builder::default()
           .setup(|app| {
               let window = app.get_webview_window("main").expect("main window must exist (tauri.conf.json)");
               let applied = apply_glass(&window);
               let attr = vibrancy_attr(applied);
               window
                   .eval(&format!("document.documentElement.dataset.vibrancy = '{attr}'"))
                   .expect("failed to set data-vibrancy on <html>");
               Ok(())
           })
           .run(tauri::generate_context!())
           .expect("error while running omnis desktop");
   }

   #[cfg(test)]
   mod tests {
       use super::vibrancy_attr;

       #[test]
       fn native_when_glass_applied() {
           assert_eq!(vibrancy_attr(true), "native");
       }

       #[test]
       fn css_fallback_when_glass_not_applied() {
           assert_eq!(vibrancy_attr(false), "css-fallback");
       }
   }
   ```
   ```toml
   # apps/desktop/src-tauri/Cargo.toml
   [package]
   name = "omnis-desktop"
   version = "0.1.0"
   edition = "2021"

   [build-dependencies]
   tauri-build = { version = "2", features = [] }

   [dependencies]
   tauri = { version = "2", features = [] }
   window-vibrancy = "0.5"
   serde = { version = "1", features = ["derive"] }
   serde_json = "1"

   [[bin]]
   name = "omnis-desktop"
   path = "src/main.rs"
   ```

4. [ ] Rust 단위 테스트 실행 → 통과 확인(이게 이 태스크의 "먼저 실패하는 테스트"에 해당 — Rust는 컴파일이 곧 첫 실행이므로, 파일 작성 전에는 `cargo test`가 "no such file" 로 실패한다는 점을 먼저 확인).
   ```bash
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1 | tail -5
   ```
   기대 출력(파일 작성 전): `error: failed to read ... Cargo.toml` 또는 `error[E0433]` 류의 컴파일 실패. 위 3번 스텝의 코드를 쓴 뒤 재실행하면:
   ```bash
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
   ```
   기대 출력: `test tests::native_when_glass_applied ... ok`, `test tests::css_fallback_when_glass_not_applied ... ok`.

5. [ ] 프런트엔드 빌드 + Tauri 빌드 확인.
   ```bash
   pnpm --filter @omnis/desktop vite:build && pnpm tauri:build
   ```
   기대 출력: `apps/desktop/dist/` 생성 후 `apps/desktop/src-tauri/target/release/bundle/macos/omnis.app` 생성(unsigned dev build, A7-D9).

6. [ ] 커밋.
   ```bash
   git add apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/vite.config.ts apps/desktop/vitest.config.ts apps/desktop/index.html apps/desktop/src/main.tsx apps/desktop/src/App.tsx apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/tauri.conf.json apps/desktop/src-tauri/src/main.rs apps/desktop/src-tauri/build.rs
   git commit -m "$(cat <<'EOF'
   US-A25: Tauri 2 scaffold with window-vibrancy + CSS fallback feature-detect

   - apply_liquid_glass → apply_vibrancy(Sidebar) → data-vibrancy=css-fallback, per A5 §1.5
   - vibrancy_attr() is a pure function covered by 2 cargo tests, no platform mocking needed
   - unsigned dev build only (A7-D9); code signing is Phase D

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 3: Zero 클라이언트 초기화 + 읽기 전용 쿼리 왕복 (US-A22, tier: Sonnet)

**목표(A7 §7)**: Zero 클라이언트 초기화(`apps/desktop`에서 읽기 전용 쿼리 1개 왕복 확인)
**산출물(A7 §7)**: `apps/desktop/src/zero-client.ts`
**검증 명령(A7 §7)**: `pnpm --filter @omnis/desktop test`
**티어**: Sonnet
**의존**: A21(kernel의 `zeroSchema`, 다른 플랜 `2026-09-20-phase-a-sync-and-agents.md` 소유), A25
**읽을 스펙**: 인터페이스 계약 §7(Zero), A3 §7(복제 범위)
**전제 조건**: 이 태스크의 테스트는 로컬에 `zero-cache`(A21이 `apps/hub`에 배선)와 Postgres가 떠 있어야 통과한다 — worktrunk 의존 그래프상 A21이 먼저 merge되므로 이 태스크를 시작할 때는 이미 사용 가능하다고 가정한다(A21 없이 이 태스크만 단독 실행하면 5번 스텝은 연결 오류로 실패하는 게 정상이며, 이는 "테스트를 스킵"하는 게 아니라 선행 스토리 부재를 그대로 드러내는 것이다).

**Files:**
- Create: `apps/desktop/src/zero-client.ts`
- Test: `apps/desktop/test/zero-client.test.ts`

**Interfaces:**
- Consumes: `zeroSchema`(from `@omnis/kernel/zero`, A21이 만든 심볼), `@rocicorp/zero`의 `Zero` 클래스.
- Produces: `initZero(opts?: { server?: string; userID?: string }): Zero<typeof zeroSchema>`(계약 §7 시그니처 그대로) — Task 4~6이 이 함수를 import한다.

**Steps:**

1. [ ] `@rocicorp/zero` 의존성 추가. 인터페이스 계약 §2/§7이 exact 핀을 못박는다(caret 금지, A6 §5) — `--save-exact` 없이 `pnpm add @rocicorp/zero`만 돌리면 `^1.9.0`이 박혀 sync 플랜의 `1.9.0` exact와 어긋난다(계약 리뷰 M10).
   ```bash
   pnpm add @rocicorp/zero@1.9.0 --filter @omnis/desktop --save-exact
   ```

2. [ ] 왕복 테스트를 먼저 쓴다.
   ```ts
   // apps/desktop/test/zero-client.test.ts
   import { describe, it, expect, afterAll } from "vitest";
   import { initZero } from "../src/zero-client";

   describe("US-A22 Zero read-only round trip", () => {
     const zero = initZero({ userID: "logan-test" });

     it("resolves a query against threads without throwing (A3 §7 복제 대상)", async () => {
       const rows = await zero.query.threads.limit(1).run();
       expect(Array.isArray(rows)).toBe(true);
     }, 10_000);

     afterAll(async () => {
       await zero.close();
     });
   });
   ```

3. [ ] 테스트 실행 → 모듈 부재로 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/zero-client'`.

4. [ ] `initZero`를 계약 §7 시그니처 그대로 구현한다.
   ```ts
   // apps/desktop/src/zero-client.ts
   import { Zero } from "@rocicorp/zero";
   import { zeroSchema } from "@omnis/kernel/zero";

   export function initZero(opts?: { server?: string; userID?: string }) {
     return new Zero({
       server: opts?.server ?? import.meta.env.OMNIS_ZERO_URL ?? "http://127.0.0.1:4848",
       userID: opts?.userID ?? "logan",
       schema: zeroSchema,
     });
   }
   ```

5. [ ] 로컬 `zero-cache` + Postgres가 뜬 상태에서 재실행 → 통과 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `US-A22 Zero read-only round trip > resolves a query against threads without throwing` PASS.

6. [ ] 커밋.
   ```bash
   git add apps/desktop/package.json apps/desktop/src/zero-client.ts apps/desktop/test/zero-client.test.ts
   git commit -m "$(cat <<'EOF'
   US-A22: Zero client init + one read-only round-trip test

   - initZero() matches the interfaces contract §7 signature exactly (server/userID/schema)
   - round-trip test queries `threads` (A3 §7 replicated table) against a live zero-cache

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 4: Inbox 화면 (US-A26, tier: Sonnet)

**목표(A7 §7)**: Inbox 화면(필터 pill, react-virtuoso 리스트)
**산출물(A7 §7)**: `apps/desktop/src/screens/Inbox.tsx`
**검증 명령(A7 §7)**: `pnpm --filter @omnis/desktop test`
**티어**: Sonnet
**의존**: A22, A24
**읽을 스펙**: A5 §3.1(Inbox 전체), §2.1(필터 pill 5개), §9 체크리스트(채널 정체성=아이콘, 라벨 칩 규칙)
**하지 말 것(YAGNI)**: bulk action bar, 멀티 셀렉트(`x`), skeleton/오류/오프라인 상태 배너는 스토리 목표("필터 pill, virtuoso 리스트")를 넘는다 — 여기서는 만들지 않는다. 라벨 칩의 "클릭 시 팝오버로 전체 목록"도 만들지 않는다(팝오버 없이 `+N` 텍스트만).

**Files:**
- Create: `packages/ui/src/components/inbox-row.tsx`, `apps/desktop/src/screens/Inbox.tsx`
- Test: `packages/ui/test/inbox-row.test.tsx`, `apps/desktop/test/inbox-screen.test.tsx`

**Interfaces:**
- Consumes: `GlassSurface`, `cn`(A24), `initZero`(A22).
- Produces: `InboxRow`, `InboxRowProps`, `LabelChip`, `UiChannel`(`packages/ui/src/components/inbox-row.tsx`) — Task 5가 `UiItemStatus` 패턴을 재사용, `filterInboxItems`(`apps/desktop/src/screens/Inbox.tsx`, 순수 함수).

**Steps:**

1. [ ] `InboxRow` 프레젠테이션 컴포넌트 테스트를 먼저 쓴다(패키지 경계 판정에 따라 `@omnis/protocol`을 import하지 않고 로컬 유니온을 쓴다).
   ```tsx
   // packages/ui/test/inbox-row.test.tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { InboxRow } from "../src/components/inbox-row";

   const baseProps = {
     id: "item-1", title: "Sora Kim", preview: "회의 자료 확인 부탁드립니다", channel: "slack" as const,
     timestamp: "09:14", status: "received" as const, unread: true, selected: false, hasPendingApproval: false,
     labels: [{ kind: "scope" as const, name: "work", color: null }, { kind: "topic" as const, name: "davich", color: "#4f8" }],
     onSelect: vi.fn(),
   };

   describe("InboxRow (A5 §3.1)", () => {
     it("renders title, preview, and calls onSelect with id on click", () => {
       render(<InboxRow {...baseProps} />);
       expect(screen.getByText("Sora Kim")).toBeInTheDocument();
       fireEvent.click(screen.getByRole("option"));
       expect(baseProps.onSelect).toHaveBeenCalledWith("item-1");
     });
     it("shows at most 2 chips + N more, scope label first (A5 §3.1 우선순위)", () => {
       render(<InboxRow {...baseProps} labels={[
         { kind: "topic", name: "a", color: null }, { kind: "scope", name: "work", color: null },
         { kind: "person", name: "b", color: null },
       ]} />);
       expect(screen.getByLabelText("scope 라벨: work")).toBeInTheDocument();
       expect(screen.getByLabelText("라벨 1개 더 보기")).toHaveTextContent("+1");
     });
     it("prefixes draft items with '초안: ' (A5 §3.1)", () => {
       render(<InboxRow {...baseProps} status="draft" preview="네 확인했습니다" />);
       expect(screen.getByText("초안: 네 확인했습니다")).toBeInTheDocument();
     });
   });
   ```

2. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `Cannot find module '../src/components/inbox-row'`.

3. [ ] `InboxRow`를 구현한다.
   ```tsx
   // packages/ui/src/components/inbox-row.tsx
   import { cn } from "../lib/cn";

   /** protocol Channel enum의 리터럴을 미러링(패키지 경계 판정 참고 — @omnis/protocol import 안 함). */
   export type UiChannel = "slack" | "gmail" | "gcal" | "outlook" | "telegram" | "whatsapp" | "kakaotalk" | "linkedin" | "agent" | "system";
   export type UiItemStatus = "received" | "read" | "draft" | "approved" | "sent" | "failed" | "archived";

   export interface LabelChip { kind: "scope" | "topic" | "priority" | "person"; name: string; color: string | null; }

   export interface InboxRowProps {
     id: string; title: string; preview: string; channel: UiChannel; timestamp: string;
     status: UiItemStatus; unread: boolean; selected: boolean; hasPendingApproval: boolean;
     labels: LabelChip[]; onSelect: (id: string) => void;
   }

   const CHANNEL_LABEL: Record<UiChannel, string> = {
     slack: "Slack", gmail: "Gmail", gcal: "Google Calendar", outlook: "Outlook", telegram: "Telegram",
     whatsapp: "WhatsApp", kakaotalk: "KakaoTalk", linkedin: "LinkedIn", agent: "Agent", system: "System",
   };

   function pickChips(labels: LabelChip[]): { shown: LabelChip[]; more: number } {
     const scope = labels.find((l) => l.kind === "scope");
     const rest = labels.filter((l) => l !== scope);
     const shown = [scope, rest[0]].filter((l): l is LabelChip => Boolean(l)).slice(0, 2);
     return { shown, more: labels.length - shown.length };
   }

   export function InboxRow(props: InboxRowProps) {
     const { shown, more } = pickChips(props.labels);
     const previewText = props.status === "draft" ? `초안: ${props.preview}` : props.preview;
     return (
       <div
         role="option"
         aria-selected={props.selected}
         className={cn("inbox-row", props.selected && "inbox-row--selected")}
         onClick={() => props.onSelect(props.id)}
       >
         <div className="inbox-row__meta">
           <span className="inbox-row__title">{props.title}</span>
           <span className="inbox-row__timestamp">{props.timestamp}</span>
         </div>
         <div className="inbox-row__preview" data-draft={props.status === "draft"}>{previewText}</div>
         <div className="inbox-row__chips">
           {shown.map((chip) => (
             <span key={chip.kind} className="inbox-row__chip" aria-label={`${chip.kind} 라벨: ${chip.name}`}>{chip.name}</span>
           ))}
           {more > 0 && <span className="inbox-row__chip-more" aria-label={`라벨 ${more}개 더 보기`}>+{more}</span>}
         </div>
         <div className="inbox-row__channel" aria-label={`${CHANNEL_LABEL[props.channel]} 메시지`}>
           {props.unread && <span className="inbox-row__unread" aria-label="안읽음" />}
           {props.hasPendingApproval && <span className="inbox-row__approval-dot" />}
         </div>
       </div>
     );
   }
   ```

4. [ ] 테스트 재실행 → 통과 확인, 커밋.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `InboxRow (A5 §3.1)` 3개 테스트 PASS.
   ```bash
   git add packages/ui/src/components/inbox-row.tsx packages/ui/test/inbox-row.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A26: InboxRow component (A5 §3.1) — chips, draft prefix, channel a11y label

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] Inbox 화면의 필터 로직을 순수 함수로 먼저 테스트한다(react-virtuoso/Zero를 직접 마운트하지 않고 로직만 검증 — ponytail: 네트워크 의존 없는 순수 함수가 가장 싸게 테스트된다).
   ```ts
   // apps/desktop/test/inbox-screen.test.tsx
   import { describe, it, expect } from "vitest";
   import { filterInboxItems, type InboxFilter, type InboxQueryItem } from "../src/screens/Inbox";

   const items: InboxQueryItem[] = [
     { id: "1", scope: "work", hasPendingApproval: false, authorKind: "person" },
     { id: "2", scope: "personal", hasPendingApproval: true, authorKind: "person" },
     { id: "3", scope: "work", hasPendingApproval: false, authorKind: "agent" },
   ];

   describe("filterInboxItems (A5 §2.1 필터 pill 5개, 서로 배타)", () => {
     const cases: [InboxFilter, string[]][] = [
       ["all", ["1", "2", "3"]],
       ["work", ["1", "3"]],
       ["personal", ["2"]],
       ["agents", ["3"]],
       ["needs-approval", ["2"]],
     ];
     it.each(cases)("filter=%s → ids %j", (filter, expectedIds) => {
       expect(filterInboxItems(items, filter).map((i) => i.id)).toEqual(expectedIds);
     });
   });
   ```

6. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/screens/Inbox'`.

7. [ ] Inbox 화면을 구현한다(`filterInboxItems`는 export된 순수 함수, 컴포넌트는 그걸 소비).
   ```bash
   pnpm add react-virtuoso --filter @omnis/desktop
   ```
   ```tsx
   // apps/desktop/src/screens/Inbox.tsx
   import { useMemo, useState } from "react";
   import { useQuery } from "@rocicorp/zero/react";
   import { Virtuoso } from "react-virtuoso";
   import { GlassSurface } from "@omnis/ui";
   import { InboxRow, type LabelChip, type UiChannel, type UiItemStatus } from "@omnis/ui/components/inbox-row";
   import { initZero } from "../zero-client";

   export const FILTERS = ["all", "work", "personal", "agents", "needs-approval"] as const;
   export type InboxFilter = (typeof FILTERS)[number];

   export interface InboxQueryItem {
     id: string; scope: "work" | "personal" | "unknown"; hasPendingApproval: boolean; authorKind: "person" | "agent" | "system";
   }

   /** A5 §2.1: 5개 필터 pill은 서로 배타(라디오)이며 items.status/labels.kind='scope' 조합의 뷰다. */
   export function filterInboxItems<T extends InboxQueryItem>(items: T[], filter: InboxFilter): T[] {
     switch (filter) {
       case "all": return items;
       case "work": return items.filter((i) => i.scope === "work");
       case "personal": return items.filter((i) => i.scope === "personal");
       case "agents": return items.filter((i) => i.authorKind === "agent");
       case "needs-approval": return items.filter((i) => i.hasPendingApproval);
     }
   }

   const zero = initZero();

   export function Inbox() {
     const [filter, setFilter] = useState<InboxFilter>("all");
     const [selectedId, setSelectedId] = useState<string | null>(null);
     const [items] = useQuery(
       zero.query.items.where("status", "!=", "archived").orderBy("sentAt", "desc")
         .related("thread").related("author").related("labels").limit(50),
     );

     const filtered = useMemo(() => filterInboxItems(items as unknown as InboxQueryItem[], filter), [items, filter]);

     return (
       <div className="inbox-screen">
         <GlassSurface slot="sidebar" className="inbox-screen__filters">
           <div role="radiogroup" aria-label="Inbox 필터">
             {FILTERS.map((f) => (
               <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>{f}</button>
             ))}
           </div>
         </GlassSurface>
         <Virtuoso
           role="listbox"
           style={{ height: "100%" }}
           data={filtered as unknown as (InboxQueryItem & {
             title: string; preview: string; channel: UiChannel; timestamp: string; status: UiItemStatus;
             unread: boolean; labels: LabelChip[];
           })[]}
           itemContent={(_, item) => (
             <InboxRow
               id={item.id} title={item.title} preview={item.preview} channel={item.channel}
               timestamp={item.timestamp} status={item.status} unread={item.unread} selected={item.id === selectedId}
               hasPendingApproval={item.hasPendingApproval} labels={item.labels} onSelect={setSelectedId}
             />
           )}
         />
       </div>
     );
   }
   ```
   참고(코드로 보이지 않는 설명 아님 — Zero 쿼리 빌더의 정확한 문법은 A5 §3 공통 표기 원칙대로 "어떤 테이블·필드가 화면에 소비되는지"만 확정이고, `.where`/`.related`의 정확한 연산자는 A21이 `zeroSchema`를 merge한 뒤 타입 오류가 나면 그 타입에 맞춰 조정한다.

8. [ ] 테스트 재실행 → 통과 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `filterInboxItems` 5개 케이스 PASS.

9. [ ] 커밋.
   ```bash
   git add apps/desktop/package.json apps/desktop/src/screens/Inbox.tsx apps/desktop/test/inbox-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A26: Inbox screen — 5 exclusive filter pills + react-virtuoso list

   - filterInboxItems() is a pure, fully-tested function; the screen only wires Zero data to it
   - sidebar filter pills render inside GlassSurface(slot="sidebar") per A5-D5

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 5: Thread 화면 (US-A27, tier: Sonnet)

**목표(A7 §7)**: Thread 화면(items 렌더링, status 뱃지)
**산출물(A7 §7)**: `apps/desktop/src/screens/Thread.tsx`
**검증 명령(A7 §7)**: `pnpm --filter @omnis/desktop test`
**티어**: Sonnet
**의존**: A22, A24
**읽을 스펙**: A5 §3.2(Thread 전체 — 단 DraftCard 3버튼과 status 뱃지만), A3 §6 `items.status` enum
**하지 말 것(YAGNI)**: Tiptap Composer(직접 타이핑 답장)는 스토리 목표("items 렌더링, status 뱃지")에 없다 — 만들지 않는다. 자동 보관 되살리기 배너, 오프라인 큐잉도 만들지 않는다.

**Files:**
- Create: `packages/ui/src/types.ts`, `packages/ui/src/components/status-badge.tsx`, `packages/ui/src/components/draft-card.tsx`, `apps/desktop/src/screens/Thread.tsx`
- Modify: `packages/ui/src/components/inbox-row.tsx`(로컬 타입 선언 삭제, `../types`에서 재export), `packages/ui/src/index.ts`(types/status-badge/draft-card 배럴 export 추가)
- Test: `packages/ui/test/status-badge.test.tsx`, `packages/ui/test/draft-card.test.tsx`, `apps/desktop/test/thread-screen.test.tsx`

**Interfaces:**
- Consumes: `UiItemStatus`(Task 4가 만든 타입, 재export해서 공유), `OpaqueSurface`(A24).
- Produces: `StatusBadge`, `DraftCard`, `DraftCardProps`(`packages/ui`) — Task 6(AgentSession)이 `StatusBadge` 패턴을 재사용.

**Steps:**

1. [ ] `UiItemStatus`를 `inbox-row.tsx`에서 공유 모듈로 옮긴다(중복 정의 금지).
   ```ts
   // packages/ui/src/types.ts
   export type UiItemStatus = "received" | "read" | "draft" | "approved" | "sent" | "failed" | "archived";
   export type UiChannel = "slack" | "gmail" | "gcal" | "outlook" | "telegram" | "whatsapp" | "kakaotalk" | "linkedin" | "agent" | "system";
   ```
   ```ts
   // packages/ui/src/components/inbox-row.tsx — 상단 import 교체(재export 유지 — Task 4의 apps/desktop/src/screens/Inbox.tsx가
   // 이미 "@omnis/ui/components/inbox-row"에서 UiChannel/UiItemStatus를 import하고 있으므로, 여기서 재export하지 않으면
   // 그 import가 깨진다. import type만 쓰면 재export가 안 되므로 반드시 export type ... from 구문을 쓴다)
   export type { UiChannel, UiItemStatus } from "../types";
   // 기존 로컬 타입 선언 2줄 삭제
   ```

2. [ ] `StatusBadge` 테스트를 먼저 쓴다.
   ```tsx
   // packages/ui/test/status-badge.test.tsx
   import { describe, it, expect } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { StatusBadge } from "../src/components/status-badge";

   describe("StatusBadge (A3 items.status enum, 7값)", () => {
     it.each([
       ["received", "받음"], ["read", "읽음"], ["draft", "초안"], ["approved", "승인됨"],
       ["sent", "전송됨"], ["failed", "실패"], ["archived", "보관됨"],
     ] as const)("%s → %s", (status, label) => {
       render(<StatusBadge status={status} />);
       expect(screen.getByText(label)).toHaveAttribute("data-status", status);
     });
   });
   ```

3. [ ] 테스트 실행 → 실패, 구현, 재실행 → 통과.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력(구현 전): `Cannot find module '../src/components/status-badge'`.
   ```tsx
   // packages/ui/src/components/status-badge.tsx
   import type { UiItemStatus } from "../types";

   const STATUS_LABEL: Record<UiItemStatus, string> = {
     received: "받음", read: "읽음", draft: "초안", approved: "승인됨", sent: "전송됨", failed: "실패", archived: "보관됨",
   };

   export function StatusBadge({ status }: { status: UiItemStatus }) {
     return <span className="status-badge" data-status={status}>{STATUS_LABEL[status]}</span>;
   }
   ```
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `StatusBadge` 7개 케이스 PASS.

4. [ ] `DraftCard` 테스트를 먼저 쓴다(A5-D9: 항상 전문 노출, 버튼 3개).
   ```tsx
   // packages/ui/test/draft-card.test.tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { DraftCard } from "../src/components/draft-card";

   describe("DraftCard (A5-D9)", () => {
     it("shows full body (no truncation) and rationale", () => {
       render(<DraftCard body="네 확인했습니다, 내일 오전에 코멘트 드릴게요" rationale="PROJECTS.md #davich" onEditAndSend={vi.fn()} onDiscard={vi.fn()} onRegenerate={vi.fn()} />);
       expect(screen.getByText("네 확인했습니다, 내일 오전에 코멘트 드릴게요")).toBeInTheDocument();
       expect(screen.getByText(/PROJECTS.md #davich/)).toBeInTheDocument();
     });
     it("wires the 3 buttons to their callbacks (§8 마이크로카피 한국어)", () => {
       const onEditAndSend = vi.fn(); const onDiscard = vi.fn(); const onRegenerate = vi.fn();
       render(<DraftCard body="b" rationale="r" onEditAndSend={onEditAndSend} onDiscard={onDiscard} onRegenerate={onRegenerate} />);
       fireEvent.click(screen.getByText("수정 후 보내기")); expect(onEditAndSend).toHaveBeenCalledOnce();
       fireEvent.click(screen.getByText("버리기")); expect(onDiscard).toHaveBeenCalledOnce();
       fireEvent.click(screen.getByText("다시 생성")); expect(onRegenerate).toHaveBeenCalledOnce();
     });
   });
   ```

5. [ ] 테스트 실행 → 실패, 구현, 재실행 → 통과.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력(구현 전): `Cannot find module '../src/components/draft-card'`.
   ```tsx
   // packages/ui/src/components/draft-card.tsx
   import { OpaqueSurface } from "./glass-surface";
   import { Button } from "./button";

   export interface DraftCardProps {
     body: string; rationale: string;
     onEditAndSend: () => void; onDiscard: () => void; onRegenerate: () => void;
   }

   /** A5-D9: draft는 항상 전문 노출(요약 금지). */
   export function DraftCard(props: DraftCardProps) {
     return (
       <OpaqueSurface className="draft-card">
         <p className="draft-card__rationale">omnis 초안 · 근거: {props.rationale}</p>
         <p className="draft-card__body">{props.body}</p>
         <div className="draft-card__actions">
           <Button onClick={props.onEditAndSend}>수정 후 보내기</Button>
           <Button variant="ghost" onClick={props.onDiscard}>버리기</Button>
           <Button variant="ghost" onClick={props.onRegenerate}>다시 생성</Button>
         </div>
       </OpaqueSurface>
     );
   }
   ```
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `DraftCard (A5-D9)` 2개 테스트 PASS.

6. [ ] `packages/ui/src/index.ts`에 새 배럴 export를 추가하고(이 태스크의 Thread 화면과 이후 AgentSession/ApprovalCard 태스크가 `@omnis/ui`에서 바로 import해야 한다) 커밋(패키지 경계 정리 + 두 컴포넌트).
   ```ts
   // packages/ui/src/index.ts — 기존 3줄(tokens/glass-surface/button) 뒤에 추가
   export * from "./types";
   export * from "./components/status-badge";
   export * from "./components/draft-card";
   ```
   ```bash
   git add packages/ui/src/types.ts packages/ui/src/index.ts packages/ui/src/components/inbox-row.tsx packages/ui/src/components/status-badge.tsx packages/ui/src/components/draft-card.tsx packages/ui/test/status-badge.test.tsx packages/ui/test/draft-card.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A27: StatusBadge + DraftCard components, shared UiItemStatus/UiChannel moved to types.ts, barrel export updated

   - inbox-row.tsx re-exports UiChannel/UiItemStatus from ../types so Task 4's Inbox.tsx import keeps resolving

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

7. [ ] Thread 화면 로직(어떤 item이 DraftCard로 렌더되는지)을 순수 함수로 먼저 테스트한다.
   ```ts
   // apps/desktop/test/thread-screen.test.tsx
   import { describe, it, expect } from "vitest";
   import { findDraftItem, type ThreadQueryItem } from "../src/screens/Thread";

   const items: ThreadQueryItem[] = [
     { id: "1", status: "read", body: "확인했습니다" },
     { id: "2", status: "draft", body: "이 초안이 최신" },
   ];

   describe("findDraftItem (A5 §3.2 DraftCard는 status='draft'인 Item이 있을 때만)", () => {
     it("returns the draft item when present", () => { expect(findDraftItem(items)?.id).toBe("2"); });
     it("returns undefined when no draft exists", () => {
       expect(findDraftItem(items.filter((i) => i.status !== "draft"))).toBeUndefined();
     });
   });
   ```

8. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/screens/Thread'`.

9. [ ] Thread 화면을 구현한다.
   ```tsx
   // apps/desktop/src/screens/Thread.tsx
   import { useQuery } from "@rocicorp/zero/react";
   import { StatusBadge, DraftCard } from "@omnis/ui";
   import type { UiItemStatus } from "@omnis/ui";
   import { initZero } from "../zero-client";

   export interface ThreadQueryItem { id: string; status: UiItemStatus; body: string; }

   /** A5 §3.2: DraftCard는 status='draft'인 Item이 있을 때만 나타난다. */
   export function findDraftItem<T extends ThreadQueryItem>(items: T[]): T | undefined {
     return items.find((i) => i.status === "draft");
   }

   const zero = initZero();

   export function Thread({ threadId }: { threadId: string }) {
     const [items] = useQuery(
       zero.query.items.where("thread_id", "=", threadId).orderBy("sentAt", "asc").related("author"),
     );
     const typedItems = items as unknown as ThreadQueryItem[];
     const draft = findDraftItem(typedItems);

     return (
       <div className="thread-screen">
         {typedItems.map((item) => (
           <div key={item.id} className="thread-screen__item">
             <StatusBadge status={item.status} />
             <p>{item.body}</p>
           </div>
         ))}
         {draft && (
           <DraftCard
             body={draft.body}
             rationale="메모리·과거 스레드"
             onEditAndSend={() => { /* Composer wiring은 스토리 범위 밖(YAGNI) */ }}
             onDiscard={() => zero.mutate.items.update({ id: draft.id, status: "archived" })}
             onRegenerate={() => { /* propose_draft 재요청은 packages/agents 몫, 이 화면은 트리거만 노출 */ }}
           />
         )}
       </div>
     );
   }
   ```

10. [ ] 테스트 재실행 → 통과, 커밋.
    ```bash
    pnpm --filter @omnis/desktop test
    ```
    기대 출력: `findDraftItem` 2개 테스트 PASS.
    ```bash
    git add apps/desktop/src/screens/Thread.tsx apps/desktop/test/thread-screen.test.tsx
    git commit -m "$(cat <<'EOF'
    US-A27: Thread screen renders items with StatusBadge + DraftCard when a draft exists

    - findDraftItem() is the pure, tested selection logic
    - Composer (direct typed reply) intentionally out of scope for this story (YAGNI)

    Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
    EOF
    )"
    ```

---

### Task 6: Agent Session 화면 (US-A28, tier: Sonnet)

**목표(A7 §7)**: Agent Session 화면(Thread 뷰 + tool_call 배지, `TOOL_LABELS` 패턴 차용 — `22`)
**산출물(A7 §7)**: `apps/desktop/src/screens/AgentSession.tsx`
**검증 명령(A7 §7)**: `pnpm --filter @omnis/desktop test`
**티어**: Sonnet
**의존**: A20(다른 플랜의 브리지 mock, 이 태스크는 그 산출물을 직접 소비하지 않고 Item 스트림만 읽으므로 A20 자체 심볼 의존은 없음 — 순서 의존만), A27
**읽을 스펙**: A5 §3.3(전체), §9 체크리스트("에이전트 제안 배지 vs 시스템 실행 로그" 구분)
**하지 말 것(YAGNI)**: "Read session" 인라인 패널, Hermes "읽기 전용" 배지(Phase B 전용)는 이 태스크에서 만들지 않는다.

**Files:**
- Create: `packages/ui/src/components/tool-call-badge.tsx`, `apps/desktop/src/screens/AgentSession.tsx`
- Modify: `packages/ui/src/index.ts`(tool-call-badge 배럴 export 추가)
- Test: `packages/ui/test/tool-call-badge.test.tsx`, `apps/desktop/test/agent-session-screen.test.tsx`

**Interfaces:**
- Consumes: `StatusBadge`(재사용 안 함 — agent_turn/tool_call은 status가 아니라 kind로 구분), `OpaqueSurface`(A24), `UiItemStatus`/`UiChannel`(A27 `types.ts`).
- Produces: `TOOL_LABELS`, `ToolCallBadge`, `ToolCallState`(`packages/ui/src/components/tool-call-badge.tsx`) — agentic-inbox 이식 패턴(A5-D11), 다른 플랜이 재사용 가능.

**Steps:**

1. [ ] `lucide-react` 의존은 이미 Task 1에서 추가됨을 확인하고, `TOOL_LABELS`/`ToolCallBadge` 테스트를 먼저 쓴다.
   ```tsx
   // packages/ui/test/tool-call-badge.test.tsx
   import { describe, it, expect } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { ToolCallBadge, TOOL_LABELS } from "../src/components/tool-call-badge";

   describe("TOOL_LABELS / ToolCallBadge (A5-D11)", () => {
     it("covers all 8 master §11 tool names", () => {
       expect(Object.keys(TOOL_LABELS).sort()).toEqual(
         ["propose_delegation", "propose_draft", "propose_route", "propose_task", "read", "read_calendar", "read_session", "search_memory"].sort(),
       );
     });
     it("loading state is aria-busy, done state shows the result summary", () => {
       const { rerender } = render(<ToolCallBadge tool="read" state="loading" />);
       expect(screen.getByText("읽는 중").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
       rerender(<ToolCallBadge tool="read" state="done" resultSummary="3개 파일" />);
       expect(screen.getByText(/3개 파일/)).toBeInTheDocument();
     });
     it("throws for an unmapped tool name (fail fast, not a silent blank badge)", () => {
       // @ts-expect-error deliberately invalid tool for the failure-path assertion
       expect(() => render(<ToolCallBadge tool="delete" state="done" />)).toThrow(/unknown tool/);
     });
   });
   ```

2. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `Cannot find module '../src/components/tool-call-badge'`.

3. [ ] 구현(A5 §3.3 코드 그대로, master §11의 tool 이름 8개).
   ```tsx
   // packages/ui/src/components/tool-call-badge.tsx
   import { Eye, Search, Calendar, MessagesSquare, PenLine, ListChecks, Share2, Route, type LucideIcon } from "lucide-react";

   export const TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
     read: { label: "읽는 중", icon: Eye },
     search_memory: { label: "메모리 검색 중", icon: Search },
     read_calendar: { label: "캘린더 확인 중", icon: Calendar },
     read_session: { label: "다른 세션 확인 중", icon: MessagesSquare },
     propose_draft: { label: "답장 초안 작성 중", icon: PenLine },
     propose_task: { label: "할 일 추출 중", icon: ListChecks },
     propose_delegation: { label: "위임 제안 중", icon: Share2 },
     propose_route: { label: "노트 라우팅 제안 중", icon: Route },
   };

   export type ToolCallState = "loading" | "done" | "error";

   export interface ToolCallBadgeProps { tool: string; state: ToolCallState; resultSummary?: string; }

   /** `send`/`delete`/`delegate`/`calendar_write`는 master §11 원칙상 tool palette에 없다 —
    *  이 배지에 들어오면 버그이므로 조용히 빈 배지를 그리지 않고 즉시 throw한다. */
   export function ToolCallBadge({ tool, state, resultSummary }: ToolCallBadgeProps) {
     const meta = TOOL_LABELS[tool];
     if (!meta) throw new Error(`ToolCallBadge: unknown tool "${tool}" — not in master §11 palette`);
     const Icon = meta.icon;
     return (
       <div className="tool-call-badge" aria-busy={state === "loading"} data-state={state}>
         <Icon size={16} strokeWidth={2} />
         <span>{meta.label}</span>
         {state === "done" && <span aria-live="polite">✓ {resultSummary}</span>}
         {state === "error" && <span aria-live="polite">⚠ 재시도</span>}
       </div>
     );
   }
   ```

4. [ ] 테스트 재실행 → 통과, `packages/ui/src/index.ts`에 재export 추가 후 커밋(이 태스크의 AgentSession 화면이 `@omnis/ui`에서 바로 import해야 한다).
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `TOOL_LABELS / ToolCallBadge` 3개 테스트 PASS.
   ```ts
   // packages/ui/src/index.ts — 기존 export 뒤에 추가
   export * from "./components/tool-call-badge";
   ```
   ```bash
   git add packages/ui/src/components/tool-call-badge.tsx packages/ui/src/index.ts packages/ui/test/tool-call-badge.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A28: TOOL_LABELS + ToolCallBadge, agentic-inbox pattern ported per A5-D11

   - covers exactly the 8 tool names master §11 allows in the autonomous palette
   - unmapped tool name throws instead of rendering a silent blank badge
   - barrel export updated so apps/desktop can import from "@omnis/ui"

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] Agent Session 화면의 "에이전트 제안 배지 vs 시스템 실행 로그" 구분(§9 체크리스트) 로직을 순수 함수로 먼저 테스트한다.
   ```ts
   // apps/desktop/test/agent-session-screen.test.tsx
   import { describe, it, expect } from "vitest";
   import { isSystemExecutionLog, type SessionQueryItem } from "../src/screens/AgentSession";

   describe("isSystemExecutionLog (A5 §3.3 §9: 제안 vs 실행 로그 시각 구분)", () => {
     it("kind='system' is an execution log line, not a tool badge", () => {
       expect(isSystemExecutionLog({ id: "1", kind: "system", tool: null, body: "✓ Codex에게 위임됨" } as SessionQueryItem)).toBe(true);
     });
     it("kind='tool_call' is not (it renders as ToolCallBadge)", () => {
       expect(isSystemExecutionLog({ id: "2", kind: "tool_call", tool: "read", body: "" } as SessionQueryItem)).toBe(false);
     });
   });
   ```

6. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/screens/AgentSession'`.

7. [ ] 구현.
   ```tsx
   // apps/desktop/src/screens/AgentSession.tsx
   import { useQuery } from "@rocicorp/zero/react";
   import { ToolCallBadge, type ToolCallState } from "@omnis/ui";
   import { initZero } from "../zero-client";

   export interface SessionQueryItem { id: string; kind: "agent_turn" | "tool_call" | "system"; tool: string | null; body: string; }

   /** master §11: send/delete/delegate/calendar_write는 에이전트가 직접 호출 못 한다 —
    *  승인 후 실행 결과는 kind='system' 로그 한 줄로만 나타난다(§9 체크리스트). */
   export function isSystemExecutionLog(item: SessionQueryItem): boolean {
     return item.kind === "system";
   }

   const zero = initZero();

   export function AgentSession({ sessionThreadId }: { sessionThreadId: string }) {
     const [items] = useQuery(
       zero.query.items.where("thread_id", "=", sessionThreadId)
         .where("kind", "IN", ["agent_turn", "tool_call", "system"]).orderBy("sentAt", "asc"),
     );
     const typedItems = items as unknown as SessionQueryItem[];

     return (
       <div className="agent-session-screen">
         {typedItems.map((item) => {
           if (isSystemExecutionLog(item)) {
             return <p key={item.id} className="agent-session-screen__system-log">{item.body}</p>;
           }
           if (item.kind === "tool_call" && item.tool) {
             const state: ToolCallState = item.body ? "done" : "loading";
             return <ToolCallBadge key={item.id} tool={item.tool} state={state} resultSummary={item.body} />;
           }
           return <p key={item.id} className="agent-session-screen__turn">{item.body}</p>;
         })}
       </div>
     );
   }
   ```

8. [ ] 테스트 재실행 → 통과, 커밋.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `isSystemExecutionLog` 2개 테스트 PASS.
   ```bash
   git add apps/desktop/src/screens/AgentSession.tsx apps/desktop/test/agent-session-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A28: Agent Session screen — ToolCallBadge for tool_call items, plain log line for system items

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 7: ⌘K 커맨드 팔레트 (US-A29, tier: Sonnet)

**목표(A7 §7)**: ⌘K 커맨드 팔레트(cmdk, 에이전트 액션 포함)
**산출물(A7 §7)**: `apps/desktop/src/components/CommandPalette.tsx`
**검증 명령(A7 §7)**: `pnpm --filter @omnis/desktop test`
**티어**: Sonnet
**의존**: A24
**읽을 스펙**: A5 §2.3(액션 카테고리), §2.4(키맵)
**하지 말 것(YAGNI)**: §2.5의 통합 검색 모드(Phase B, `GET /search`)는 만들지 않는다. "Delegate to Codex" 같은 승인이 필요한 에이전트 액션은 Phase A 백로그에 hub 쪽 propose 엔드포인트가 없으므로(인터페이스 계약 §5 HTTP 표면에 없음) **등록만 하고 `perform`은 호출부(App)가 주입**한다 — 팔레트 자체는 백엔드를 모른다.

**Files:**
- Create: `packages/ui/src/components/command-palette.tsx`, `apps/desktop/src/hooks/use-keymap.ts`
- Test: `packages/ui/test/command-palette.test.tsx`, `apps/desktop/test/use-keymap.test.ts`

**Interfaces:**
- Consumes: `GlassSurface`(slot="palette", A24).
- Produces: `CommandPalette`, `PaletteAction`, `groupBy`(`packages/ui`), `useKeymap`(`apps/desktop/src/hooks/use-keymap.ts`) — Task 9(승인 카드)가 `PaletteAction` 패턴을 그대로 재사용할 수 있다.

**Steps:**

1. [ ] `cmdk` 의존은 Task 1에서 이미 추가됨(패키지 경계 판정 참고). `groupBy` + `CommandPalette` 렌더 테스트를 먼저 쓴다.
   ```tsx
   // packages/ui/test/command-palette.test.tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { CommandPalette, groupBy, type PaletteAction } from "../src/components/command-palette";

   describe("groupBy", () => {
     it("groups items by the given key function", () => {
       const grouped = groupBy([{ g: "a", v: 1 }, { g: "b", v: 2 }, { g: "a", v: 3 }], (x) => x.g);
       expect(grouped).toEqual({ a: [{ g: "a", v: 1 }, { g: "a", v: 3 }], b: [{ g: "b", v: 2 }] });
     });
   });

   describe("CommandPalette (A5 §2.3)", () => {
     it("renders grouped actions and calls perform() + closes on select", () => {
       const perform = vi.fn();
       const onOpenChange = vi.fn();
       const actions: PaletteAction[] = [{ id: "go-inbox", name: "Go to Inbox", group: "이동", perform }];
       render(<CommandPalette open onOpenChange={onOpenChange} actions={actions} />);
       fireEvent.click(screen.getByText("Go to Inbox"));
       expect(perform).toHaveBeenCalledOnce();
       expect(onOpenChange).toHaveBeenCalledWith(false);
     });
   });
   ```

2. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `Cannot find module '../src/components/command-palette'`.

3. [ ] 구현(kbar 패턴 `id+name+shortcut+perform`, A5 §2.3).
   ```tsx
   // packages/ui/src/components/command-palette.tsx
   import { Command } from "cmdk";
   import { GlassSurface } from "./glass-surface";

   export interface PaletteAction { id: string; name: string; shortcut?: string; group: string; perform: () => void; }

   export function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
     return items.reduce<Record<string, T[]>>((acc, item) => {
       const k = key(item);
       (acc[k] ??= []).push(item);
       return acc;
     }, {});
   }

   export interface CommandPaletteProps { open: boolean; onOpenChange: (open: boolean) => void; actions: PaletteAction[]; }

   export function CommandPalette({ open, onOpenChange, actions }: CommandPaletteProps) {
     const groups = groupBy(actions, (a) => a.group);
     return (
       <Command.Dialog open={open} onOpenChange={onOpenChange} label="omnis command palette">
         <GlassSurface slot="palette">
           <Command.Input placeholder="검색 또는 명령…" />
           <Command.List>
             <Command.Empty>결과가 없어요</Command.Empty>
             {Object.entries(groups).map(([group, items]) => (
               <Command.Group key={group} heading={group}>
                 {items.map((action) => (
                   <Command.Item key={action.id} onSelect={() => { action.perform(); onOpenChange(false); }}>
                     <span>{action.name}</span>
                     {action.shortcut && <kbd>{action.shortcut}</kbd>}
                   </Command.Item>
                 ))}
               </Command.Group>
             ))}
           </Command.List>
         </GlassSurface>
       </Command.Dialog>
     );
   }
   ```

4. [ ] 테스트 재실행 → 통과, 커밋.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `groupBy` 1개 + `CommandPalette` 1개 PASS.
   ```bash
   git add packages/ui/src/components/command-palette.tsx packages/ui/test/command-palette.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A29: CommandPalette (cmdk) with kbar-style {id,name,shortcut,perform} actions

   - grouped by PaletteAction.group, renders inside GlassSurface(slot="palette")

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] 키맵(A5 §2.4)을 `useKeymap` 훅으로 먼저 테스트한다 — go-to 접두(`g` then letter, 300ms 창)의 타이밍 로직이 핵심이므로 순수 리듀서로 뽑아 테스트한다.
   ```ts
   // apps/desktop/test/use-keymap.test.ts
   import { describe, it, expect, vi } from "vitest";
   import { reduceKeySequence } from "../src/hooks/use-keymap";

   describe("reduceKeySequence (A5 §2.4 go-to 접두 g+letter, 300ms 창)", () => {
     it("g then i within 300ms resolves to 'go-inbox'", () => {
       const r1 = reduceKeySequence(null, "g", 1000);
       expect(r1.pending).toBe("g");
       const r2 = reduceKeySequence(r1, "i", 1100);
       expect(r2.resolved).toBe("go-inbox");
     });
     it("g then i after 300ms does not resolve (window expired)", () => {
       const r1 = reduceKeySequence(null, "g", 1000);
       const r2 = reduceKeySequence(r1, "i", 1500);
       expect(r2.resolved).toBeUndefined();
     });
     it("a single non-prefix key resolves directly (e.g. 'e' = archive)", () => {
       const r = reduceKeySequence(null, "e", 1000);
       expect(r.resolved).toBe("archive");
     });
   });
   ```

6. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/hooks/use-keymap'`.

7. [ ] 구현(A5 §2.4 표를 그대로 데이터로 옮긴다).
   ```ts
   // apps/desktop/src/hooks/use-keymap.ts
   import { useEffect, useState } from "react";

   const DIRECT_KEYS: Record<string, string> = {
     j: "next-row", k: "prev-row", e: "archive", r: "reply", a: "approve", s: "snooze",
     d: "delegate", l: "label", t: "add-task", n: "focus-note", x: "toggle-select",
   };
   const GOTO_KEYS: Record<string, string> = { i: "go-inbox", t: "go-today", k: "go-tasks", n: "go-network", o: "go-notes", d: "go-digest", s: "go-settings" };
   const GOTO_WINDOW_MS = 300;

   export interface KeySeqState { pending: "g" | null; resolved?: string; at: number; }

   /** A5 §2.4: 'g' 다음 300ms 안에 letter가 오면 go-to 액션으로 resolve. 순수 리듀서라 타이머 없이 테스트 가능. */
   export function reduceKeySequence(prev: KeySeqState | null, key: string, atMs: number): KeySeqState {
     if (prev?.pending === "g" && atMs - prev.at <= GOTO_WINDOW_MS) {
       const action = GOTO_KEYS[key];
       return { pending: null, resolved: action, at: atMs };
     }
     if (key === "g") return { pending: "g", at: atMs };
     const direct = DIRECT_KEYS[key];
     return { pending: null, resolved: direct, at: atMs };
   }

   export function useKeymap(onResolve: (action: string) => void) {
     const [state, setState] = useState<KeySeqState | null>(null);
     useEffect(() => {
       function handler(e: KeyboardEvent) {
         if (e.metaKey || e.ctrlKey || e.altKey) return;
         const next = reduceKeySequence(state, e.key, Date.now());
         setState(next.resolved ? null : next);
         if (next.resolved) onResolve(next.resolved);
       }
       window.addEventListener("keydown", handler);
       return () => window.removeEventListener("keydown", handler);
     }, [state, onResolve]);
   }
   ```

8. [ ] 테스트 재실행 → 통과, 커밋.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `reduceKeySequence` 3개 테스트 PASS.
   ```bash
   git add apps/desktop/src/hooks/use-keymap.ts apps/desktop/test/use-keymap.test.ts
   git commit -m "$(cat <<'EOF'
   US-A29: useKeymap hook — A5 §2.4 full keymap incl. 300ms go-to prefix, pure-reducer tested

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 8: 승인 카드 UI (US-A30, tier: Sonnet)

**목표(A7 §7)**: 승인 카드 UI(`pending_approvals` 렌더링, 4-way accept/edit/respond/ignore — `22`)
**산출물(A7 §7)**: `apps/desktop/src/components/ApprovalCard.tsx`
**검증 명령(A7 §7)**: `pnpm --filter @omnis/desktop test`
**티어**: Sonnet
**의존**: A07(kernel 승인 게이트 HTTP 표면, 다른 플랜 소유), A22
**읽을 스펙**: A5-D10, §3.3 인라인 ApprovalSheet, 인터페이스 계약 §5(`POST /approvals/:id/decide`), 계약 §9(환경변수 목록의 `OMNIS_HUB_HTTP_URL`)
**하지 말 것(YAGNI)**: 모바일 바텀시트 변형(A5 §4.3)은 이 태스크 범위 밖(macOS만).

**Files:**
- Create: `packages/ui/src/components/approval-card.tsx`, `apps/desktop/src/api/approvals.ts`, `apps/desktop/src/components/ApprovalCard.tsx`
- Modify: `packages/ui/src/index.ts`(approval-card 배럴 export 추가)
- Test: `packages/ui/test/approval-card.test.tsx`, `apps/desktop/test/approvals-api.test.ts`

**Interfaces:**
- Consumes: `OpaqueSurface`, `Button`(A24).
- Produces: `ApprovalCardView`, `ApprovalCardViewProps`(`packages/ui`, 순수 프레젠테이션), `decideApproval`(`apps/desktop/src/api/approvals.ts`, 계약 §5 `POST /approvals/:id/decide` 호출), `ApprovalCard`(`apps/desktop/src/components/ApprovalCard.tsx`, 위 둘을 결합).

**Steps:**

1. [ ] 패키지 경계 판정에 따라 `@omnis/protocol`의 `HumanInterrupt`를 import하지 않고 로컬 인터페이스로 미러링한 뷰 컴포넌트 테스트를 먼저 쓴다.
   ```tsx
   // packages/ui/test/approval-card.test.tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { ApprovalCardView, type ApprovalCardInterrupt } from "../src/components/approval-card";

   const interrupt: ApprovalCardInterrupt = {
     action: "send", description: "Gmail 답장: David Park에게",
     config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
   };

   describe("ApprovalCardView (A5-D10, HumanInterrupt 4-way)", () => {
     it("renders only the buttons the config allows", () => {
       render(<ApprovalCardView interrupt={interrupt} onDecide={vi.fn()} />);
       expect(screen.getByText("승인")).toBeInTheDocument();
       expect(screen.getByText("수정 후 승인")).toBeInTheDocument();
       expect(screen.queryByText("응답")).not.toBeInTheDocument();
       expect(screen.getByText("무시")).toBeInTheDocument();
     });
     it("accept calls onDecide('accept')", () => {
       const onDecide = vi.fn();
       render(<ApprovalCardView interrupt={interrupt} onDecide={onDecide} />);
       fireEvent.click(screen.getByText("승인"));
       expect(onDecide).toHaveBeenCalledWith("accept", undefined);
     });
   });
   ```

2. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `Cannot find module '../src/components/approval-card'`.

3. [ ] 구현.
   ```tsx
   // packages/ui/src/components/approval-card.tsx
   import { OpaqueSurface } from "./glass-surface";
   import { Button } from "./button";

   export type ApprovalCardAction = "send" | "delete" | "calendar_write" | "delegate" | "self_model_edit" | "memory_write";
   export type ApprovalCardDecision = "accept" | "edit" | "respond" | "ignore";

   /** @omnis/protocol의 HumanInterrupt를 미러링(패키지 경계 판정 — protocol import 안 함). */
   export interface ApprovalCardInterrupt {
     action: ApprovalCardAction; description: string; args?: Record<string, unknown>;
     config: { allow_accept: boolean; allow_edit: boolean; allow_respond: boolean; allow_ignore: boolean };
   }

   const ACTION_LABEL: Record<ApprovalCardAction, string> = {
     send: "전송", delete: "삭제", calendar_write: "캘린더 기록", delegate: "위임",
     self_model_edit: "프로필 수정", memory_write: "메모리 기록",
   };

   export interface ApprovalCardViewProps {
     interrupt: ApprovalCardInterrupt;
     onDecide: (decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) => void;
   }

   export function ApprovalCardView({ interrupt, onDecide }: ApprovalCardViewProps) {
     const { config } = interrupt;
     return (
       <OpaqueSurface className="approval-card">
         <p className="approval-card__title">{ACTION_LABEL[interrupt.action]} 승인이 필요해요</p>
         <p className="approval-card__description">{interrupt.description}</p>
         <div className="approval-card__actions">
           {config.allow_accept && <Button onClick={() => onDecide("accept", undefined)}>승인</Button>}
           {config.allow_edit && <Button variant="ghost" onClick={() => onDecide("edit", interrupt.args)}>수정 후 승인</Button>}
           {config.allow_respond && <Button variant="ghost" onClick={() => onDecide("respond", undefined)}>응답</Button>}
           {config.allow_ignore && <Button variant="ghost" onClick={() => onDecide("ignore", undefined)}>무시</Button>}
         </div>
       </OpaqueSurface>
     );
   }
   ```

4. [ ] 테스트 재실행 → 통과, `packages/ui/src/index.ts`에 재export 추가 후 커밋(9번 스텝의 `apps/desktop/src/components/ApprovalCard.tsx`가 `@omnis/ui`에서 바로 import해야 한다).
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `ApprovalCardView` 2개 테스트 PASS.
   ```ts
   // packages/ui/src/index.ts — 기존 export 뒤에 추가
   export * from "./components/approval-card";
   ```
   ```bash
   git add packages/ui/src/components/approval-card.tsx packages/ui/src/index.ts packages/ui/test/approval-card.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A30: ApprovalCardView — 4-way accept/edit/respond/ignore gated by HumanInterrupt.config

   - barrel export updated so apps/desktop can import from "@omnis/ui"

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] hub 승인 API 클라이언트(`POST /approvals/:id/decide`, 인터페이스 계약 §5) 테스트를 먼저 쓴다.
   ```ts
   // apps/desktop/test/approvals-api.test.ts
   import { describe, it, expect, vi, afterEach } from "vitest";
   import { decideApproval } from "../src/api/approvals";

   describe("decideApproval (계약 §5 POST /approvals/:id/decide)", () => {
     afterEach(() => vi.unstubAllGlobals());

     it("POSTs { decision, decided_args } and returns the decided state", async () => {
       const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "ap-1", state: "decided" }), { status: 200 }));
       vi.stubGlobal("fetch", fetchMock);
       const result = await decideApproval("ap-1", "accept");
       expect(fetchMock).toHaveBeenCalledWith(
         "http://127.0.0.1:8787/approvals/ap-1/decide",
         expect.objectContaining({ method: "POST", body: JSON.stringify({ decision: "accept", decided_args: undefined }) }),
       );
       expect(result).toEqual({ id: "ap-1", state: "decided" });
     });

     it("throws on a non-2xx response", async () => {
       vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 409 })));
       await expect(decideApproval("ap-1", "ignore")).rejects.toThrow(/409/);
     });
   });
   ```

6. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/api/approvals'`.

7. [ ] 구현.
   ```ts
   // apps/desktop/src/api/approvals.ts
   // OMNIS_HUB_HTTP_URL: 인터페이스 계약 §9 환경변수 목록에 등재된 변수(계약 리뷰 M11) — 빌드 시 미설정이면 로컬 기본값으로 fallback.
   const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

   export async function decideApproval(
     id: string,
     decision: "accept" | "edit" | "respond" | "ignore",
     decidedArgs?: Record<string, unknown>,
   ): Promise<{ id: string; state: "decided" }> {
     const res = await fetch(`${HUB_HTTP_URL}/approvals/${id}/decide`, {
       method: "POST",
       headers: { "content-type": "application/json" },
       body: JSON.stringify({ decision, decided_args: decidedArgs }),
     });
     if (!res.ok) throw new Error(`approval decide failed: HTTP ${res.status}`);
     return res.json();
   }
   ```

8. [ ] 테스트 재실행 → 통과 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `decideApproval` 2개 테스트 PASS.

9. [ ] 뷰 + API를 결합하는 얇은 `ApprovalCard`를 쓴다(테스트는 뷰/API 각각이 이미 커버하므로 여기서는 결합 스모크 1개만).
   ```tsx
   // apps/desktop/src/components/ApprovalCard.tsx
   import { ApprovalCardView, type ApprovalCardInterrupt, type ApprovalCardDecision } from "@omnis/ui";
   import { decideApproval } from "../api/approvals";

   export function ApprovalCard({ id, interrupt }: { id: string; interrupt: ApprovalCardInterrupt }) {
     function handleDecide(decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) {
       void decideApproval(id, decision, decidedArgs);
     }
     return <ApprovalCardView interrupt={interrupt} onDecide={handleDecide} />;
   }
   ```
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: 기존 스위트 전부 PASS(회귀 없음 확인).

10. [ ] 커밋.
    ```bash
    git add apps/desktop/src/api/approvals.ts apps/desktop/src/components/ApprovalCard.tsx apps/desktop/test/approvals-api.test.ts
    git commit -m "$(cat <<'EOF'
    US-A30: decideApproval() HTTP client + ApprovalCard wiring to ApprovalCardView

    - no client-side approval creation or direct pending_approvals.state=executed writes,
      only the decide endpoint the kernel exposes (A3 §7 Zero permission rule, global constraint)

    Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
    EOF
    )"
    ```

---

### Task 9: 온보딩 플로우 (US-A31, tier: Sonnet)

**목표(A7 §7)**: 온보딩 플로우(Slack/Gmail/Calendar OAuth 연결 마법사, Keychain 저장)
**산출물(A7 §7)**: `apps/desktop/src/screens/Onboarding.tsx`
**검증 명령(A7 §7)**: `pnpm --filter @omnis/desktop test`
**티어**: Sonnet
**의존**: A12~A14(어댑터, 다른 플랜 — 이 태스크는 어댑터의 `connect(auth)`를 직접 호출하지 않고 OAuth 토큰을 Keychain에 저장하는 UI만 만든다), A24
**읽을 스펙**: A5 §7.1(온보딩 5단계), A6 §9 및 인터페이스 계약 §9(Keychain 명명 규칙 `omnis.<channel>.<kind>.<external_id>` — 단 Google 계열은 `<kind>` 세그먼트를 생략해 `omnis.gmail.<email>` 1항목을 공유하고, Slack은 `omnis.slack.xoxb.<team_id>`(bot)와 `omnis.slack.xoxb.<team_id>.app`(app) 2항목을 쓰며 두 항목 모두 account 필드가 `<team_id>`다 — account가 전 채널 공통으로 `281932556+jinhologankim@users.noreply.github.com`이라는 이전 가정은 Slack에 대해 계약 리뷰 M7로 정정됨)
**중요(이 태스크에서 바로잡은 것)**: 작업 지시는 "Tauri keychain plugin named in A5/A6"라고 했지만 A5·A6 어디에도 서드파티 Tauri keychain 플러그인 이름이 없다(grep 확인 — A6 §9는 시크릿 조회를 `security find-generic-password` **CLI 호출**로만 규정한다). 그래서 이 태스크는 새 미검증 크레이트를 추가하지 않고, A6가 이미 확정한 `/usr/bin/security` CLI 패턴을 그대로 Tauri command로 감싼다(ponytail: 이미 스펙이 정한 패턴 재사용, 새 의존 추가 안 함).
**하지 말 것(YAGNI)**: 실제 OAuth PKCE 플로우(브라우저 리다이렉트, 토큰 교환)는 채널 어댑터(US-A12~14)의 `connect(auth)`가 이미 담당하는 영역이자 이 스토리의 산출물 파일 목록(`Onboarding.tsx` 1개)을 넘는다 — 이 화면은 `OAuthClient` 인터페이스를 주입받아 "연결됨/연결 중/실패" 상태만 그리고, 받은 시크릿을 Keychain에 넣는다.

**Files:**
- Create: `apps/desktop/src/api/keychain.ts`, `apps/desktop/src/screens/Onboarding.tsx`
- Modify: `apps/desktop/src-tauri/src/main.rs`(커맨드 등록)
- Test: `apps/desktop/src-tauri/src/main.rs`(인라인 `#[cfg(test)]` 추가), `apps/desktop/test/onboarding-screen.test.tsx`

**Interfaces:**
- Consumes: 없음(신규 최상위 화면).
- Produces: `keychain_set`(Rust Tauri command), `storeChannelSecret`(`apps/desktop/src/api/keychain.ts`), `Onboarding`, `OAuthClient`, `OnboardingChannel`, `ChannelSecretEntry`(`apps/desktop/src/screens/Onboarding.tsx`).

**Steps:**

1. [ ] Rust `security` CLI 래퍼를 **인자 생성 순수 함수 + 부수효과 커맨드**로 분리해서 먼저 테스트한다(Task 2와 같은 패턴).
   ```rust
   // apps/desktop/src-tauri/src/main.rs — 기존 파일 끝부분에 추가
   fn add_generic_password_args(service: &str, account: &str) -> Vec<String> {
       vec![
           "add-generic-password".into(), "-U".into(),
           "-s".into(), service.into(),
           "-a".into(), account.into(),
           "-w".into(),
       ]
   }

   #[tauri::command]
   fn keychain_set(service: String, account: String, secret: String) -> Result<(), String> {
       use std::process::Command;
       let mut args = add_generic_password_args(&service, &account);
       args.push(secret);
       let status = Command::new("/usr/bin/security").args(&args).status().map_err(|e| e.to_string())?;
       if status.success() { Ok(()) } else { Err(format!("security exited with status {status}")) }
   }
   ```
   `main()`의 `tauri::Builder::default()` 체인에 `.invoke_handler(tauri::generate_handler![keychain_set])`을 추가한다(Task 2가 쓴 체인은 `.setup(...)` 뒤에 바로 `.run(...)`이었으므로, 그 사이에 삽입):
   ```rust
   // apps/desktop/src-tauri/src/main.rs — main() 안의 기존 체인 수정
   fn main() {
       tauri::Builder::default()
           .invoke_handler(tauri::generate_handler![keychain_set])
           .setup(|app| {
               // Task 2가 이미 쓴 vibrancy 설정 코드 그대로, 변경 없음
               let window = app.get_webview_window("main").expect("main window must exist (tauri.conf.json)");
               let applied = apply_glass(&window);
               let attr = vibrancy_attr(applied);
               window
                   .eval(&format!("document.documentElement.dataset.vibrancy = '{attr}'"))
                   .expect("failed to set data-vibrancy on <html>");
               Ok(())
           })
           .run(tauri::generate_context!())
           .expect("error while running omnis desktop");
   }
   ```
   ```rust
   #[cfg(test)]
   mod keychain_tests {
       use super::add_generic_password_args;
       #[test]
       fn builds_the_expected_security_cli_flags() {
           // 계약 §9: Slack bot 토큰의 실제 서비스명은 omnis.slack.xoxb.<team_id>, account는 <team_id>(계약 리뷰 M7).
           let args = add_generic_password_args("omnis.slack.xoxb.T123", "T123");
           assert_eq!(args, vec!["add-generic-password", "-U", "-s", "omnis.slack.xoxb.T123", "-a", "T123", "-w"]);
       }
   }
   ```

2. [ ] 테스트 실행 → 통과 확인(이 스텝 전에는 함수가 없어 컴파일 실패했을 것 — 위 코드를 쓴 뒤 최초 실행이 곧 PASS 확인이다).
   ```bash
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml keychain_tests
   ```
   기대 출력: `test keychain_tests::builds_the_expected_security_cli_flags ... ok`.

3. [ ] 커밋.
   ```bash
   git add apps/desktop/src-tauri/src/main.rs
   git commit -m "$(cat <<'EOF'
   US-A31: keychain_set Tauri command wraps A6 §9's `security` CLI pattern

   - no third-party Tauri keychain plugin added — A5/A6 name none, A6 §9 already mandates
     the `/usr/bin/security find-generic-password`/`add-generic-password` CLI pattern
   - add_generic_password_args() is pure and covered by a cargo test

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

4. [ ] 프런트 `storeChannelSecret` 테스트를 먼저 쓴다(`@tauri-apps/api/core`의 `invoke`를 목). **계약 리뷰 M7 정정**: account 필드는 채널마다 고정값이 아니다 — Google 계열(Gmail/GCal)은 Logan 개인 식별자를 쓰지만 Slack은 `<team_id>`를 쓴다(계약 §9). 그래서 `storeChannelSecret`은 account를 하드코딩하지 않고 호출자가 넘긴다.
   ```ts
   // apps/desktop/test/onboarding-screen.test.tsx (상단부 — storeChannelSecret 테스트)
   import { describe, it, expect, vi, beforeEach } from "vitest";
   import { storeChannelSecret } from "../src/api/keychain";

   vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

   describe("storeChannelSecret (계약 §9 Keychain 명명 규칙)", () => {
     beforeEach(() => vi.clearAllMocks());
     it("invokes keychain_set with the Google identifier for a gmail service", async () => {
       const { invoke } = await import("@tauri-apps/api/core");
       await storeChannelSecret("omnis.gmail.281932556+jinhologankim@users.noreply.github.com", "281932556+jinhologankim@users.noreply.github.com", "secret-token");
       expect(invoke).toHaveBeenCalledWith("keychain_set", {
         service: "omnis.gmail.281932556+jinhologankim@users.noreply.github.com", account: "281932556+jinhologankim@users.noreply.github.com", secret: "secret-token",
       });
     });
     it("invokes keychain_set with the team_id as account for a slack bot-token service (계약 §9 Slack 예외)", async () => {
       const { invoke } = await import("@tauri-apps/api/core");
       await storeChannelSecret("omnis.slack.xoxb.T123", "T123", "xoxb-secret");
       expect(invoke).toHaveBeenCalledWith("keychain_set", {
         service: "omnis.slack.xoxb.T123", account: "T123", secret: "xoxb-secret",
       });
     });
   });
   ```

5. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/api/keychain'`.

6. [ ] 구현.
   ```ts
   // apps/desktop/src/api/keychain.ts
   import { invoke } from "@tauri-apps/api/core";

   /** 계약 §9: account 필드는 채널별로 다르다(Google 계열 = Logan 식별자, Slack = team_id) — 호출자가 결정해 넘긴다. */
   export async function storeChannelSecret(keychainService: string, account: string, secret: string): Promise<void> {
     await invoke("keychain_set", { service: keychainService, account, secret });
   }
   ```

7. [ ] 테스트 재실행 → 통과 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `storeChannelSecret` 2개 테스트 PASS(gmail 계정 고정값 + slack team_id 케이스).

8. [ ] `Onboarding` 화면 테스트를 이어서 쓴다(A5 §7.1: Phase A 필수 3채널, 전부 연결돼야 "계속" 활성화). **계약 리뷰 M7 정정**: `OAuthClient.connect`는 채널당 keychain 항목 1개가 아니라 **항목 배열**을 반환한다 — Slack만 2항목(bot + app 토큰, 둘 다 account=team_id)이고 나머지는 1항목이라서, 어댑터(T4 `omnis.slack.xoxb.<team_id>`+`....app`)와 온보딩이 쓰는 이름이 정확히 맞아떨어져야 connect가 성공한다.
   ```tsx
   // apps/desktop/test/onboarding-screen.test.tsx (하단부 — Onboarding 컴포넌트 테스트, 같은 파일에 이어 씀)
   import { render, screen, fireEvent, waitFor } from "@testing-library/react";
   import { Onboarding, type OAuthClient, type ChannelSecretEntry } from "../src/screens/Onboarding";

   const mockConnect: OAuthClient["connect"] = vi.fn(async (channel) =>
     channel === "slack"
       ? [
           { keychainService: "omnis.slack.xoxb.T123", account: "T123", secret: "xoxb-bot-token" },
           { keychainService: "omnis.slack.xoxb.T123.app", account: "T123", secret: "xoxb-app-token" },
         ]
       : [{ keychainService: `omnis.${channel}.281932556+jinhologankim@users.noreply.github.com`, account: "281932556+jinhologankim@users.noreply.github.com", secret: "s" }],
   );

   describe("Onboarding (A5 §7.1, Phase A 필수 채널 3개)", () => {
     it("continue button is disabled until slack/gmail/gcal are all connected", async () => {
       const oauthClient: OAuthClient = { connect: mockConnect };
       const onDone = vi.fn();
       render(<Onboarding oauthClient={oauthClient} onDone={onDone} />);
       expect(screen.getByText("계속")).toBeDisabled();

       fireEvent.click(screen.getAllByText("연결")[0]!);
       fireEvent.click(screen.getAllByText("연결")[0]!); // gmail (slack 버튼 라벨이 "연결됨"으로 바뀐 뒤의 다음 "연결")
       fireEvent.click(screen.getAllByText("연결")[0]!); // gcal

       await waitFor(() => expect(screen.getByText("계속")).not.toBeDisabled());
       fireEvent.click(screen.getByText("계속"));
       expect(onDone).toHaveBeenCalledOnce();
     });

     it("stores both slack keychain entries with account=team_id (계약 §9 Slack 2항목 규칙)", async () => {
       const invokeMock = vi.mocked((await import("@tauri-apps/api/core")).invoke);
       invokeMock.mockClear();
       render(<Onboarding oauthClient={{ connect: mockConnect }} onDone={vi.fn()} />);

       fireEvent.click(screen.getAllByText("연결")[0]!); // slack
       await waitFor(() => expect(screen.getByText("연결됨")).toBeInTheDocument());

       expect(invokeMock).toHaveBeenCalledWith("keychain_set", {
         service: "omnis.slack.xoxb.T123", account: "T123", secret: "xoxb-bot-token",
       });
       expect(invokeMock).toHaveBeenCalledWith("keychain_set", {
         service: "omnis.slack.xoxb.T123.app", account: "T123", secret: "xoxb-app-token",
       });
     });

     it("shows the mac-mini-setup note for WhatsApp/KakaoTalk/LinkedIn (마스터 D12 정직한 정의)", () => {
       render(<Onboarding oauthClient={{ connect: vi.fn() }} onDone={vi.fn()} />);
       expect(screen.getByText(/맥미니에서 설정이 필요해요/)).toBeInTheDocument();
     });
   });
   ```

9. [ ] 테스트 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/screens/Onboarding'`.

10. [ ] 구현.
    ```tsx
    // apps/desktop/src/screens/Onboarding.tsx
    import { useState } from "react";
    import { Button } from "@omnis/ui";
    import { storeChannelSecret } from "../api/keychain";

    export type OnboardingChannel = "slack" | "gmail" | "gcal";

    /** 계약 §9: 채널 하나가 keychain 항목 1개일 필요는 없다 — Slack은 bot+app 토큰 2개, account는 항목마다 채널이 정한다. */
    export interface ChannelSecretEntry { keychainService: string; account: string; secret: string; }

    export interface OAuthClient {
      connect(channel: OnboardingChannel): Promise<ChannelSecretEntry[]>;
    }

    const REQUIRED_CHANNELS: { id: OnboardingChannel; label: string }[] = [
      { id: "slack", label: "Slack" }, { id: "gmail", label: "Gmail" }, { id: "gcal", label: "Google Calendar" },
    ];

    type ConnectState = "idle" | "connecting" | "connected" | "error";

    /** A5 §7.1: Phase A 필수 채널은 Slack/Gmail/Calendar 3개뿐. Outlook/Telegram/WhatsApp/
     *  KakaoTalk/LinkedIn은 이 화면의 범위 밖(마스터 D12, "맥미니에서 설정 필요" 안내만). */
    export function Onboarding({ oauthClient, onDone }: { oauthClient: OAuthClient; onDone: () => void }) {
      const [state, setState] = useState<Record<OnboardingChannel, ConnectState>>({ slack: "idle", gmail: "idle", gcal: "idle" });

      async function connect(channel: OnboardingChannel) {
        setState((s) => ({ ...s, [channel]: "connecting" }));
        try {
          const entries = await oauthClient.connect(channel);
          // 계약 §9: Slack은 이 배열이 2항목(bot + app 토큰)이고, 나머지 채널은 1항목이다. 순서는 상관없다 — 전부 저장돼야 "연결됨".
          for (const entry of entries) {
            await storeChannelSecret(entry.keychainService, entry.account, entry.secret);
          }
          setState((s) => ({ ...s, [channel]: "connected" }));
        } catch {
          setState((s) => ({ ...s, [channel]: "error" }));
        }
      }

      const allConnected = REQUIRED_CHANNELS.every((c) => state[c.id] === "connected");

      return (
        <div className="onboarding">
          <h1>omnis에 오신 걸 환영해요</h1>
          <ul>
            {REQUIRED_CHANNELS.map((c) => (
              <li key={c.id}>
                <span>{c.label}</span>
                <Button disabled={state[c.id] === "connecting"} onClick={() => connect(c.id)}>
                  {state[c.id] === "connected" ? "연결됨" : state[c.id] === "connecting" ? "연결 중…" : "연결"}
                </Button>
                {state[c.id] === "error" && <span role="alert">연결 실패, 다시 시도해주세요</span>}
              </li>
            ))}
          </ul>
          <p>WhatsApp / KakaoTalk / LinkedIn: 맥미니에서 설정이 필요해요</p>
          <Button onClick={onDone} disabled={!allConnected}>계속</Button>
        </div>
      );
    }
    ```

11. [ ] 테스트 재실행 → 통과 확인.
    ```bash
    pnpm --filter @omnis/desktop test
    ```
    기대 출력: `Onboarding` 3개 테스트 PASS(전체 연결 게이팅 + slack 2항목 저장 + mac-mini-setup 안내), 전체 스위트 회귀 없음.

12. [ ] 커밋.
    ```bash
    git add apps/desktop/src/api/keychain.ts apps/desktop/src/screens/Onboarding.tsx apps/desktop/test/onboarding-screen.test.tsx
    git commit -m "$(cat <<'EOF'
    US-A31: Onboarding wizard for the 3 Phase A required channels (Slack/Gmail/Calendar)

    - continue is gated on all 3 being connected; other 5 channels show the mac-mini-setup note
    - OAuth token exchange itself stays inside the OAuthClient the caller injects — that's
      the channel adapters' job (US-A12~A14), not this screen's
    - keychain naming matches interfaces contract §9 exactly: Slack writes 2 items
      (omnis.slack.xoxb.<team_id> + ....app, account=<team_id>), Gmail/GCal write
      omnis.gmail.<email> with account=Logan's identifier (cross-plan review M7)

    Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
    EOF
    )"
    ```

---

## 자체 리뷰 (self-review)

1. **스토리 → 태스크 매핑**: US-A22(Task 3), US-A24(Task 1), US-A25(Task 2), US-A26(Task 4), US-A27(Task 5), US-A28(Task 6), US-A29(Task 7), US-A30(Task 8), US-A31(Task 9) — 9개 스토리 전부 최소 1개 태스크에 매핑됨.
2. **금지 패턴 grep**: `TBD`, `TODO`, `implement later`, `add appropriate error handling`, `handle edge cases`, `similar to Task` 문자열이 본문에 없음을 확인(자체 검토, 아래 open_questions의 논의성 언급 제외).
3. **심볼 출처 확인**: `zeroSchema`/`initZero`(계약 §7), `TOOL_LABELS`/`ToolCallBadge`(계약이 아니라 A5-D11 원문 그대로 이식, 계약 §6은 `@omnis/agents`의 `recordRun` 등만 다루고 UI 심볼은 안 다룸 — A5가 정본), `HumanInterrupt`/`ApprovalAction`/`ApprovalDecision`(계약 §3.4, 단 `packages/ui`에서는 패키지 경계 판정에 따라 미러링), `POST /approvals/:id/decide`(계약 §5) — 전부 계약 문서 또는 이 플랜의 앞선 태스크에서 정의됨. `@omnis/kernel/zero` 서브패스 import는 계약 §7 문장 그대로.

## open_questions

1. **"Claude Fable 5.1" 커밋 트레일러 지시와 A7-D6의 정면 충돌**: 작업 지시의 Global Constraints 텍스트는 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`을 쓰라고 했지만, A7-D6/A7 §4는 `fable`을 헤드리스 개발 루프(ralph)에서 명시적으로 배제하고("Fable은 개발 루프(헤드리스)에서 완전 배제"), A7-D8·인터페이스 계약 §9는 실제 포맷을 `Co-Authored-By: Claude <tier> <noreply@anthropic.com>`로 못박는다. 이 플랜은 스펙(A7-D6/D8, 계약 §9)을 정본으로 삼아 `Claude Sonnet <noreply@anthropic.com>`을 썼다 — Logan 확인 필요.
2. **`@omnis/ui` = "React만"(계약 §1) vs A5 §5.2~5.3의 실제 의존(Lucide/cmdk/Radix/cva)**: 이 플랜은 "React만"을 "`@omnis/*` 내부 패키지 의존 금지"로 해석해 protocol 타입을 import하지 않는 로컬 유니온 미러링으로 풀었다. 다른 Phase A 플랜(특히 kernel/sync 플랜)이 같은 조항을 다르게 해석하면 패키지 경계가 어긋날 수 있어, 이 판정을 인터페이스 계약 문서 자체에 §0 항목으로 역제안할 가치가 있다.
3. **Tauri keychain 플러그인명 미기재**: 작업 지시는 "the Tauri keychain plugin named in A5/A6"라고 했지만 두 문서 어디에도 구체적 플러그인 이름이 없다(grep 확인). A6 §9의 `security` CLI 패턴을 Tauri command로 감싸는 방식으로 대체했다 — Logan이 실제로 원하는 게 서드파티 크레인(예: keyring-rs 기반 플러그인)이라면 US-A31을 다시 열어야 한다.
4. **Zero 쿼리 빌더 정확한 문법**: A5 §3 공통 표기 원칙대로 이 플랜의 Zero 쿼리는 "어떤 테이블·필드가 소비되는지"만 확정한 의사코드에 가깝다(`.where`/`.related`의 정확한 연산자·체이닝은 A21이 실제 `zeroSchema`를 만들고 `@rocicorp/zero` 버전을 고정한 뒤에야 100% 확정된다). Task 3~8의 코드는 그 시점에 타입 오류가 나면 맞춰 조정한다는 전제가 깔려 있다.
5. **Tauri UI e2e(Playwright/tauri-driver)**: 작업 지시 본문은 "Playwright smoke per A7 §5"를 언급했지만 A7 §5·A7-D4는 `apps/desktop`(Tauri)의 e2e를 **UNVERIFIED — 스파이크**(`tauri-driver`+WebdriverIO 가정)로 명시하고 Playwright는 `apps/web`(PWA, Phase B) 몫이다. 이 플랜의 9개 스토리 중 어느 것도 Tauri e2e 산출물을 요구하지 않으므로(A7 §7 표) 이 플랜은 vitest+Testing Library 컴포넌트 테스트까지만 다루고 Tauri e2e는 만들지 않았다 — A7-D4 스파이크가 끝난 뒤 별도 플랜(또는 Phase A 백로그 확장)이 필요하다. **범위 확정(계약 리뷰 M14)**: 이 플랜의 테스트 계층은 컴포넌트 레벨(`vitest` + `@testing-library/react` + `jsdom`)로 고정이고, Tauri e2e를 쓸지/무엇으로 쓸지는 이 플랜이 결정하지 않는다 — 그 결정은 `2026-09-20-phase-0-spikes.md`의 T17(`tauri-driver`+WebdriverIO 스파이크) 결과가 나온 뒤 별도로 소비된다.

## 수정 이력 (2026-09-20, cross-plan review)

- **M9/M10 (Task 2·Task 3)**: `apps/desktop/package.json`에 `@omnis/kernel`을 workspace dep으로 선언(§7 서브패스 import만, §1 워크스페이스 선언 요건 충족)하고, `@rocicorp/zero` 설치 명령을 `pnpm add @rocicorp/zero@1.9.0 --filter @omnis/desktop --save-exact`로 고쳐 caret 없는 exact 핀으로 맞췄다.
- **M7 (Task 9)**: `storeChannelSecret`이 account를 하드코딩하지 않고 호출자에게 받도록 바꾸고, `OAuthClient.connect`의 반환 타입을 단일 항목에서 `ChannelSecretEntry[]`로 바꿔 Slack이 `omnis.slack.xoxb.<team_id>`(bot)·`omnis.slack.xoxb.<team_id>.app`(app) 2항목을(둘 다 account=`<team_id>`) 쓰고 Gmail은 `omnis.gmail.<email>` 1항목을 쓰도록 정정했다. 테스트도 Slack 2항목 저장을 검증하는 케이스를 추가했다.
- **M11 (Task 8)**: `읽을 스펙`에 인터페이스 계약 §9를 추가해 `OMNIS_HUB_HTTP_URL`이 계약에 등재된 환경변수임을 명시했다.
- **M1 (Task 1·Task 2)**: `packages/ui`·`apps/desktop`의 `package.json`에서 `vitest`를 `2.1.9`, `typescript`를 `5.6.3`으로 exact 고정했다(계약 §2 FIXED 핀). 이 플랜은 애초에 `vitest.workspace.ts`를 만들지 않으므로(루트 스캐폴드는 kernel-and-db Task 1 소유) 별도로 제거할 로컬 workspace 파일이 없다.
- **M14**: open_questions #5에 "이 플랜의 컴포넌트 테스트는 vitest+RTL+jsdom로 고정, Tauri e2e 채택 여부는 phase-0 T17 스파이크 결과가 결정한다"를 명문화했다.
- **커밋 트레일러**: Global Constraints의 커밋 규칙 문구를 `2026-09-20-phase-a-kernel-and-db.md`의 해석과 동일하게(계약 §9가 정본, `Claude Fable 5.1` 지시는 채택 안 함) 명시적으로 정렬했다 — 트레일러 값(`Co-Authored-By: Claude Sonnet <noreply@anthropic.com>`) 자체는 원래도 계약 §9 형식이었으므로 변경 없음.

미반영(이 플랜 밖 = 다른 문서 쪽 수정 사항): M8(Google `gmail`/`gcal` 항목 공유 — 이 플랜의 Task 9는 Slack 예외만 고쳤고, Gmail/GCal 온보딩 버튼을 하나로 합칠지는 어댑터 플랜(A12~A14)이 결정할 몫이라 건드리지 않았다), M13(`.github/workflows/ci.yml` 오너 미배정).
