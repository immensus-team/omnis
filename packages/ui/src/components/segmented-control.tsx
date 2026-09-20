import { cn } from "../lib/cn.js";

/** US-D03: the segmented control from ref-dashboard-detail-card.webp ("Price | PPSF" above the
 *  chart) — two or three fixed views of one object, one of them always active. Used by the thread
 *  detail header (Conversation / Summary / Notes).
 *
 *  It is a radiogroup rather than a tablist: the segments switch between views of the same thread
 *  and the panels do not exist simultaneously, so the arrow-key/`aria-selected` tab pattern would
 *  promise a roving tabindex this control does not implement. The inbox view pills (A5 §2.1) made
 *  the same call for the same reason. */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. Without it a screen reader announces "radio button, 1 of 3"
   *  with nothing saying what is being chosen. */
  label: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("segmented-control", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          // biome-ignore lint/a11y/useSemanticElements: the same call the inbox view pills made — an <input type="radio"> cannot render a shaped segment inside a track.
          role="radio"
          aria-checked={value === option.value}
          className="segmented-control__segment"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
