# omnis Phase A Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Tauri 2 macOS shell of omnis — design tokens, Liquid Glass primitives, the Zero read client, and the Inbox/Thread/Agent Session/⌘K/ApprovalCard/Onboarding screens — so Logan can see and triage a real (once A05~A21 land) inbox on his Mac.
**Architecture:** `packages/ui` holds pure-presentation React components (design tokens + shadcn/Radix primitives + 5 custom omnis components) with zero `@omnis/*` runtime dependencies; `apps/desktop` is the Tauri 2 shell that wires those components to a read/write Zero client and to the hub's `/approvals` HTTP surface. Screens never talk to Postgres directly — all data flows through `@rocicorp/zero` (durable tier) or the hub's typed HTTP endpoints (approval decisions), per master §4.1 L4/L0 boundary.
**Tech Stack:** React 18 + TypeScript 5 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Tailwind v4, shadcn/ui (Radix primitives) + `class-variance-authority`, `react-virtuoso`, `cmdk`, `lucide-react`, Tauri 2 + `window-vibrancy`, `@rocicorp/zero`, Vite 5, vitest + `@testing-library/react` + `jsdom`, Biome, Rust (Tauri backend) with `cargo test`.
**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` (§4.1 L4, §6 data model, §12 surfaces) + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A5-ui-ux.md` (in full: §1 tokens, §2 navigation/palette, §3.1/3.2/3.3/3.9 screens, §5 component map, §6 Tauri shell, §7 onboarding, §8 microcopy) + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A3-data-schema.md` §7 (Zero replication scope) + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A7-dev-process.md` (§1 monorepo, §2 toolchain, §5 testing, §7 story cards) + `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` (the authoritative source for package names, symbols, and commands).

## Global Constraints

- Node 22 + pnpm workspaces.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`(A7 §1).
- Postgres 17 (A3) — this plan's screens never connect to Postgres directly; access is exclusively through Zero/hub HTTP.
- hub binds `127.0.0.1:8787`(master §4.2).
- migrations are append-only files `packages/db/migrations/000N_<name>.sql` with tracking table `_omnis_migrations` (A3 §8) — this plan creates no migration (reference only).
- no irreversible tool(send/delete/delegate/calendar_write) wired before the approval gate exists (A7 §7 shared prohibitions) — `ApprovalCard`'s `onDecide` calls hub `/approvals/:id/decide` only after a human explicitly presses it, and the client cannot flip `pending_approvals` to `executed` on its own (A3 §7 Zero permission rule).
- provider SDKs only inside their adapter package — not applicable here because this plan creates no adapter; `@omnis/desktop` does not directly import any channel provider SDK.
- Keychain item naming per A1 / interfaces contract §9 (base form `omnis.<channel>.<kind>.<external_id>`; bridge token `omnis.bridge.token.<host>`) — onboarding (US-A31) writes to the Keychain using this scheme. **With exactly two exceptions (contract §9, contract review M7·M8)**: the Google family (`gmail`/`gcal`) shares a single `omnis.gmail.<email>` item and omits the `<kind>` segment, while Slack uses two items, `omnis.slack.xoxb.<team_id>` (bot) and `omnis.slack.xoxb.<team_id>.app` (app), both with account `<team_id>` — the simple rule that account is always the fixed `omnis` does not apply to Slack.
- story tier per A7 §4 and every DeepSeek diff reviewed by Sonnet+ — every story in this plan (US-A22, A24~A31) is **Sonnet** tier (A7 §4 table), so there is no DeepSeek delegation procedure in this plan.
- commit messages end with `Co-Authored-By: Claude Sonnet <noreply@anthropic.com>` (the same rule as the kernel plan — A7-D8 · interfaces contract §9's actual format `Co-Authored-By: Claude <tier> <noreply@anthropic.com>` with this plan's uniform story tier, Sonnet, substituted in; the same reading as `2026-09-20-phase-a-kernel-and-db.md` Global Constraints: contract §9 is authoritative, and of the work order's `Claude Fable 5.1`/`<story-id>: <one-line summary>` + acceptance-criteria body instructions only the commit body structure is adopted — the "Claude Fable 5.1" in the work order directly contradicts A7-D6's explicit exclusion of fable from the headless development loop, so it was not adopted. The reasoning is recorded in open_questions).

## Package boundary ruling (applying the interfaces contract §1 `@omnis/ui` = "React only" clause)

The interfaces contract §1 pins `@omnis/ui`'s dependencies to "React only". A5 §5.2~5.3, however, state that `ToolCallBadge` uses Lucide icons, `CommandPalette` uses `cmdk`, and `DraftCard`/`ApprovalSheet` use shadcn (Radix-based, requiring `class-variance-authority`/`clsx`/`tailwind-merge`). This plan rules as follows: "React only" means **no dependency on internal `@omnis/*` packages** (in particular network/business-logic libraries such as `@omnis/protocol`'s zod schemas, `ai`, and `@rocicorp/zero`), and points at the same thing as A7 §1's "no network calls and no business logic" principle — rendering-only third parties (Lucide, cmdk, Radix, cva, clsx, tailwind-merge) are not the target. `packages/ui` components therefore **do not import** `@omnis/protocol` types and instead define their own local string-literal unions mirroring protocol's value sets (for example, `UiChannel` uses the same 10 literals as the `Channel` enum). `apps/desktop` (= allowed to depend on `@omnis/protocol`) passes protocol-typed values straight through from Zero/HTTP — the literal sets are identical, so TS structural typing means no conversion function is needed.

---

### Task 1: Design tokens + shadcn/ui setup + Liquid Glass primitives (US-A24, tier: Sonnet)

**Goal (A7 §7)**: design tokens + shadcn/ui setup (Liquid Glass primitives)
**Deliverables (A7 §7)**: `packages/ui/src/tokens.ts`, `packages/ui/src/components/*`
**Verification command (A7 §7)**: `pnpm --filter @omnis/ui test`
**Tier**: Sonnet
**Spec to read**: A5 §1 (in full), §1.5 (Liquid Glass code rules), §9 QA checklist (colour/token/motion/Glass items)
**Won't do (YAGNI)**: do not call the shadcn CLI (`pnpm dlx shadcn@latest ...`) over the network — the ralph loop is unattended and the CLI raises interactive prompts (A7 §3 "the ralph loop is unattended"). `components.json` + `Button` are transcribed by hand from shadcn's standard output (shadcn's whole distribution model is "copy it into your own code"). The 9 custom components (`InboxRow` and friends) are not built here — the screen tasks that need them (A26~A30) build them.

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vitest.config.ts`, `packages/ui/src/tokens.css`, `packages/ui/src/tokens.ts`, `packages/ui/src/lib/cn.ts`, `packages/ui/src/components/glass-surface.tsx`, `packages/ui/src/components/button.tsx`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/tokens.test.ts`, `packages/ui/test/glass-surface.test.tsx`, `packages/ui/test/button.test.tsx`

**Interfaces:**
- Consumes: none (a leaf package — React and third-party UI libraries only).
- Produces: `TYPE_SCALE`, `SPACE`, `RADIUS`, `DURATION`, `EASE_SPRING`, `WEIGHT` (all in `packages/ui/src/tokens.ts`), `GlassSurface`, `GlassSlot`, `OpaqueSurface` (`packages/ui/src/components/glass-surface.tsx`), `cn` (`packages/ui/src/lib/cn.ts`), `Button` (`packages/ui/src/components/button.tsx`) — every later task imports these symbols.

**Steps:**

1. [ ] Create the package scaffold.
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
   Versions are pinned exactly as the interfaces contract §2 FIXED pins (`vitest 2.1.9` · `typescript 5.6.3`, no caret) — other values other plans used, such as `^2.1.8`/`5.0.1`/`^5.7.2`, all converge on these (contract review M1).
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

2. [ ] Write the token test first (failing state).
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
     it("weight caps at semibold — no 700+ bold (A5 §9 checklist)", () => {
       expect(WEIGHT).toEqual({ regular: 400, medium: 510, semibold: 590 });
     });
   });
   ```

3. [ ] Run the test → confirm it fails because the module is missing.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `Cannot find module '../src/tokens'` (or an equivalent resolve failure) — `tokens.ts` does not exist yet.

4. [ ] Implement the tokens (the values of A5 §1.1~§1.4 verbatim).
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
   /* packages/ui/src/tokens.css — A5 §1.1~§1.4 carried over verbatim; components import it */
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

5. [ ] Re-run the test → confirm it passes.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `tokens.test.ts` 5 tests PASS.

6. [ ] Commit.
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

7. [ ] Write the Liquid Glass layer-rule test (A5 §1.5, A5-D5) first.
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

8. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `Cannot find module '../src/components/glass-surface'`.

