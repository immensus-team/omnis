import type { ButtonProps } from "@omnis/ui";
import { Button } from "@omnis/ui";

/** Both variants × enabled/disabled. Ghost needs a filled parent to be legible — its own
 *  background is transparent, so it would otherwise vanish into the pane. */
const ROWS: { variant: NonNullable<ButtonProps["variant"]>; label: string }[] = [
  { variant: "primary", label: "Save" },
  { variant: "ghost", label: "Cancel" },
];

export function ButtonDemo() {
  return (
    <div style={{ background: "var(--bg-elevated)", padding: 12, borderRadius: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ROWS.map(({ variant, label }) => (
          <Button key={variant} variant={variant}>
            {label}
          </Button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {ROWS.map(({ variant, label }) => (
          <Button key={variant} variant={variant} disabled>
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
