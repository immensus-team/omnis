# `@omnis/web` — the omnis PWA

The phone client. One column at every width (A5 §4.1), a fixed five-slot bottom tab bar holding
Inbox / Today / Tasks / Network / Notes, and the same Zero tables the desktop reads — so a row means
the same thing in both apps. Vite + React, installed to the Home Screen as a PWA.

## Run it

```bash
pnpm --filter @omnis/web dev      # 127.0.0.1:5173 (OMNIS_WEB_PORT moves it)
pnpm --filter @omnis/web test
pnpm --filter @omnis/web build    # tsc --build && vite build — this is what generates the service worker
```

The dev server proxies `/api`, `/approvals` and `/health` to the hub on `127.0.0.1:8787`, so bring up
the hub and zero-cache first (root README, Quickstart). Rows come from zero-cache at
`OMNIS_ZERO_URL` (default `127.0.0.1:4848`); with neither reachable the app still opens and the inbox
says it is empty, because zero-cache hands down no rows without a hub-signed token.

## Install it on an iPhone

iOS installs a web app only from **Safari**, and only over HTTPS or a LAN address it trusts — Chrome
on iOS, and every in-app browser, can open the page but cannot add it to the Home Screen. The app
needs a service worker to be installable rather than a plain bookmark, which is why
`vite-plugin-pwa` registers one in `build` and not in `dev`.

1. Open the omnis URL in Safari.
2. Tap the **Share** button in the toolbar, then **Add to Home Screen**, then **Add**.
3. Open omnis from its new icon. It runs full screen — `display-mode: standalone` — which is also
   what tells the shell to stop showing the in-app guide.

The same three steps are the install card the app shows a browser at the top of its first screen
(`src/components/InstallGuideCard.tsx`), so a person who never reads this file still gets them.

Web Push is **not** requested at first launch: A5 §4.5 wants the permission asked in context, when
the first pending approval appears (US-B36).