9. [ ] Implement `GlassSurface`/`OpaqueSurface`. Restricting `slot` to a literal union enforces "no use outside these 4 places" (A5 §1.5) **at the type level** — passing any other string does not compile.
   ```tsx
   // packages/ui/src/components/glass-surface.tsx
   import type { ReactNode } from "react";
   import { cn } from "../lib/cn";

   /** A5 §1.5: glass goes in the 4 control/navigation layers only. The content layer is always OpaqueSurface. */
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
   // packages/ui/src/lib/cn.ts — the standard shadcn utility (clsx + tailwind-merge)
   import { clsx, type ClassValue } from "clsx";
   import { twMerge } from "tailwind-merge";

   export function cn(...inputs: ClassValue[]) {
     return twMerge(clsx(inputs));
   }
   ```

10. [ ] Re-run the test → confirm it passes.
    ```bash
    pnpm --filter @omnis/ui test
    ```
    Expected output: 7 tests (5 tokens + 2 glass) PASS.

11. [ ] Commit.
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

12. [ ] Write the shadcn `Button` primitive test first (§9 "no pill overuse" — buttons use sm/md radius only).
    ```tsx
    // packages/ui/test/button.test.tsx
    import { describe, it, expect, vi } from "vitest";
    import { render, screen, fireEvent } from "@testing-library/react";
    import { Button } from "../src/components/button";

    describe("Button (shadcn primitive)", () => {
      it("renders children and fires onClick", () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Approve</Button>);
        fireEvent.click(screen.getByRole("button", { name: "Approve" }));
        expect(onClick).toHaveBeenCalledOnce();
      });
      it("default variant is not pill-radius (A5 §9 no pill overuse)", () => {
        render(<Button>Send</Button>);
        expect(screen.getByRole("button")).not.toHaveClass("rounded-full");
      });
    });
    ```

13. [ ] Run the test → confirm it fails, then implement using the standard shadcn pattern verbatim.
    ```bash
    pnpm --filter @omnis/ui test
    ```
    Expected output: `Cannot find module '../src/components/button'`.
    ```tsx
    // packages/ui/src/components/button.tsx — standard shadcn/ui output (cva-based), hand-written (no network CLI)
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
    // packages/ui/components.json — shadcn config (documentation purposes; the CLI is never invoked)
    {
      "$schema": "https://ui.shadcn.com/schema.json",
      "style": "default",
      "tsx": true,
      "tailwind": { "config": "tailwind.config.ts", "css": "src/tokens.css", "baseColor": "neutral", "cssVariables": true },
      "aliases": { "components": "src/components", "utils": "src/lib/cn" }
    }
    ```

14. [ ] Re-run the test → confirm it passes.
    ```bash
    pnpm --filter @omnis/ui test
    ```
    Expected output: all 9 tests PASS.

15. [ ] Re-export from `packages/ui/src/index.ts` and commit.
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

### Task 2: Tauri 2 scaffold + window-vibrancy (US-A25, tier: Sonnet)

**Goal (A7 §7)**: Tauri 2 scaffold (`window-vibrancy` wired up, empty shell)
**Deliverables (A7 §7)**: `apps/desktop/src-tauri/*`
**Verification command (A7 §7)**: `pnpm tauri:build`
**Tier**: Sonnet
**Depends on**: A24
**Spec to read**: A5 §6 (the Tauri shell in full), the last paragraph of A5 §1.5 (CSS-fallback feature-detect when vibrancy fails)
**Won't do (YAGNI)**: the menu-bar tray, global shortcuts, and deep links (the remaining A5 §6 items) exceed the story goal ("empty shell") — this task builds only window creation + vibrancy application/fallback. The tray and deep links are not in this backlog (A7 §7), so they are not built.

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/vite.config.ts`, `apps/desktop/vitest.config.ts`, `apps/desktop/index.html`, `apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/build.rs`
- Test: `apps/desktop/src-tauri/src/main.rs` (inline `#[cfg(test)]` module)

**Interfaces:**
- Consumes: none (scaffold).
- Produces: `vibrancy_attr(bool) -> &'static str` (Rust, `main.rs`), the `data-vibrancy` HTML attribute (set on the window at runtime; CSS uses it to branch between §1.5 `.glass-surface` and native), and an empty `<App />` shell.

**Steps:**

1. [ ] `apps/desktop` Vite+React scaffold.
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
   `@omnis/kernel` is declared up front here per interfaces contract §1 ("`apps/desktop` does not import `@omnis/kernel` wholesale; it uses only the `@omnis/kernel/zero` subpath — but it still declares the workspace dep in `package.json`"). The actual import (`import { zeroSchema } from "@omnis/kernel/zero"`) is written by Task 3 — this task references no export of `@omnis/kernel`.
   ```ts
   // apps/desktop/vite.config.ts
   import { defineConfig } from "vite";
   import react from "@vitejs/plugin-react";
   export default defineConfig({ plugins: [react()], clearScreen: false, server: { port: 5173, strictPort: true } });
   ```
   ```json
   // apps/desktop/tsconfig.json — extends the A7 §2 root tsconfig.base.json (same pattern as packages/ui)
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "jsx": "react-jsx", "outDir": "dist", "rootDir": "src", "types": ["vite/client"] },
     "references": [{ "path": "../../packages/ui" }],
     "include": ["src"]
   }
   ```
   ```ts
   // apps/desktop/vitest.config.ts — jsdom required (the US-A31 Onboarding test uses @testing-library/react's render())
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
   // apps/desktop/src/App.tsx — empty shell (A25 goal: "empty shell"). A26~A31 fill in screen routing.
   export function App() {
     return <main data-testid="app-shell">omnis</main>;
   }
   ```

2. [ ] Tauri configuration (A5 §6: single window, `titleBarStyle: overlay`, minimum 1024×640).
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

3. [ ] Split the vibrancy-application logic in `main.rs` into a **pure function + side-effecting function** (the pure function is testable without platform mocks — ponytail: minimal real test instead of per-platform mocking).
   ```rust
   // apps/desktop/src-tauri/src/main.rs
   #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

   use tauri::Manager;

   /// A5 §1.5: tells the frontend through `<html data-vibrancy>` whether we got native glass
   /// or had to downgrade to the CSS `.glass-surface` fallback.
   fn vibrancy_attr(applied: bool) -> &'static str {
       if applied { "native" } else { "css-fallback" }
   }

   #[cfg(target_os = "macos")]
   fn apply_glass(window: &tauri::WebviewWindow) -> bool {
       use window_vibrancy::{apply_liquid_glass, apply_vibrancy, NSVisualEffectMaterial};
       // A5 §1.5: apply_liquid_glass (macOS 26 Tahoe) first, falling back to apply_vibrancy(Sidebar).
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

4. [ ] Run the Rust unit tests → confirm they pass (this is this task's equivalent of "the failing test first" — in Rust, compiling is the first run, so confirm up front that `cargo test` fails with "no such file" before the file is written).
   ```bash
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml 2>&1 | tail -5
   ```
   Expected output (before the file is written): a compile failure such as `error: failed to read ... Cargo.toml` or `error[E0433]`. After writing the code from step 3 and re-running:
   ```bash
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
   ```
   Expected output: `test tests::native_when_glass_applied ... ok`, `test tests::css_fallback_when_glass_not_applied ... ok`.

5. [ ] Verify the frontend build + Tauri build.
   ```bash
   pnpm --filter @omnis/desktop vite:build && pnpm tauri:build
   ```
   Expected output: `apps/desktop/dist/` is produced, then `apps/desktop/src-tauri/target/release/bundle/macos/omnis.app` (unsigned dev build, A7-D9).

6. [ ] Commit.
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

### Task 3: Zero client init + read-only query round trip (US-A22, tier: Sonnet)

**Goal (A7 §7)**: Zero client init (confirm one read-only query round trip in `apps/desktop`)
**Deliverables (A7 §7)**: `apps/desktop/src/zero-client.ts`
**Verification command (A7 §7)**: `pnpm --filter @omnis/desktop test`
**Tier**: Sonnet
**Depends on**: A21 (the kernel's `zeroSchema`, owned by another plan, `2026-09-20-phase-a-sync-and-agents.md`), A25
**Spec to read**: interfaces contract §7 (Zero), A3 §7 (replication scope)
**Preconditions**: this task's test passes only with a local `zero-cache` (which A21 wires into `apps/hub`) and Postgres running — on the worktrunk dependency graph A21 merges first, so we assume it is already available when this task starts (running this task alone without A21 makes step 5 fail with a connection error, which is expected: it does not "skip the test" but simply exposes the missing predecessor story).

**Files:**
- Create: `apps/desktop/src/zero-client.ts`
- Test: `apps/desktop/test/zero-client.test.ts`

**Interfaces:**
- Consumes: `zeroSchema` (from `@omnis/kernel/zero`, the symbol A21 creates), `@rocicorp/zero`'s `Zero` class.
- Produces: `initZero(opts?: { server?: string; userID?: string }): Zero<typeof zeroSchema>` (exactly the contract §7 signature) — Tasks 4~6 import this function.

**Steps:**

1. [ ] Add the `@rocicorp/zero` dependency. Interfaces contract §2/§7 pin it exactly (no caret, A6 §5) — running `pnpm add @rocicorp/zero` without `--save-exact` writes `^1.9.0`, which diverges from the sync plan's exact `1.9.0` (contract review M10).
   ```bash
   pnpm add @rocicorp/zero@1.9.0 --filter @omnis/desktop --save-exact
   ```

2. [ ] Write the round-trip test first.
   ```ts
   // apps/desktop/test/zero-client.test.ts
   import { describe, it, expect, afterAll } from "vitest";
   import { initZero } from "../src/zero-client";

   describe("US-A22 Zero read-only round trip", () => {
     const zero = initZero({ userID: "logan-test" });

     it("resolves a query against threads without throwing (A3 §7 replicated table)", async () => {
       const rows = await zero.query.threads.limit(1).run();
       expect(Array.isArray(rows)).toBe(true);
     }, 10_000);

     afterAll(async () => {
       await zero.close();
     });
   });
   ```

3. [ ] Run the test → confirm it fails because the module is absent.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/zero-client'`.

