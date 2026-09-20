import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useState } from "react";
import { LuSearch } from "react-icons/lu";

/** US-D02: the filter chip bar laid over the list (the filter-DSL chips in
 *  ref-issue-tracker-density.webp). A chip splits into a field cell and a value cell — it never
 *  takes a whole sentence. What is being filtered on (channel, label) is still the caller's
 *  decision: Tasks and Needs-approval use this same bar alongside Inbox. */

export interface FilterChipOption {
  id: string;
  label: string;
}

export interface FilterChip {
  id: string;
  /** The left (pale) cell = what is being filtered on. The chip's x takes its accessible name
   *  from this too. For example: "Label". */
  field: string;
  /** The right (tinted) cell = what it is filtered to, as a finished phrase including any
   *  quantifier. For example: "any of 2". */
  value: string;
  onRemove: () => void;
}

export interface FilterChipBarProps {
  chips: FilterChip[];
  /** The field this bar can create new chips for. Without it the "+" trigger is not drawn at all
   *  — there is nothing to add. */
  addOptions?: {
    fieldLabel: string;
    options: FilterChipOption[];
    selectedIds: string[];
    onToggle: (id: string) => void;
  };
}

export function FilterChipBar({ chips, addOptions }: FilterChipBarProps) {
  return (
    // The reference's chip is `[Priority][is any of][2 priorities][x]` — the fills alternate cell
    // by cell, with only the middle operator cell pale. Here the operator is folded into the value
    // phrase, so there are two cells rather than three. The alternating fill carries over: the
    // field cell pale, the value cell tinted — what matters is that the chip does not collapse
    // into one undifferentiated tag.
    <div className="filter-chip-bar">
      {chips.map((chip) => (
        <span key={chip.id} className="filter-chip">
          <span className="filter-chip__field">{chip.field}</span>
          <span className="filter-chip__value">{chip.value}</span>
          <button
            type="button"
            // The brief said just "remove filter", but with more than one chip every x would
            // share that accessible name and a screen reader could not tell them apart — so the
            // field name goes in front.
            aria-label={`Remove ${chip.field} filter`}
            onClick={chip.onRemove}
          >
            ×
          </button>
        </span>
      ))}
      {addOptions && <AddFilterPopover {...addOptions} />}
    </div>
  );
}

/** The chip-editing popover. Radix Popover places it and cmdk owns the list and the search — this
 *  repo already has exactly one searchable-list grammar (CommandPalette) and does not grow a
 *  second. Styling puts glass-surface straight on Popover.Content: a floating panel is glass
 *  (DESIGN-DIRECTION.md, Liquid Glass on floating panels only). */
function AddFilterPopover({
  fieldLabel,
  options,
  selectedIds,
  onToggle,
}: NonNullable<FilterChipBarProps["addOptions"]>) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedIds);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="filter-chip-bar__add"
          // In a narrow list pane the label word disappears and only the "+" is left (app.css
          // @container list). An explicit aria-label plus a native tooltip keep the name through
          // that collapse — the accessible name comes from this aria-label, never from the text
          // that may or may not be on screen.
          aria-label={`Add ${fieldLabel} filter`}
          title={fieldLabel}
        >
          <span aria-hidden="true">+</span>
          <span className="filter-chip-bar__add-label">{fieldLabel}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="glass-surface filter-chip-popover"
          data-glass-slot="palette"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Command label={`${fieldLabel} filter`}>
            {/* The same input chrome as the reference's filter popover: a magnifier and one
                hairline below. A bare placeholder is just grey text floating over a list and does
                not read as a field. */}
            <div className="filter-chip-popover__search">
              <LuSearch aria-hidden="true" />
              <Command.Input placeholder={`Search ${fieldLabel}`} autoFocus />
            </div>
            <Command.List>
              <Command.Empty>No results</Command.Empty>
              {options.map((option) => (
                <Command.Item
                  key={option.id}
                  // Multi-select: picking does not close the popover (the reference's checkbox
                  // list stays open through repeated clicks). The absence of any code touching
                  // `open` here is that behaviour.
                  onSelect={() => onToggle(option.id)}
                  data-checked={selected.has(option.id) ? "true" : undefined}
                >
                  <span className="filter-chip-popover__check" aria-hidden="true">
                    {selected.has(option.id) ? "✓" : ""}
                  </span>
                  <span>{option.label}</span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
