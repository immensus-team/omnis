# Mobile / iPhone PWA patterns for inbox apps

Research for omnis (unified inbox + agent sessions, Tauri desktop + iPhone PWA).

## Products studied (URLs)

- Superhuman Mail iOS — swipe/gesture model, bottom nav, Command palette
  - https://help.superhuman.com/hc/en-us/articles/46005853744525-Swiping-Around-Superhuman-Mail
  - https://help.superhuman.com/hc/en-us/articles/38458290528531-Mobile-Navigation
  - https://blog.superhuman.com/we-redesigned-superhuman-mail-for-ios-and-android/
- Spark Mail iOS — 4-way customizable swipes, widgets, toolbar personalization
  - https://sparkmailapp.com/help/manage-your-inbox/manage-emails-with-swipes
  - https://sparkmailapp.com/help/tips-tricks/personalize-the-toolbar
  - https://sparkmailapp.com/help/tips-tricks/spark-widgets-in-ios14
- Telegram — swipe-to-reply gesture, draggable bottom sheets
  - https://medium.com/@ravil.nell/react-native-chat-reply-on-swipe-like-in-telegram-9083f83f180c
  - https://github.com/alishari/TelegramBottomSheet
- Linear Mobile — frosted-glass redesign, bottom toolbar, no offline support yet
  - https://linear.app/changelog/2025-10-16-mobile-app-redesign
  - https://linear.app/now/linear-liquid-glass
  - https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile
- iOS 26 PWA platform limits — install, push, safe areas
  - https://www.mobiloud.com/blog/progressive-web-apps-ios/
  - https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide
  - https://itnext.io/make-your-pwas-look-handsome-on-ios-fd8fdfcd5777

## Patterns worth adopting