4. [ ] Implement `initZero` with exactly the contract §7 signature.
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

5. [ ] Re-run with a local `zero-cache` + Postgres running → confirm it passes.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `US-A22 Zero read-only round trip > resolves a query against threads without throwing` PASS.

6. [ ] Commit.
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

### Task 4: Inbox screen (US-A26, tier: Sonnet)

**Goal (A7 §7)**: Inbox screen (filter pills, react-virtuoso list)
**Deliverables (A7 §7)**: `apps/desktop/src/screens/Inbox.tsx`
**Verification command (A7 §7)**: `pnpm --filter @omnis/desktop test`
**Tier**: Sonnet
**Depends on**: A22, A24
**Spec to read**: A5 §3.1 (the Inbox in full), §2.1 (the 5 filter pills), §9 checklist (channel identity = icon, label chip rules)
**Won't do (YAGNI)**: the bulk action bar, multi-select (`x`), and the skeleton/error/offline status banners exceed the story goal ("filter pills, virtuoso list") — none are built here. The label chips' "click to open a popover with the full list" is not built either (just `+N` text, no popover).

**Files:**
- Create: `packages/ui/src/components/inbox-row.tsx`, `apps/desktop/src/screens/Inbox.tsx`
- Test: `packages/ui/test/inbox-row.test.tsx`, `apps/desktop/test/inbox-screen.test.tsx`

**Interfaces:**
- Consumes: `GlassSurface`, `cn`(A24), `initZero`(A22).
- Produces: `InboxRow`, `InboxRowProps`, `LabelChip`, `UiChannel` (`packages/ui/src/components/inbox-row.tsx`) — Task 5 reuses the `UiItemStatus` pattern; `filterInboxItems` (`apps/desktop/src/screens/Inbox.tsx`, a pure function).

**Steps:**

1. [ ] Write the `InboxRow` presentational component test first (per the package boundary ruling, it uses a local union rather than importing `@omnis/protocol`).
   ```tsx
   // packages/ui/test/inbox-row.test.tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { InboxRow } from "../src/components/inbox-row";

   const baseProps = {
     id: "item-1", title: "Sora Kim", preview: "Could you check the meeting materials?", channel: "slack" as const,
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
     it("shows at most 2 chips + N more, scope label first (A5 §3.1 priority)", () => {
       render(<InboxRow {...baseProps} labels={[
         { kind: "topic", name: "a", color: null }, { kind: "scope", name: "work", color: null },
         { kind: "person", name: "b", color: null },
       ]} />);
       expect(screen.getByLabelText("scope label: work")).toBeInTheDocument();
       expect(screen.getByLabelText("view more labels (1)")).toHaveTextContent("+1");
     });
     it("prefixes draft items with 'Draft: ' (A5 §3.1)", () => {
       render(<InboxRow {...baseProps} status="draft" preview="Yes, confirmed" />);
       expect(screen.getByText("Draft: Yes, confirmed")).toBeInTheDocument();
     });
   });
   ```

2. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `Cannot find module '../src/components/inbox-row'`.

3. [ ] Implement `InboxRow`.
   ```tsx
   // packages/ui/src/components/inbox-row.tsx
   import { cn } from "../lib/cn";

   /** Mirrors the literals of protocol's Channel enum (see the package boundary ruling — no @omnis/protocol import). */
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
     const previewText = props.status === "draft" ? `Draft: ${props.preview}` : props.preview;
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
             <span key={chip.kind} className="inbox-row__chip" aria-label={`${chip.kind} label: ${chip.name}`}>{chip.name}</span>
           ))}
           {more > 0 && <span className="inbox-row__chip-more" aria-label={`view more labels (${more})`}>+{more}</span>}
         </div>
         <div className="inbox-row__channel" aria-label={`message from ${CHANNEL_LABEL[props.channel]}`}>
           {props.unread && <span className="inbox-row__unread" aria-label="unread" />}
           {props.hasPendingApproval && <span className="inbox-row__approval-dot" />}
         </div>
       </div>
     );
   }
   ```

