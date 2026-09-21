// @vitest-environment jsdom
// US-D09 §c.5: the attachment card. Setup is declared by the file (see sheet.test.tsx).
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AttachmentCardView, attachmentName, formatBytes } from "../src/components/attachment-card";

describe("attachmentName (US-D09 §c.5)", () => {
  it("prefers the caption, because that is the field the sender wrote", () => {
    expect(
      attachmentName({ kind: "file", url: "https://x.test/a/q3.pdf", caption: "Q3 numbers" }),
    ).toBe("Q3 numbers");
  });

  it("falls back to the URL's last path segment, decoded", () => {
    expect(attachmentName({ kind: "file", url: "https://x.test/files/Q3%20report.pdf" })).toBe(
      "Q3 report.pdf",
    );
    // A query string is not part of the name — Dropbox-style links carry the whole file in one.
    expect(attachmentName({ kind: "image", url: "https://x.test/i/pic.png?dl=1" })).toBe("pic.png");
  });

  it("says the noun rather than the host when there is no path to name", () => {
    expect(attachmentName({ kind: "link", url: "https://x.test" })).toBe("Attachment");
    expect(attachmentName({ kind: "link" })).toBe("Attachment");
  });
});

describe("formatBytes (US-D09 §c.5)", () => {
  it("stays in bytes below 1 KiB, with no decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("uses binary units and one decimal above bytes, dropping a trailing .0", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(18 * 1024)).toBe("18 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1.25 * 1024 * 1024)).toBe("1.3 MB");
  });
});

describe("AttachmentCardView (US-D09 §c.5)", () => {
  it("shows the name and the size on the card", () => {
    render(
      <AttachmentCardView attachment={{ kind: "file", caption: "NDA.pdf", sizeBytes: 18432 }} />,
    );
    expect(screen.getByText("NDA.pdf")).toBeInTheDocument();
    expect(screen.getByText("18 KB")).toBeInTheDocument();
  });

  it("leaves the size line out rather than claiming 0 B", () => {
    // An unknown size and an empty file are different claims, and the card only knows the first.
    render(<AttachmentCardView attachment={{ kind: "link", caption: "example.com/page" }} />);
    expect(screen.getByText("example.com/page")).toBeInTheDocument();
    expect(screen.queryByText(/B$/)).not.toBeInTheDocument();
  });

  it("marks the kind icon decorative — the filename is the label", () => {
    const { container } = render(
      <AttachmentCardView attachment={{ kind: "image", caption: "p.png" }} />,
    );
    expect(container.querySelector(".attachment-card__icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("falls back to a neutral icon for a kind the data does not have", () => {
    // items.attachments is jsonb — what arrives is not typechecked, so an unknown kind must draw a
    // card rather than crash the screen it is in.
    const { container } = render(
      <AttachmentCardView
        attachment={{ kind: "spreadsheet" as unknown as "file", caption: "book.xlsx" }}
      />,
    );
    expect(container.querySelector(".attachment-card__icon svg")).not.toBeNull();
  });
});
