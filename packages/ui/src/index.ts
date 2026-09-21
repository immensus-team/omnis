export * from "./tokens.js";
export * from "./components/glass-surface.js";
export * from "./components/aurora-surface.js";
export * from "./components/button.js";
export * from "./types.js";
export * from "./components/status-badge.js";
export * from "./components/draft-card.js";
export * from "./components/command-palette.js";
export * from "./components/ask-panel.js";
export * from "./lib/ask-model.js";
export * from "./lib/motion.js";
export * from "./lib/focus-trap.js";
export * from "./components/sheet.js";
export * from "./components/confirm-prompt.js";
export * from "./lib/pointer-drag.js";
export * from "./lib/rail-order.js";
export * from "./lib/media-query.js";
export * from "./components/approval-card.js";
export * from "./components/tool-call-badge.js";
export * from "./components/channel-rail.js";
export * from "./components/bottom-bar.js";
export * from "./components/status-pill.js";
export * from "./components/group-header.js";
export * from "./components/filter-chip-bar.js";
export * from "./components/key-value-table.js";
export * from "./components/segmented-control.js";
export * from "./components/person-card.js";
export * from "./components/approval-stack.js";
export { ChevronRight as ChevronRightIcon } from "lucide-react";
export { Tag as TagIcon } from "lucide-react";
export { MoreHorizontal as MoreHorizontalIcon } from "lucide-react";
// The apps (desktop/gallery) do not depend on lucide-react directly — app screens that need an
// icon take it through @omnis/ui, the same way ChannelGlyph fronts the brand assets.
export { Archive as ArchiveIcon } from "lucide-react";
// US-D08 §c.3: the Mail category chips. A chip is icon + label at every width because the label is
// the half that folds away below 560px of list pane — an icon-less chip would collapse to an empty
// pill. These five are the only ones the row needs; they are aliased so the app's import sites read
// as icons rather than as bare nouns that collide with its own identifiers ("Inbox" is a screen).
export { Inbox as InboxIcon } from "lucide-react";
export { Briefcase as BriefcaseIcon } from "lucide-react";
export { User as UserIcon } from "lucide-react";
export { Bot as BotIcon } from "lucide-react";
export { Clock as ClockIcon } from "lucide-react";