4. [ ] Re-run the test → confirm it passes, then commit.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: the 3 `InboxRow (A5 §3.1)` tests PASS.
   ```bash
   git add packages/ui/src/components/inbox-row.tsx packages/ui/test/inbox-row.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A26: InboxRow component (A5 §3.1) — chips, draft prefix, channel a11y label

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] Test the Inbox screen's filter logic as a pure function first (verify the logic alone without mounting react-virtuoso/Zero — ponytail: a pure function with no network dependency is the cheapest thing to test).
   ```ts
   // apps/desktop/test/inbox-screen.test.tsx
   import { describe, it, expect } from "vitest";
   import { filterInboxItems, type InboxFilter, type InboxQueryItem } from "../src/screens/Inbox";

   const items: InboxQueryItem[] = [
     { id: "1", scope: "work", hasPendingApproval: false, authorKind: "person" },
     { id: "2", scope: "personal", hasPendingApproval: true, authorKind: "person" },
     { id: "3", scope: "work", hasPendingApproval: false, authorKind: "agent" },
   ];

   describe("filterInboxItems (A5 §2.1 five filter pills, mutually exclusive)", () => {
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

6. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/screens/Inbox'`.

7. [ ] Implement the Inbox screen (`filterInboxItems` is an exported pure function; the component consumes it).
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

   /** A5 §2.1: the 5 filter pills are mutually exclusive (radio) and are views over the items.status/labels.kind='scope' combination. */
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
           <div role="radiogroup" aria-label="Inbox filters">
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
   Note (this is not prose standing in for code — per A5 §3's shared notation principle, the only thing fixed about these Zero queries is "which tables and fields the screen consumes"; the exact `.where`/`.related` operators get adjusted to fit the types once A21 merges `zeroSchema` and type errors appear.

8. [ ] Re-run the test → confirm it passes.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: the 5 `filterInboxItems` cases PASS.

9. [ ] Commit.
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

### Task 5: Thread screen (US-A27, tier: Sonnet)

**Goal (A7 §7)**: Thread screen (render items, status badge)
**Deliverables (A7 §7)**: `apps/desktop/src/screens/Thread.tsx`
**Verification command (A7 §7)**: `pnpm --filter @omnis/desktop test`
**Tier**: Sonnet
**Depends on**: A22, A24
**Spec to read**: A5 §3.2 (the Thread in full — but only the DraftCard's 3 buttons and the status badge), A3 §6 `items.status` enum
**Won't do (YAGNI)**: the Tiptap Composer (directly typed replies) is not in the story goal ("render items, status badge") — it is not built. Neither are the auto-archive restore banner or offline queueing.

**Files:**
- Create: `packages/ui/src/types.ts`, `packages/ui/src/components/status-badge.tsx`, `packages/ui/src/components/draft-card.tsx`, `apps/desktop/src/screens/Thread.tsx`
- Modify: `packages/ui/src/components/inbox-row.tsx` (delete the local type declarations, re-export from `../types`), `packages/ui/src/index.ts` (add the types/status-badge/draft-card barrel exports)
- Test: `packages/ui/test/status-badge.test.tsx`, `packages/ui/test/draft-card.test.tsx`, `apps/desktop/test/thread-screen.test.tsx`

**Interfaces:**
- Consumes: `UiItemStatus` (the type Task 4 created, shared by re-export), `OpaqueSurface` (A24).
- Produces: `StatusBadge`, `DraftCard`, `DraftCardProps` (`packages/ui`) — Task 6 (AgentSession) reuses the `StatusBadge` pattern.

**Steps:**

1. [ ] Move `UiItemStatus` out of `inbox-row.tsx` into a shared module (no duplicate definitions).
   ```ts
   // packages/ui/src/types.ts
   export type UiItemStatus = "received" | "read" | "draft" | "approved" | "sent" | "failed" | "archived";
   export type UiChannel = "slack" | "gmail" | "gcal" | "outlook" | "telegram" | "whatsapp" | "kakaotalk" | "linkedin" | "agent" | "system";
   ```
   ```ts
   // packages/ui/src/components/inbox-row.tsx — replace the top imports (keep the re-export: Task 4's apps/desktop/src/screens/Inbox.tsx
   // already imports UiChannel/UiItemStatus from "@omnis/ui/components/inbox-row", so without a re-export here
   // that import breaks. import type alone does not re-export, so the export type ... from form must be used)
   export type { UiChannel, UiItemStatus } from "../types";
   // delete the two existing local type declaration lines
   ```

2. [ ] Write the `StatusBadge` test first.
   ```tsx
   // packages/ui/test/status-badge.test.tsx
   import { describe, it, expect } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { StatusBadge } from "../src/components/status-badge";

   describe("StatusBadge (A3 items.status enum, 7 values)", () => {
     it.each([
       ["received", "Received"], ["read", "Read"], ["draft", "Draft"], ["approved", "Approved"],
       ["sent", "Sent"], ["failed", "Failed"], ["archived", "Archived"],
     ] as const)("%s → %s", (status, label) => {
       render(<StatusBadge status={status} />);
       expect(screen.getByText(label)).toHaveAttribute("data-status", status);
     });
   });
   ```

3. [ ] Run the test → fail, implement, re-run → pass.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output (before implementing): `Cannot find module '../src/components/status-badge'`.
   ```tsx
   // packages/ui/src/components/status-badge.tsx
   import type { UiItemStatus } from "../types";

   const STATUS_LABEL: Record<UiItemStatus, string> = {
     received: "Received", read: "Read", draft: "Draft", approved: "Approved", sent: "Sent", failed: "Failed", archived: "Archived",
   };

   export function StatusBadge({ status }: { status: UiItemStatus }) {
     return <span className="status-badge" data-status={status}>{STATUS_LABEL[status]}</span>;
   }
   ```
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: the 7 `StatusBadge` cases PASS.

4. [ ] Write the `DraftCard` test first (A5-D9: always show the full body, 3 buttons).
   ```tsx
   // packages/ui/test/draft-card.test.tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { DraftCard } from "../src/components/draft-card";

   describe("DraftCard (A5-D9)", () => {
     it("shows full body (no truncation) and rationale", () => {
       render(<DraftCard body="Yes, confirmed — I'll leave comments tomorrow morning" rationale="PROJECTS.md #davich" onEditAndSend={vi.fn()} onDiscard={vi.fn()} onRegenerate={vi.fn()} />);
       expect(screen.getByText("Yes, confirmed — I'll leave comments tomorrow morning")).toBeInTheDocument();
       expect(screen.getByText(/PROJECTS.md #davich/)).toBeInTheDocument();
     });
     it("wires the 3 buttons to their callbacks (§8 microcopy)", () => {
       const onEditAndSend = vi.fn(); const onDiscard = vi.fn(); const onRegenerate = vi.fn();
       render(<DraftCard body="b" rationale="r" onEditAndSend={onEditAndSend} onDiscard={onDiscard} onRegenerate={onRegenerate} />);
       fireEvent.click(screen.getByText("Edit and send")); expect(onEditAndSend).toHaveBeenCalledOnce();
       fireEvent.click(screen.getByText("Discard")); expect(onDiscard).toHaveBeenCalledOnce();
       fireEvent.click(screen.getByText("Regenerate")); expect(onRegenerate).toHaveBeenCalledOnce();
     });
   });
   ```

5. [ ] Run the test → fail, implement, re-run → pass.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output (before implementing): `Cannot find module '../src/components/draft-card'`.
   ```tsx
   // packages/ui/src/components/draft-card.tsx
   import { OpaqueSurface } from "./glass-surface";
   import { Button } from "./button";

   export interface DraftCardProps {
     body: string; rationale: string;
     onEditAndSend: () => void; onDiscard: () => void; onRegenerate: () => void;
   }

   /** A5-D9: a draft always shows its full body (never summarized). */
   export function DraftCard(props: DraftCardProps) {
     return (
       <OpaqueSurface className="draft-card">
         <p className="draft-card__rationale">omnis draft · rationale: {props.rationale}</p>
         <p className="draft-card__body">{props.body}</p>
         <div className="draft-card__actions">
           <Button onClick={props.onEditAndSend}>Edit and send</Button>
           <Button variant="ghost" onClick={props.onDiscard}>Discard</Button>
           <Button variant="ghost" onClick={props.onRegenerate}>Regenerate</Button>
         </div>
       </OpaqueSurface>
     );
   }
   ```
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: the 2 `DraftCard (A5-D9)` tests PASS.

6. [ ] Add the new barrel exports to `packages/ui/src/index.ts` (this task's Thread screen and the later AgentSession/ApprovalCard tasks must import straight from `@omnis/ui`) and commit (package boundary cleanup + the two components).
   ```ts
   // packages/ui/src/index.ts — appended after the existing 3 lines (tokens/glass-surface/button)
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

7. [ ] Test the Thread screen logic (which item renders as a DraftCard) as a pure function first.
   ```ts
   // apps/desktop/test/thread-screen.test.tsx
   import { describe, it, expect } from "vitest";
   import { findDraftItem, type ThreadQueryItem } from "../src/screens/Thread";

   const items: ThreadQueryItem[] = [
     { id: "1", status: "read", body: "Confirmed" },
     { id: "2", status: "draft", body: "this draft is the latest" },
   ];

   describe("findDraftItem (A5 §3.2 the DraftCard appears only when an Item with status='draft' exists)", () => {
     it("returns the draft item when present", () => { expect(findDraftItem(items)?.id).toBe("2"); });
     it("returns undefined when no draft exists", () => {
       expect(findDraftItem(items.filter((i) => i.status !== "draft"))).toBeUndefined();
     });
   });
   ```

8. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/screens/Thread'`.

9. [ ] Implement the Thread screen.
   ```tsx
   // apps/desktop/src/screens/Thread.tsx
   import { useQuery } from "@rocicorp/zero/react";
   import { StatusBadge, DraftCard } from "@omnis/ui";
   import type { UiItemStatus } from "@omnis/ui";
   import { initZero } from "../zero-client";

   export interface ThreadQueryItem { id: string; status: UiItemStatus; body: string; }

   /** A5 §3.2: the DraftCard appears only when an Item with status='draft' exists. */
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
             rationale="memory · past threads"
             onEditAndSend={() => { /* Composer wiring is out of scope for this story (YAGNI) */ }}
             onDiscard={() => zero.mutate.items.update({ id: draft.id, status: "archived" })}
             onRegenerate={() => { /* re-requesting propose_draft belongs to packages/agents; this screen only exposes the trigger */ }}
           />
         )}
       </div>
     );
   }
   ```

10. [ ] Re-run the test → pass, then commit.
    ```bash
    pnpm --filter @omnis/desktop test
    ```
    Expected output: the 2 `findDraftItem` tests PASS.
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

### Task 6: Agent Session screen (US-A28, tier: Sonnet)

**Goal (A7 §7)**: Agent Session screen (Thread view + tool_call badge, borrowing the `TOOL_LABELS` pattern — `22`)
**Deliverables (A7 §7)**: `apps/desktop/src/screens/AgentSession.tsx`
**Verification command (A7 §7)**: `pnpm --filter @omnis/desktop test`
**Tier**: Sonnet
**Depends on**: A20 (another plan's bridge mock; this task does not consume its deliverables directly and only reads the Item stream, so there is no dependency on A20's symbols — ordering only), A27
**Spec to read**: A5 §3.3 (in full), §9 checklist (distinguishing "agent proposal badge vs system execution log")
**Won't do (YAGNI)**: the "Read session" inline panel and the Hermes "read-only" badge (Phase B only) are not built in this task.

**Files:**
- Create: `packages/ui/src/components/tool-call-badge.tsx`, `apps/desktop/src/screens/AgentSession.tsx`
- Modify: `packages/ui/src/index.ts` (add the tool-call-badge barrel export)
- Test: `packages/ui/test/tool-call-badge.test.tsx`, `apps/desktop/test/agent-session-screen.test.tsx`

**Interfaces:**
- Consumes: `StatusBadge` (not reused — agent_turn/tool_call are distinguished by kind, not status), `OpaqueSurface` (A24), `UiItemStatus`/`UiChannel` (A27 `types.ts`).
- Produces: `TOOL_LABELS`, `ToolCallBadge`, `ToolCallState` (`packages/ui/src/components/tool-call-badge.tsx`) — the agentic-inbox porting pattern (A5-D11), reusable by other plans.

**Steps:**

1. [ ] Confirm the `lucide-react` dependency was already added in Task 1, then write the `TOOL_LABELS`/`ToolCallBadge` test first.
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
       expect(screen.getByText("Reading").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
       rerender(<ToolCallBadge tool="read" state="done" resultSummary="3 files" />);
       expect(screen.getByText(/3 files/)).toBeInTheDocument();
     });
     it("throws for an unmapped tool name (fail fast, not a silent blank badge)", () => {
       // @ts-expect-error deliberately invalid tool for the failure-path assertion
       expect(() => render(<ToolCallBadge tool="delete" state="done" />)).toThrow(/unknown tool/);
     });
   });
   ```

2. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `Cannot find module '../src/components/tool-call-badge'`.

3. [ ] Implement (the A5 §3.3 code verbatim, with master §11's 8 tool names).
   ```tsx
   // packages/ui/src/components/tool-call-badge.tsx
   import { Eye, Search, Calendar, MessagesSquare, PenLine, ListChecks, Share2, Route, type LucideIcon } from "lucide-react";

   export const TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
     read: { label: "Reading", icon: Eye },
     search_memory: { label: "Searching memory", icon: Search },
     read_calendar: { label: "Checking calendar", icon: Calendar },
     read_session: { label: "Checking another session", icon: MessagesSquare },
     propose_draft: { label: "Drafting a reply", icon: PenLine },
     propose_task: { label: "Extracting tasks", icon: ListChecks },
     propose_delegation: { label: "Proposing a delegation", icon: Share2 },
     propose_route: { label: "Proposing a note route", icon: Route },
   };

   export type ToolCallState = "loading" | "done" | "error";

   export interface ToolCallBadgeProps { tool: string; state: ToolCallState; resultSummary?: string; }

   /** `send`/`delete`/`delegate`/`calendar_write` are not in the tool palette per master §11 —
    *  reaching this badge would be a bug, so it throws immediately instead of silently rendering a blank badge. */
   export function ToolCallBadge({ tool, state, resultSummary }: ToolCallBadgeProps) {
     const meta = TOOL_LABELS[tool];
     if (!meta) throw new Error(`ToolCallBadge: unknown tool "${tool}" — not in master §11 palette`);
     const Icon = meta.icon;
     return (
       <div className="tool-call-badge" aria-busy={state === "loading"} data-state={state}>
         <Icon size={16} strokeWidth={2} />
         <span>{meta.label}</span>
         {state === "done" && <span aria-live="polite">✓ {resultSummary}</span>}
         {state === "error" && <span aria-live="polite">⚠ retry</span>}
       </div>
     );
   }
   ```

4. [ ] Re-run the test → pass, add the re-export to `packages/ui/src/index.ts`, then commit (this task's AgentSession screen must import straight from `@omnis/ui`).
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: the 3 `TOOL_LABELS / ToolCallBadge` tests PASS.
   ```ts
   // packages/ui/src/index.ts — appended after the existing exports
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

5. [ ] Test the Agent Session screen's "agent proposal badge vs system execution log" distinction (§9 checklist) as a pure function first.
   ```ts
   // apps/desktop/test/agent-session-screen.test.tsx
   import { describe, it, expect } from "vitest";
   import { isSystemExecutionLog, type SessionQueryItem } from "../src/screens/AgentSession";

   describe("isSystemExecutionLog (A5 §3.3 §9: visually distinguishing proposals from execution logs)", () => {
     it("kind='system' is an execution log line, not a tool badge", () => {
       expect(isSystemExecutionLog({ id: "1", kind: "system", tool: null, body: "✓ delegated to Codex" } as SessionQueryItem)).toBe(true);
     });
     it("kind='tool_call' is not (it renders as ToolCallBadge)", () => {
       expect(isSystemExecutionLog({ id: "2", kind: "tool_call", tool: "read", body: "" } as SessionQueryItem)).toBe(false);
     });
   });
   ```

6. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/screens/AgentSession'`.

7. [ ] Implement.
   ```tsx
   // apps/desktop/src/screens/AgentSession.tsx
   import { useQuery } from "@rocicorp/zero/react";
   import { ToolCallBadge, type ToolCallState } from "@omnis/ui";
   import { initZero } from "../zero-client";

   export interface SessionQueryItem { id: string; kind: "agent_turn" | "tool_call" | "system"; tool: string | null; body: string; }

   /** master §11: send/delete/delegate/calendar_write cannot be called by the agent directly —
    *  after approval, the execution result shows up only as a single kind='system' log line (§9 checklist). */
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

8. [ ] Re-run the test → pass, then commit.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: the 2 `isSystemExecutionLog` tests PASS.
   ```bash
   git add apps/desktop/src/screens/AgentSession.tsx apps/desktop/test/agent-session-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A28: Agent Session screen — ToolCallBadge for tool_call items, plain log line for system items

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 7: ⌘K command palette (US-A29, tier: Sonnet)

**Goal (A7 §7)**: ⌘K command palette (cmdk, including agent actions)
**Deliverables (A7 §7)**: `apps/desktop/src/components/CommandPalette.tsx`
**Verification command (A7 §7)**: `pnpm --filter @omnis/desktop test`
**Tier**: Sonnet
**Depends on**: A24
**Spec to read**: A5 §2.3 (action categories), §2.4 (keymap)
**Won't do (YAGNI)**: §2.5's unified search mode (Phase B, `GET /search`) is not built. Approval-requiring agent actions such as "Delegate to Codex" have no hub-side propose endpoint in the Phase A backlog (they are not in the interfaces contract §5 HTTP surface), so they are **registered only, with `perform` injected by the caller (App)** — the palette itself knows nothing about the backend.

**Files:**
- Create: `packages/ui/src/components/command-palette.tsx`, `apps/desktop/src/hooks/use-keymap.ts`
- Test: `packages/ui/test/command-palette.test.tsx`, `apps/desktop/test/use-keymap.test.ts`

**Interfaces:**
- Consumes: `GlassSurface`(slot="palette", A24).
- Produces: `CommandPalette`, `PaletteAction`, `groupBy` (`packages/ui`), `useKeymap` (`apps/desktop/src/hooks/use-keymap.ts`) — Task 9 (approval card) can reuse the `PaletteAction` pattern as-is.

**Steps:**

1. [ ] The `cmdk` dependency was already added in Task 1 (see the package boundary ruling). Write the `groupBy` + `CommandPalette` render test first.
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
       const actions: PaletteAction[] = [{ id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform }];
       render(<CommandPalette open onOpenChange={onOpenChange} actions={actions} />);
       fireEvent.click(screen.getByText("Go to Inbox"));
       expect(perform).toHaveBeenCalledOnce();
       expect(onOpenChange).toHaveBeenCalledWith(false);
     });
   });
   ```

2. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `Cannot find module '../src/components/command-palette'`.

3. [ ] Implement (the kbar pattern `id+name+shortcut+perform`, A5 §2.3).
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
           <Command.Input placeholder="Search or run a command…" />
           <Command.List>
             <Command.Empty>No results</Command.Empty>
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

4. [ ] Re-run the test → pass, then commit.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: 1 `groupBy` + 1 `CommandPalette` PASS.
   ```bash
   git add packages/ui/src/components/command-palette.tsx packages/ui/test/command-palette.test.tsx
   git commit -m "$(cat <<'EOF'
   US-A29: CommandPalette (cmdk) with kbar-style {id,name,shortcut,perform} actions

   - grouped by PaletteAction.group, renders inside GlassSurface(slot="palette")

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] Test the keymap (A5 §2.4) as a `useKeymap` hook first — the timing logic of the go-to prefix (`g` then a letter, 300ms window) is the core, so extract it into a pure reducer and test that.
   ```ts
   // apps/desktop/test/use-keymap.test.ts
   import { describe, it, expect, vi } from "vitest";
   import { reduceKeySequence } from "../src/hooks/use-keymap";

   describe("reduceKeySequence (A5 §2.4 go-to prefix g+letter, 300ms window)", () => {
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

6. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/hooks/use-keymap'`.