### 1. Anywhere-swipe-back, not edge-swipe-only
**What:** Superhuman lets you swipe anywhere on a message/detail screen to return to the inbox list, instead of requiring a precise edge swipe.
**Why it works:** iPhone thumbs can't reliably hit a 20px screen edge one-handed; a full-surface back gesture removes a common mis-tap source.
**Implementation for omnis:** On the thread-detail view (mobile breakpoint), bind a horizontal drag-right gesture across the whole content area (not just a back-button hit target) to pop back to the inbox list, with the existing iOS-standard edge-swipe kept as a secondary path. Use a spring dismiss (matches omnis's spring-based motion rule) with rubber-banding if the drag doesn't clear ~35% width.
**Effort:** M (gesture recognizer + transition state, reuse existing detail/list transition).

### 2. Two customizable swipe actions per row (short + long swipe)
**What:** Spark and Superhuman both support left/right swipe, each with a short-swipe default action and a long-swipe (full-width) action, user-configurable per direction.
**Why it works:** Covers the two most common triage moves (archive/done, snooze/later) without opening the row, and the long-swipe variant adds a second action without adding UI chrome.
**Implementation for omnis:** On inbox rows, right-swipe short = mark-done/archive, right-swipe long = snooze; left-swipe short = flag/pin, left-swipe long = open channel-specific quick action (e.g. reply for chat channels, approve for agent-approval rows). Keep the same row grammar as desktop (avatar/runtime logo, name, summary, badge) — swipe reveals colored action backgrounds behind the row, no separate action bar. Settings screen to remap, mirroring Spark's "Swipes" config.
**Effort:** M (one swipeable-row component reused across Inbox/Agents/Tasks lists).

### 3. Swipe-to-reply on a single message (chat-style channels)
**What:** Telegram's swipe-to-reply: a partial horizontal swipe on a message bubble shows a reply icon, releasing attaches that message as quoted context in the composer.
**Why it works:** One gesture replaces "long-press → menu → Reply", and it matches muscle memory omnis users already have from Telegram/WhatsApp/KakaoTalk.
**Implementation for omnis:** In thread views for chat-shaped channels (Slack, Telegram, WhatsApp, KakaoTalk), apply the same gesture to individual messages; for email-shaped channels (Gmail, Outlook) skip it — reply targets the whole thread, so this is channel-conditional, not a global list behavior.
**Effort:** S (single message-bubble component, channel-typed).

### 4. Draggable, snap-point bottom sheets for actions and detail peeks
**What:** Telegram/iOS-native pattern — a bottom sheet that drags between snap points (peek → half → full) rather than a fixed-height modal.
**Why it works:** Lets the same sheet serve a quick glance (approval card preview) and a full editor (Edit & send) without a screen transition, and it's dismissible by drag, which feels native rather than web-modal.
**Implementation for omnis:** Use this for the approval card on mobile (peek = summary + Approve/Edit/Ignore row; drag up = full body + edit field) and for the agent-run detail. This is the mobile analogue of the desktop "glassy floating panel" rule — glass treatment stays on the sheet chrome, content inside stays opaque per the existing rule.
**Effort:** M (one reusable BottomSheet with 2-3 snap points; a vaul-style library covers this — do not hand-roll drag physics).

### 5. Bottom tab bar as primary nav, not a hamburger/rail
**What:** Superhuman, Linear Mobile, Spark all collapse the desktop sidebar into a persistent bottom tab bar (Inbox, Calendar/Tasks, Search, Agents-equivalent) on mobile, with a floating action button for compose/create.
**Why it works:** Thumb-reachable, always visible, and matches the platform convention users already have from every native iOS app — a left rail (correct on desktop per DESIGN-DIRECTION.md) is unreachable one-handed on a phone.
**Implementation for omnis:** Below ~700px viewport, replace the channel rail with a bottom tab bar: Inbox / Agents / Tasks / Network, with the omni-ask bar staying pinned at top (collapsible on scroll-down, matching Superhuman's persistent-bottom-nav + top-search pattern). Give it the same Liquid-Glass treatment already approved for sidebar/toolbar in the desktop spec (frosted, tinted, blurred), consistent with Linear's frosted-glass bottom toolbar.
**Effort:** M (responsive nav swap, breakpoint already implied by "desktop + iPhone PWA" scope).

### 6. Interactive/actionable home-screen widgets
**What:** Spark ships iOS widgets with tap-to-archive/reply actions directly on the widget, no app launch required.
**Why it works:** For a unified inbox where the value prop is "see everything without opening 8 apps," a glanceable widget showing top unread + blocked-agent count is the highest-leverage surface omnis can own outside the app itself.
**Implementation for omnis:** A WidgetKit-equivalent (iOS PWA can't ship true interactive widgets — see Patterns to avoid) is out of reach for the PWA; treat this as a native-wrapper roadmap item once/if Tauri iOS or a thin native shell exists, not a v1 PWA feature.
**Effort:** L, and blocked on going beyond pure-PWA (see below).

### 7. Correct iOS safe-area handling in standalone display mode
**What:** `viewport-fit=cover` + `env(safe-area-inset-*)` padding applied to every fixed-position edge element (bottom tab bar, top ask-bar, floating compose button), scoped inside `@media (display-mode: standalone)`.
**Why it works:** Without this, the bottom tab bar sits under the home-indicator bar and the top ask-bar sits under the status bar/notch — the exact "elements break at different sizes" failure the user flagged. This is the single highest-value fix for #2 in the user's request.
**Implementation for omnis:** Set `<meta name="viewport" content="viewport-fit=cover">`; use `100dvh`/`100svh` instead of `100%`/`100vh` for the app shell (100% is relative to parent, not the real viewport, in standalone mode — a documented top iOS-PWA bug); pad the bottom tab bar and floating compose button with `env(safe-area-inset-bottom)`; pad the top ask-bar with `env(safe-area-inset-top)` only when `display-mode: standalone` (Safari tabs already reserve that space, standalone doesn't).
**Effort:** S (CSS-only, but must be threaded through every fixed element — treat as a checklist, not a one-off).

### 8. Add-to-Home-Screen nudge, not a native install prompt
**What:** iOS has no `beforeinstallprompt` API (Chrome/Android-only); PWAs on iOS must instruct users through Safari's manual Share → Add to Home Screen flow, and as of iOS 26 a site added this way opens as a full-screen web app by default even without a manifest.
**Why it works / constraint:** There is no way to trigger a native install banner on iOS. The only lever omnis has is a well-timed in-app instructional card.
**Implementation for omnis:** Detect `navigator.standalone === false` + iOS UA, show a dismissible one-time card ("Add omnis to your Home Screen for the full experience — push notifications require this") with a 3-step visual (Share icon → Add to Home Screen → Add), not a fake "Install" button. Re-show at most once per session, never as a blocking modal.
**Effort:** S.

### 9. Push notifications gated on home-screen install (and EU carve-out)
**What:** iOS 16.4+ supports Web Push, but only for PWAs already added to the Home Screen — a page open in a Safari tab cannot register push, and (per current reporting) PWAs opened inside the EU may not get push at all due to DMA-driven browser-engine changes.
**Why it works / constraint:** This is a hard platform gate, not a UX choice — omnis cannot get iOS push without the user completing step 8 first.
**Implementation for omnis:** Make the Add-to-Home-Screen card in #8 a hard prerequisite gate in the push-permission flow copy ("Notifications need omnis on your Home Screen first — [show me how]"), and don't request `Notification.requestPermission()` until `navigator.standalone` is true. For blocked-agent alerts specifically (the highest-priority push case per DESIGN-DIRECTION.md), have a non-push fallback: badge count on the home-screen icon (works without push, via Badging API where supported) and rely on next-app-open surfacing blocked items at the top of the list.
**Effort:** S (gating logic) + M (badge API integration, best-effort).

### 10. Frosted/glass bottom chrome over opaque content (not glass everywhere)
**What:** Linear's 2025 mobile redesign uses a custom frosted-glass material specifically for navigation chrome (bottom toolbar), while message/list content stays opaque, matching what they say they deliberately kept from Apple's Liquid Glass rather than adopting it wholesale.
**Why it works:** Validates the DESIGN-DIRECTION.md rule already set for omnis ("Liquid Glass only on sidebar/toolbar/sheet/palette/floating panel, list and body content opaque") — an independent real product converged on the same split, on mobile specifically, which is direct evidence the rule survives the responsive transition instead of needing to change.
**Implementation for omnis:** No new work — confirms the existing desktop rule (glass on rail/ask-bar/sheets, opaque list rows) should carry through unchanged to the bottom-tab-bar and sheet components described above, rather than needing a separate mobile design decision.
**Effort:** — (validates existing decision, zero new effort).

## Patterns to avoid

- **True native interactive widgets / Live Activities / rich push actions.** Not achievable from a pure PWA on iOS — no WidgetKit, no APNs rich actions, background execution is severely limited. Don't design a v1 mobile flow around these; they require a native wrapper (Tauri iOS or similar) which is out of scope for now.
- **Native "Install App" banner mimicry.** Don't build a fake install button that looks like Android's `beforeinstallprompt` banner — it can't function the same way on iOS and misleads users about what tapping it does. Use the instructional card pattern (#8) instead.
- **Relying on `100vh`/`100%` for full-screen layout.** The single most cited iOS-PWA bug across sources — content gets clipped or scrolls under system chrome in standalone mode. Use `100dvh` (or `100svh` for the always-safe minimum) everywhere the app shell needs full height.
- **Edge-only swipe-to-go-back as the *only* back gesture.** Fine as a secondary/OS-native path, but making it the sole way back forces precise edge hits — pair with the anywhere-swipe pattern (#1).
- **Assuming EU push parity with US/rest-of-world.** Current reporting says EU-served PWAs may lose push entirely under DMA browser-engine rules; don't promise push notifications uniformly in copy — check the user's region-observed behavior before hard-gating features on it.

## Open questions

- Does omnis's mobile PWA target only Safari/WebKit-standalone, or does it also need to work reasonably inside Chrome-for-iOS (still WebKit-backed, same limits) and non-iOS Android PWA (which *does* get `beforeinstallprompt` and full push) — the install/push copy in #8/#9 needs an Android branch if Android is in scope at all.
- Is a native wrapper (Tauri mobile, or a thin Capacitor/native shim) on the roadmap at all, which would unlock #6 (interactive widgets) and richer push — worth flagging to Logan as a fork point rather than assuming PWA-only forever.
- What is the actual mobile breakpoint where the channel rail becomes a bottom tab bar (#5) — needs a concrete pixel value tied to the existing Tauri desktop min-width, not just "iPhone vs desktop."
- Confirm whether the Badging API fallback in #9 is supported in iOS standalone PWA today (support has been inconsistent release to release) before relying on it as the no-push mitigation for blocked-agent alerts.
