export * from "./tokens.js";
export * from "./components/glass-surface.js";
export * from "./components/aurora-surface.js";
export * from "./components/button.js";
export * from "./types.js";
export * from "./components/status-badge.js";
export * from "./components/digest-card.js";
export * from "./components/draft-card.js";
export * from "./components/reply-composer.js";
export * from "./components/command-palette.js";
export * from "./components/ask-panel.js";
export * from "./lib/ask-model.js";
export * from "./lib/motion.js";
export * from "./lib/focus-trap.js";
export * from "./components/narrow-drawer.js";
export * from "./components/sheet.js";
// loop-r1-06 + motion-OSS S6: the app's one toast host. The shell's toasts are raised through it,
// which is why the request type travels with it — the app names a message and an action, never the
// library underneath or the spec the host ends up holding.
export * from "./components/toast.js";
export * from "./components/animated-list.js";
export * from "./components/confirm-prompt.js";
export * from "./lib/pointer-drag.js";
export * from "./lib/rail-order.js";
export * from "./lib/detail-pane.js";
export * from "./lib/media-query.js";
export * from "./components/approval-card.js";
export * from "./components/attachment-card.js";
export * from "./components/tool-call-badge.js";
export * from "./components/channel-rail.js";
export * from "./components/bottom-bar.js";
export * from "./components/status-pill.js";
// loop-r2-05: the shell's line about whether it can see the hub. It lives here rather than in the
// desktop app because both apps draw the same shell chrome and only one of them has a Zero socket.
export * from "./components/connection-banner.js";
export * from "./components/session-header.js";
export * from "./components/group-header.js";
export * from "./components/filter-chip-bar.js";
export * from "./components/context-menu.js";
export * from "./components/thread-toolbar.js";
export * from "./components/key-value-table.js";
export * from "./components/segmented-control.js";
export * from "./components/person-card.js";
export * from "./components/task-row.js";
export * from "./components/approval-stack.js";
// US-B33: the Settings screen names each connected account's channel and draws its mark. Both
// already exist (the rail and every inbox row render from them), so they are fronted here rather
// than copied into the app.
export { CHANNEL_LABEL } from "./lib/row-meta.js";
export * from "./components/channel-glyph.js";
export * from "./components/detail-pane.js";
export { ChevronRight as ChevronRightIcon } from "lucide-react";
export { Tag as TagIcon } from "lucide-react";
export { MoreHorizontal as MoreHorizontalIcon } from "lucide-react";
// The apps (desktop/gallery) do not depend on lucide-react directly — app screens that need an
// icon take it through @omnis/ui, the same way ChannelGlyph fronts the brand assets.
export { Archive as ArchiveIcon } from "lucide-react";
export { RotateCcw as RotateCcwIcon } from "lucide-react";
export { Reply as ReplyIcon } from "lucide-react";
export { FolderInput as FolderInputIcon } from "lucide-react";
export { Info as InfoIcon } from "lucide-react";
// US-D08 §c.3: the Mail category chips. A chip is icon + label at every width because the label is
// the half that folds away below 560px of list pane — an icon-less chip would collapse to an empty
// pill. These five are the only ones the row needs; they are aliased so the app's import sites read
// as icons rather than as bare nouns that collide with its own identifiers ("Inbox" is a screen).
export { Inbox as InboxIcon } from "lucide-react";
export { Briefcase as BriefcaseIcon } from "lucide-react";
export { User as UserIcon } from "lucide-react";
export { Bot as BotIcon } from "lucide-react";
export { Clock as ClockIcon } from "lucide-react";
