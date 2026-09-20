import type { ComponentType } from "react";
import { ApprovalCardDemo } from "./approval-card.js";
import { ButtonDemo } from "./button.js";
import { ChannelGlyphDemo } from "./channel-glyph.js";
import { ChannelRailDemo } from "./channel-rail.js";
import { CommandPaletteDemo } from "./command-palette.js";
import { DraftCardDemo } from "./draft-card.js";
import { GlassSurfaceDemo } from "./glass-surface.js";
import { InboxRowDemo } from "./inbox-row.js";
import { StatusBadgeDemo } from "./status-badge.js";
import { ToolCallBadgeDemo } from "./tool-call-badge.js";

/** id -> demo component, keyed to registry.ts's GALLERY_COMPONENTS ids.
 * Each demo is rendered twice by App.tsx (once per light/dark pane) — a demo component
 * must not carry state that breaks when mounted twice side by side (each gets its own). */
export const GALLERY_DEMOS: Record<string, ComponentType> = {
  button: ButtonDemo,
  "glass-surface": GlassSurfaceDemo,
  "channel-glyph": ChannelGlyphDemo,
  "status-badge": StatusBadgeDemo,
  "tool-call-badge": ToolCallBadgeDemo,
  "channel-rail": ChannelRailDemo,
  "command-palette": CommandPaletteDemo,
  "draft-card": DraftCardDemo,
  "approval-card": ApprovalCardDemo,
  "inbox-row": InboxRowDemo,
};
