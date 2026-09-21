import { FileText, Image, Link, type LucideIcon, Music, Paperclip, Video } from "lucide-react";

// US-D09 §c.5: the attachment card. One opaque card per file in the message body —
// `--bg-elevated` at `--radius-card`, never glass (ACCENT §4.4: "opaque cards, not more glass").
//
// This mirrors @omnis/protocol's Attachment rather than importing it, the same package-boundary
// call approval-card.tsx makes for HumanInterrupt: packages/ui does not depend on
// packages/protocol, so the shape it renders is restated here and the two are kept in step by the
// compiler at the call site (Thread.tsx passes what items.attachments actually holds).

export type AttachmentKind = "image" | "file" | "audio" | "video" | "link";

export interface AttachmentItem {
  kind: AttachmentKind;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  caption?: string;
}

const ATTACHMENT_ICON: Record<AttachmentKind, LucideIcon> = {
  image: Image,
  file: FileText,
  audio: Music,
  video: Video,
  link: Link,
};

/** protocol's Attachment has no filename field, so the label is the caption when there is one and
 *  the URL's last path segment otherwise — a bare "Attachment" for every file makes a card that
 *  says nothing the paperclip did not already say.
 *
 *  Only a *path* segment counts. A URL that is all host ("https://example.com", which a `link`
 *  attachment to a page is) has no filename in it, and printing the host would name the card after
 *  the sender's domain. */
export function attachmentName(attachment: AttachmentItem): string {
  if (attachment.caption) return attachment.caption;
  const bare =
    (attachment.url ?? "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[?#]/)[0] ?? "";
  const slash = bare.indexOf("/");
  if (slash === -1) return "Attachment";
  const last = bare
    .slice(slash + 1)
    .split("/")
    .filter(Boolean)
    .pop();
  return last ? decodeURIComponent(last) : "Attachment";
}

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Binary units (1024), because that is the number a file manager shows for the same file. One
 *  decimal above KB and a trailing `.0` dropped: "18 KB", "1.2 MB", "2 MB". */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return `${shown} ${SIZE_UNITS[unit]}`;
}

/** The size line under the name, and the only place a missing size is decided: no `sizeBytes` means
 *  no line, not "0 B" — an unknown size and a zero-byte file are different claims. */
export function AttachmentCardView({ attachment }: { attachment: AttachmentItem }) {
  const Icon = ATTACHMENT_ICON[attachment.kind] ?? Paperclip;
  const name = attachmentName(attachment);
  return (
    <div className="attachment-card">
      <span className="attachment-card__icon" aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <span className="attachment-card__text">
        <span className="attachment-card__name">{name}</span>
        {attachment.sizeBytes !== undefined && (
          <span className="attachment-card__size">{formatBytes(attachment.sizeBytes)}</span>
        )}
      </span>
    </div>
  );
}