7. [ ] Implement (carry the A5 §2.4 table over into data verbatim).
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

   /** A5 §2.4: a letter within 300ms of 'g' resolves to a go-to action. It is a pure reducer, so it is testable without timers. */
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

8. [ ] Re-run the test → pass, then commit.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: the 3 `reduceKeySequence` tests PASS.
   ```bash
   git add apps/desktop/src/hooks/use-keymap.ts apps/desktop/test/use-keymap.test.ts
   git commit -m "$(cat <<'EOF'
   US-A29: useKeymap hook — A5 §2.4 full keymap incl. 300ms go-to prefix, pure-reducer tested

   Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
   EOF
   )"
   ```

---

### Task 8: Approval card UI (US-A30, tier: Sonnet)

**Goal (A7 §7)**: Approval card UI (rendering `pending_approvals`, 4-way accept/edit/respond/ignore — `22`)
**Deliverables (A7 §7)**: `apps/desktop/src/components/ApprovalCard.tsx`
**Verification command (A7 §7)**: `pnpm --filter @omnis/desktop test`
**Tier**: Sonnet
**Depends on**: A07 (the kernel approval gate HTTP surface, owned by another plan), A22
**Spec to read**: A5-D10, §3.3 inline ApprovalSheet, interfaces contract §5 (`POST /approvals/:id/decide`), contract §9 (`OMNIS_HUB_HTTP_URL` in the environment-variable list)
**Won't do (YAGNI)**: the mobile bottom-sheet variant (A5 §4.3) is out of scope for this task (macOS only).

