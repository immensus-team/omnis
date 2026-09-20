import type { GlassSlot } from "@omnis/ui";
import { GlassSurface, OpaqueSurface } from "@omnis/ui";
import type { ReactNode } from "react";

const SLOTS: GlassSlot[] = ["sidebar", "toolbar", "sheet", "palette"];

/** .glass-surface is only `backdrop-filter` + `--bg-overlay` + hairline border — no intrinsic
 *  size and nothing to blur on its own, so each one sits on a saturated parent here.
 *  Neither surface takes a `style` prop (className only), hence the wrapper. */
function OnAccent({ children }: { children: ReactNode }) {
  return <div style={{ background: "var(--accent)", padding: 24, marginBottom: 8 }}>{children}</div>;
}

export function GlassSurfaceDemo() {
  return (
    <div>
      {SLOTS.map((slot) => (
        <OnAccent key={slot}>
          <GlassSurface slot={slot} className="gallery-variant">
            glass — {slot}
          </GlassSurface>
        </OnAccent>
      ))}
      <OnAccent>
        <OpaqueSurface className="gallery-variant">opaque — content layer</OpaqueSurface>
      </OnAccent>
    </div>
  );
}