**Files:**
- Create: `packages/ui/src/components/approval-card.tsx`, `apps/desktop/src/api/approvals.ts`, `apps/desktop/src/components/ApprovalCard.tsx`
- Modify: `packages/ui/src/index.ts` (add the approval-card barrel export)
- Test: `packages/ui/test/approval-card.test.tsx`, `apps/desktop/test/approvals-api.test.ts`

**Interfaces:**
- Consumes: `OpaqueSurface`, `Button`(A24).
- Produces: `ApprovalCardView`, `ApprovalCardViewProps` (`packages/ui`, pure presentation), `decideApproval` (`apps/desktop/src/api/approvals.ts`, calls contract §5's `POST /approvals/:id/decide`), `ApprovalCard` (`apps/desktop/src/components/ApprovalCard.tsx`, combining the two).

**Steps:**

1. [ ] Per the package boundary ruling, write the view-component test first, mirroring `@omnis/protocol`'s `HumanInterrupt` as a local interface instead of importing it.
   ```tsx
   // packages/ui/test/approval-card.test.tsx
   import { describe, it, expect, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { ApprovalCardView, type ApprovalCardInterrupt } from "../src/components/approval-card";

   const interrupt: ApprovalCardInterrupt = {
     action: "send", description: "Gmail reply: to David Park",
     config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
   };

   describe("ApprovalCardView (A5-D10, HumanInterrupt 4-way)", () => {
     it("renders only the buttons the config allows", () => {
       render(<ApprovalCardView interrupt={interrupt} onDecide={vi.fn()} />);
       expect(screen.getByText("Approve")).toBeInTheDocument();
       expect(screen.getByText("Edit and approve")).toBeInTheDocument();
       expect(screen.queryByText("Respond")).not.toBeInTheDocument();
       expect(screen.getByText("Ignore")).toBeInTheDocument();
     });
     it("accept calls onDecide('accept')", () => {
       const onDecide = vi.fn();
       render(<ApprovalCardView interrupt={interrupt} onDecide={onDecide} />);
       fireEvent.click(screen.getByText("Approve"));
       expect(onDecide).toHaveBeenCalledWith("accept", undefined);
     });
   });
   ```

2. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `Cannot find module '../src/components/approval-card'`.

3. [ ] Implement.
   ```tsx
   // packages/ui/src/components/approval-card.tsx
   import { OpaqueSurface } from "./glass-surface";
   import { Button } from "./button";

   export type ApprovalCardAction = "send" | "delete" | "calendar_write" | "delegate" | "self_model_edit" | "memory_write";
   export type ApprovalCardDecision = "accept" | "edit" | "respond" | "ignore";

   /** Mirrors @omnis/protocol's HumanInterrupt (package boundary ruling — no protocol import). */
   export interface ApprovalCardInterrupt {
     action: ApprovalCardAction; description: string; args?: Record<string, unknown>;
     config: { allow_accept: boolean; allow_edit: boolean; allow_respond: boolean; allow_ignore: boolean };
   }

   const ACTION_LABEL: Record<ApprovalCardAction, string> = {
     send: "Send", delete: "Delete", calendar_write: "Calendar write", delegate: "Delegate",
     self_model_edit: "Profile edit", memory_write: "Memory write",
   };

   export interface ApprovalCardViewProps {
     interrupt: ApprovalCardInterrupt;
     onDecide: (decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) => void;
   }

   export function ApprovalCardView({ interrupt, onDecide }: ApprovalCardViewProps) {
     const { config } = interrupt;
     return (
       <OpaqueSurface className="approval-card">
         <p className="approval-card__title">{ACTION_LABEL[interrupt.action]} needs your approval</p>
         <p className="approval-card__description">{interrupt.description}</p>
         <div className="approval-card__actions">
           {config.allow_accept && <Button onClick={() => onDecide("accept", undefined)}>Approve</Button>}
           {config.allow_edit && <Button variant="ghost" onClick={() => onDecide("edit", interrupt.args)}>Edit and approve</Button>}
           {config.allow_respond && <Button variant="ghost" onClick={() => onDecide("respond", undefined)}>Respond</Button>}
           {config.allow_ignore && <Button variant="ghost" onClick={() => onDecide("ignore", undefined)}>Ignore</Button>}
         </div>
       </OpaqueSurface>
     );
   }
   ```

4. [ ] Re-run the test → pass, add the re-export to `packages/ui/src/index.ts`, then commit (step 9's `apps/desktop/src/components/ApprovalCard.tsx` must import straight from `@omnis/ui`).
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: the 2 `ApprovalCardView` tests PASS.
   ```ts
   // packages/ui/src/index.ts — appended after the existing exports
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

5. [ ] Write the hub approval API client test (`POST /approvals/:id/decide`, interfaces contract §5) first.
   ```ts
   // apps/desktop/test/approvals-api.test.ts
   import { describe, it, expect, vi, afterEach } from "vitest";
   import { decideApproval } from "../src/api/approvals";

   describe("decideApproval (contract §5 POST /approvals/:id/decide)", () => {
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

6. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/api/approvals'`.

7. [ ] Implement.
   ```ts
   // apps/desktop/src/api/approvals.ts
   // OMNIS_HUB_HTTP_URL: a variable listed in the interfaces contract §9 environment-variable list (contract review M11) — falls back to the local default when unset at build time.
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

8. [ ] Re-run the test → confirm it passes.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: the 2 `decideApproval` tests PASS.

9. [ ] Write the thin `ApprovalCard` that combines the view + API (the view and API are each already covered by tests, so only a single wiring smoke test here).
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
   Expected output: the entire existing suite PASSes (confirming no regression).

10. [ ] Commit.
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

### Task 9: Onboarding flow (US-A31, tier: Sonnet)

**Goal (A7 §7)**: Onboarding flow (Slack/Gmail/Calendar OAuth connection wizard, Keychain storage)
**Deliverables (A7 §7)**: `apps/desktop/src/screens/Onboarding.tsx`
**Verification command (A7 §7)**: `pnpm --filter @omnis/desktop test`
**Tier**: Sonnet
**Depends on**: A12~A14 (adapters, another plan — this task does not call the adapters' `connect(auth)` directly; it only builds the UI that stores OAuth tokens in the Keychain), A24
**Spec to read**: A5 §7.1 (the 5 onboarding steps), A6 §9 and interfaces contract §9 (Keychain naming rule `omnis.<channel>.<kind>.<external_id>` — except the Google family, which omits the `<kind>` segment and shares a single `omnis.gmail.<email>` item, and Slack, which uses two items, `omnis.slack.xoxb.<team_id>` (bot) and `omnis.slack.xoxb.<team_id>.app` (app), both with `<team_id>` as the account field — the earlier assumption that account is `omnis` for every channel was corrected for Slack by contract review M7)
**Important (corrected in this task)**: the work order said "Tauri keychain plugin named in A5/A6", but no third-party Tauri keychain plugin is named anywhere in A5 or A6 (verified by grep — A6 §9 specifies secret retrieval only as a `security find-generic-password` **CLI call**). This task therefore adds no new unverified crate and simply wraps the `/usr/bin/security` CLI pattern A6 already settled on as a Tauri command (ponytail: reuse the pattern the spec already defines; add no new dependency).
**Won't do (YAGNI)**: the actual OAuth PKCE flow (browser redirect, token exchange) is already the channel adapters' job (US-A12~14) via `connect(auth)`, and it exceeds this story's deliverable file list (a single `Onboarding.tsx`) — this screen receives an injected `OAuthClient` interface, renders only the "connected/connecting/failed" state, and puts the returned secrets into the Keychain.

**Files:**
- Create: `apps/desktop/src/api/keychain.ts`, `apps/desktop/src/screens/Onboarding.tsx`
- Modify: `apps/desktop/src-tauri/src/main.rs` (command registration)
- Test: `apps/desktop/src-tauri/src/main.rs` (add an inline `#[cfg(test)]`), `apps/desktop/test/onboarding-screen.test.tsx`

**Interfaces:**
- Consumes: none (a new top-level screen).
- Produces: `keychain_set`(Rust Tauri command), `storeChannelSecret`(`apps/desktop/src/api/keychain.ts`), `Onboarding`, `OAuthClient`, `OnboardingChannel`, `ChannelSecretEntry`(`apps/desktop/src/screens/Onboarding.tsx`).

**Steps:**

1. [ ] Split the Rust `security` CLI wrapper into a **pure argument-building function + side-effecting command** and test it first (the same pattern as Task 2).
   ```rust
   // apps/desktop/src-tauri/src/main.rs — appended at the end of the existing file
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
   Add `.invoke_handler(tauri::generate_handler![keychain_set])` to `main()`'s `tauri::Builder::default()` chain (Task 2's chain went straight from `.setup(...)` to `.run(...)`, so insert it in between):
   ```rust
   // apps/desktop/src-tauri/src/main.rs — modify the existing chain inside main()
   fn main() {
       tauri::Builder::default()
           .invoke_handler(tauri::generate_handler![keychain_set])
           .setup(|app| {
               // exactly the vibrancy setup code Task 2 already wrote, unchanged
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
           // contract §9: the Slack bot token's actual service name is omnis.slack.xoxb.<team_id> with account <team_id> (contract review M7).
           let args = add_generic_password_args("omnis.slack.xoxb.T123", "T123");
           assert_eq!(args, vec!["add-generic-password", "-U", "-s", "omnis.slack.xoxb.T123", "-a", "T123", "-w"]);
       }
   }
   ```

2. [ ] Run the test → confirm it passes (before this step the function did not exist, so compilation would have failed — after writing the code above, the first run is itself the PASS confirmation).
   ```bash
   cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml keychain_tests
   ```
   Expected output: `test keychain_tests::builds_the_expected_security_cli_flags ... ok`.

3. [ ] Commit.
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

4. [ ] Write the frontend `storeChannelSecret` test first (mocking `@tauri-apps/api/core`'s `invoke`). **Contract review M7 correction**: the account field is not a fixed value per channel — the Google family (Gmail/GCal) uses Logan's personal identifier, while Slack uses `<team_id>` (contract §9). `storeChannelSecret` therefore does not hardcode account; the caller passes it in.
   ```ts
   // apps/desktop/test/onboarding-screen.test.tsx (top half — storeChannelSecret tests)
   import { describe, it, expect, vi, beforeEach } from "vitest";
   import { storeChannelSecret } from "../src/api/keychain";

   vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

   describe("storeChannelSecret (contract §9 Keychain naming rule)", () => {
     beforeEach(() => vi.clearAllMocks());
     it("invokes keychain_set with the Google identifier for a gmail service", async () => {
       const { invoke } = await import("@tauri-apps/api/core");
       await storeChannelSecret("omnis.gmail.you@example.com", "omnis", "secret-token");
       expect(invoke).toHaveBeenCalledWith("keychain_set", {
         service: "omnis.gmail.you@example.com", account: "omnis", secret: "secret-token",
       });
     });
     it("invokes keychain_set with the team_id as account for a slack bot-token service (contract §9 Slack exception)", async () => {
       const { invoke } = await import("@tauri-apps/api/core");
       await storeChannelSecret("omnis.slack.xoxb.T123", "T123", "xoxb-secret");
       expect(invoke).toHaveBeenCalledWith("keychain_set", {
         service: "omnis.slack.xoxb.T123", account: "T123", secret: "xoxb-secret",
       });
     });
   });
   ```

5. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/api/keychain'`.

6. [ ] Implement.
   ```ts
   // apps/desktop/src/api/keychain.ts
   import { invoke } from "@tauri-apps/api/core";

   /** Contract §9: the account field differs per channel (Google family = Logan's identifier, Slack = team_id) — the caller decides and passes it in. */
   export async function storeChannelSecret(keychainService: string, account: string, secret: string): Promise<void> {
     await invoke("keychain_set", { service: keychainService, account, secret });
   }
   ```

7. [ ] Re-run the test → confirm it passes.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: the 2 `storeChannelSecret` tests PASS (the fixed gmail account + the slack team_id case).

8. [ ] Continue by writing the `Onboarding` screen test (A5 §7.1: the 3 channels Phase A requires, with "Continue" enabled only once all are connected). **Contract review M7 correction**: `OAuthClient.connect` returns an **array of items**, not one keychain item per channel — only Slack has 2 items (bot + app token, both with account=team_id) while the rest have 1, so the names the adapter (T4's `omnis.slack.xoxb.<team_id>` + `....app`) and onboarding use must match exactly for connect to succeed.
   ```tsx
   // apps/desktop/test/onboarding-screen.test.tsx (bottom half — Onboarding component tests, continued in the same file)
   import { render, screen, fireEvent, waitFor } from "@testing-library/react";
   import { Onboarding, type OAuthClient, type ChannelSecretEntry } from "../src/screens/Onboarding";

   const mockConnect: OAuthClient["connect"] = vi.fn(async (channel) =>
     channel === "slack"
       ? [
           { keychainService: "omnis.slack.xoxb.T123", account: "T123", secret: "xoxb-bot-token" },
           { keychainService: "omnis.slack.xoxb.T123.app", account: "T123", secret: "xoxb-app-token" },
         ]
       : [{ keychainService: `omnis.${channel}.you@example.com`, account: "omnis", secret: "s" }],
   );

   describe("Onboarding (A5 §7.1, the 3 channels Phase A requires)", () => {
     it("continue button is disabled until slack/gmail/gcal are all connected", async () => {
       const oauthClient: OAuthClient = { connect: mockConnect };
       const onDone = vi.fn();
       render(<Onboarding oauthClient={oauthClient} onDone={onDone} />);
       expect(screen.getByText("Continue")).toBeDisabled();

       fireEvent.click(screen.getAllByText("Connect")[0]!);
       fireEvent.click(screen.getAllByText("Connect")[0]!); // gmail (the next "Connect" after the slack button label became "Connected")
       fireEvent.click(screen.getAllByText("Connect")[0]!); // gcal

       await waitFor(() => expect(screen.getByText("Continue")).not.toBeDisabled());
       fireEvent.click(screen.getByText("Continue"));
       expect(onDone).toHaveBeenCalledOnce();
     });

     it("stores both slack keychain entries with account=team_id (contract §9 two-item Slack rule)", async () => {
       const invokeMock = vi.mocked((await import("@tauri-apps/api/core")).invoke);
       invokeMock.mockClear();
       render(<Onboarding oauthClient={{ connect: mockConnect }} onDone={vi.fn()} />);

       fireEvent.click(screen.getAllByText("Connect")[0]!); // slack
       await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());

       expect(invokeMock).toHaveBeenCalledWith("keychain_set", {
         service: "omnis.slack.xoxb.T123", account: "T123", secret: "xoxb-bot-token",
       });
       expect(invokeMock).toHaveBeenCalledWith("keychain_set", {
         service: "omnis.slack.xoxb.T123.app", account: "T123", secret: "xoxb-app-token",
       });
     });

     it("shows the mac-mini-setup note for WhatsApp/KakaoTalk/LinkedIn (master D12 honest definition)", () => {
       render(<Onboarding oauthClient={{ connect: vi.fn() }} onDone={vi.fn()} />);
       expect(screen.getByText(/needs to be set up on the Mac mini/)).toBeInTheDocument();
     });
   });
   ```

9. [ ] Run the test → confirm it fails.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/screens/Onboarding'`.

10. [ ] Implement.
    ```tsx
    // apps/desktop/src/screens/Onboarding.tsx
    import { useState } from "react";
    import { Button } from "@omnis/ui";
    import { storeChannelSecret } from "../api/keychain";

    export type OnboardingChannel = "slack" | "gmail" | "gcal";

    /** Contract §9: one channel does not have to mean one keychain item — Slack has 2 (bot + app token), and the account is per item, decided by the channel. */
    export interface ChannelSecretEntry { keychainService: string; account: string; secret: string; }

    export interface OAuthClient {
      connect(channel: OnboardingChannel): Promise<ChannelSecretEntry[]>;
    }

    const REQUIRED_CHANNELS: { id: OnboardingChannel; label: string }[] = [
      { id: "slack", label: "Slack" }, { id: "gmail", label: "Gmail" }, { id: "gcal", label: "Google Calendar" },
    ];

    type ConnectState = "idle" | "connecting" | "connected" | "error";

    /** A5 §7.1: Phase A requires only 3 channels — Slack/Gmail/Calendar. Outlook/Telegram/WhatsApp/
     *  KakaoTalk/LinkedIn are outside this screen's scope (master D12 — just the "set up on the Mac mini" note). */
    export function Onboarding({ oauthClient, onDone }: { oauthClient: OAuthClient; onDone: () => void }) {
      const [state, setState] = useState<Record<OnboardingChannel, ConnectState>>({ slack: "idle", gmail: "idle", gcal: "idle" });

      async function connect(channel: OnboardingChannel) {
        setState((s) => ({ ...s, [channel]: "connecting" }));
        try {
          const entries = await oauthClient.connect(channel);
          // contract §9: for Slack this array holds 2 items (bot + app token) and other channels hold 1. Order does not matter — all of them must be stored for the channel to be "Connected".
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
          <h1>Welcome to omnis</h1>
          <ul>
            {REQUIRED_CHANNELS.map((c) => (
              <li key={c.id}>
                <span>{c.label}</span>
                <Button disabled={state[c.id] === "connecting"} onClick={() => connect(c.id)}>
                  {state[c.id] === "connected" ? "Connected" : state[c.id] === "connecting" ? "Connecting…" : "Connect"}
                </Button>
                {state[c.id] === "error" && <span role="alert">Connection failed, please try again</span>}
              </li>
            ))}
          </ul>
          <p>WhatsApp / KakaoTalk / LinkedIn: needs to be set up on the Mac mini</p>
          <Button onClick={onDone} disabled={!allConnected}>Continue</Button>
        </div>
      );
    }
    ```

11. [ ] Re-run the test → confirm it passes.
    ```bash
    pnpm --filter @omnis/desktop test
    ```
    Expected output: the 3 `Onboarding` tests PASS (all-connected gating + slack two-item storage + mac-mini-setup note), with no regression in the full suite.

12. [ ] Commit.
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

## Self-review

1. **Story → task mapping**: US-A22 (Task 3), US-A24 (Task 1), US-A25 (Task 2), US-A26 (Task 4), US-A27 (Task 5), US-A28 (Task 6), US-A29 (Task 7), US-A30 (Task 8), US-A31 (Task 9) — all 9 stories map to at least 1 task.
2. **Prohibited-pattern grep**: confirmed that the strings `TBD`, `TODO`, `implement later`, `add appropriate error handling`, `handle edge cases`, and `similar to Task` do not appear in the body (self-check, excluding the discussion-level mention in open_questions below).
3. **Symbol provenance check**: `zeroSchema`/`initZero` (contract §7), `TOOL_LABELS`/`ToolCallBadge` (not from the contract but ported verbatim from A5-D11's source text; contract §6 covers only `@omnis/agents`' `recordRun` and the like, not UI symbols — A5 is authoritative), `HumanInterrupt`/`ApprovalAction`/`ApprovalDecision` (contract §3.4, though mirrored in `packages/ui` per the package boundary ruling), `POST /approvals/:id/decide` (contract §5) — all defined either in the contract documents or in an earlier task of this plan. The `@omnis/kernel/zero` subpath import is the contract §7 sentence verbatim.

## open_questions

1. **Direct conflict between the "Claude Fable 5.1" commit-trailer instruction and A7-D6**: the work order's Global Constraints text says to end commit messages with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`, but A7-D6/A7 §4 explicitly exclude `fable` from the headless development loop (ralph) ("Fable is fully excluded from the development loop (headless)"), and A7-D8 · interfaces contract §9 pin the actual format as `Co-Authored-By: Claude <tier> <noreply@anthropic.com>`. This plan treats the spec (A7-D6/D8, contract §9) as authoritative and used `Claude Sonnet <noreply@anthropic.com>` — needs Logan's confirmation.
2. **`@omnis/ui` = "React only" (contract §1) vs A5 §5.2~5.3's actual dependencies (Lucide/cmdk/Radix/cva)**: this plan read "React only" as "no dependency on internal `@omnis/*` packages" and solved it with local-union mirroring that does not import protocol types. If another Phase A plan (especially the kernel/sync plan) reads the same clause differently, the package boundaries could drift apart, so this ruling is worth proposing back into the interfaces contract document itself as a §0 item.
3. **No Tauri keychain plugin name given**: the work order said "the Tauri keychain plugin named in A5/A6", but neither document names a specific plugin (verified by grep). This was replaced by wrapping A6 §9's `security` CLI pattern as a Tauri command — if what Logan actually wants is a third-party crate (for example a keyring-rs-based plugin), US-A31 needs to be reopened.
4. **Exact Zero query builder syntax**: per A5 §3's shared notation principle, this plan's Zero queries are closer to pseudocode that only fixes "which tables and fields are consumed" (the exact `.where`/`.related` operators and chaining are only 100% settled once A21 builds the real `zeroSchema` and pins the `@rocicorp/zero` version). The code in Tasks 3~8 rests on the premise that it gets adjusted to fit if type errors appear at that point.
5. **Tauri UI e2e (Playwright/tauri-driver)**: the work order body mentioned "Playwright smoke per A7 §5", but A7 §5 · A7-D4 state that e2e for `apps/desktop` (Tauri) is **UNVERIFIED — a spike** (assuming `tauri-driver` + WebdriverIO), and Playwright belongs to `apps/web` (PWA, Phase B). None of this plan's 9 stories requires a Tauri e2e deliverable (A7 §7 table), so this plan covers only vitest + Testing Library component tests and builds no Tauri e2e — a separate plan (or a Phase A backlog extension) is needed once the A7-D4 spike finishes. **Scope fixed (contract review M14)**: this plan's test layer is fixed at the component level (`vitest` + `@testing-library/react` + `jsdom`), and this plan does not decide whether or with what to run Tauri e2e — that decision is consumed separately once the result of T17 (`tauri-driver` + WebdriverIO spike) in `2026-09-20-phase-0-spikes.md` is available.

## Revision history (2026-09-20, cross-plan review)

- **M9/M10 (Task 2 · Task 3)**: declared `@omnis/kernel` as a workspace dep in `apps/desktop/package.json` (subpath import only per §7, satisfying §1's workspace declaration requirement), and fixed the `@rocicorp/zero` install command to `pnpm add @rocicorp/zero@1.9.0 --filter @omnis/desktop --save-exact` so it matches a caret-free exact pin.
- **M7 (Task 9)**: changed `storeChannelSecret` to take account from the caller instead of hardcoding it, and changed `OAuthClient.connect`'s return type from a single item to `ChannelSecretEntry[]`, correcting it so Slack uses 2 items — `omnis.slack.xoxb.<team_id>` (bot) and `omnis.slack.xoxb.<team_id>.app` (app), both with account=`<team_id>` — while Gmail uses the single `omnis.gmail.<email>`. A test case verifying the 2 Slack items were stored was added as well.
- **M11 (Task 8)**: added interfaces contract §9 to `Spec to read`, making explicit that `OMNIS_HUB_HTTP_URL` is an environment variable registered in the contract.
- **M1 (Task 1 · Task 2)**: pinned `vitest` to `2.1.9` and `typescript` to `5.6.3` exactly in the `package.json` of `packages/ui` and `apps/desktop` (contract §2 FIXED pins). This plan never created a `vitest.workspace.ts` in the first place (the root scaffold is owned by kernel-and-db Task 1), so there is no local workspace file to remove.
- **M14**: made open_questions #5 explicit: "this plan's component tests are fixed at vitest+RTL+jsdom; whether to adopt Tauri e2e is decided by the phase-0 T17 spike result".
- **Commit trailer**: explicitly aligned the commit-rule wording in Global Constraints with the reading in `2026-09-20-phase-a-kernel-and-db.md` (contract §9 is authoritative; the `Claude Fable 5.1` instruction is not adopted) — the trailer value itself (`Co-Authored-By: Claude Sonnet <noreply@anthropic.com>`) was already in contract §9 form, so it is unchanged.

Not addressed (outside this plan = changes on the other document's side): M8 (shared Google `gmail`/`gcal` items — Task 9 of this plan fixed only the Slack exception, and whether to merge the Gmail/GCal onboarding buttons into one is the adapter plan's call (A12~A14), so it was left alone), M13 (`.github/workflows/ci.yml` has no assigned owner).
