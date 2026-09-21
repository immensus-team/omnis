// US-D10 §c.5: the detail pane's width — the arithmetic, in one place, away from the DOM.
//
// Everything here is pure and total: the grip's drag, its arrow keys and the setting read back off
// the hub all have to answer the same question ("what width is the pane now?"), and three call
// sites computing it three ways is how the drag and the keyboard end up disagreeing by a pixel.
// The component owns the pointer and the focus; this file owns the numbers.

/** The settings keys, as the hub's settings KV spells them (packages/kernel/src/settings.ts).
 *  They are here rather than in the app's api layer because the same two strings have to reach the
 *  GET/PUT calls and the tests that read them back. */
export const DETAIL_WIDTH_KEY = "ui.detail_width";
export const DETAIL_COLLAPSED_KEY = "ui.detail_collapsed";

/** The narrowest the pane may be dragged to. Below this the conversation column starts breaking
 *  words it would otherwise wrap, which is the point at which "resizable" stops being a feature. */
export const DETAIL_MIN_WIDTH = 320;

/** What the pane measures when `ui.detail_width` has never been written.
 *
 *  It is the same 420px the narrow tier's sheet has always been, which is the point: the column and
 *  the sheet open at one size, so collapsing and re-expanding the pane (or dragging it and
 *  double-clicking to reset) never changes how wide the conversation is. The settings value stays
 *  `null` until the user drags — a stored number means "the user chose this", and a fresh install
 *  should keep following the shell's own default. */
export const DETAIL_DEFAULT_WIDTH = 420;

/** One arrow-key press on the grip. 16px is the pointer's own granularity — a step small enough
 *  that a keyboard user can land on the same widths a drag lands on. */
export const DETAIL_STEP_PX = 16;

/** How much of the travel past a limit the pane actually takes while a drag is running. The pane
 *  keeps following the pointer past both ends (so the gesture never feels stuck) at a third of the
 *  distance (so it reads as a limit rather than as a wall). On release the caller clamps, and the
 *  pane springs back to the limit — the spring is app.css's, not this file's: `.app-shell__detail`
 *  carries `transition: width var(--dur-move) var(--ease-settle)`, which is the `--ease-settle` this
 *  sentence names, and `.app-shell--detail-dragging` switches it off for the length of the gesture so
 *  the band itself stays one-to-one with the pointer. This function only says *where* the band is;
 *  it deliberately does not say how the pane leaves it, because that is a duration and a curve.
 *  ponytail: linear resistance, no curve. A progressive band is a nicer feel and three more lines;
 *  add it when the drag is measured to feel stiff rather than on the way in. */
const RUBBER_BAND = 0.32;

/** The widest the pane may be: half the shell. It is measured against the shell's own box rather
 *  than the window, because the shell is a container (`#root`) that the pane shares with the rail —
 *  half of the window would be more than half of the space the two columns actually have.
 *  Never below the minimum: a shell narrow enough that half of it is under 320px would otherwise
 *  have a maximum smaller than its minimum, and every clamp would flip between the two. */
export function maxDetailWidth(shellWidth: number): number {
  return Math.max(DETAIL_MIN_WIDTH, shellWidth / 2);
}

/** A committed width — what the pane settles at, and what gets written to the settings KV. */
export function clampDetailWidth(width: number, shellWidth: number): number {
  return Math.min(maxDetailWidth(shellWidth), Math.max(DETAIL_MIN_WIDTH, width));
}

/** The width *while* a drag is running: inside the limits it is the raw number, outside them it is
 *  the limit plus a third of the overshoot. */
export function draggedDetailWidth(raw: number, shellWidth: number): number {
  const max = maxDetailWidth(shellWidth);
  if (raw < DETAIL_MIN_WIDTH) return DETAIL_MIN_WIDTH - (DETAIL_MIN_WIDTH - raw) * RUBBER_BAND;
  if (raw > max) return max + (raw - max) * RUBBER_BAND;
  return raw;
}

/** The width a drag reports at `dx` from the press.
 *
 *  The grip is on the pane's **left** edge, so the sign is inverted: dragging left (a negative dx)
 *  moves that edge left and *grows* the pane. `pointerDrag` reports the pointer's travel, and a
 *  right-edge grip would subtract the other way — this is the one place that knows which edge it
 *  is, which is why the component does not do the subtraction itself. */
export function detailWidthFromDrag(startWidth: number, dx: number, shellWidth: number): number {
  return draggedDetailWidth(startWidth - dx, shellWidth);
}

/** One arrow-key press. The keyboard is not a rubber band: a key that walks past the limit stops
 *  at it, because there is no release to spring back from — a key can be held, but the last press
 *  is not a gesture that ended. */
export function steppedDetailWidth(width: number, delta: number, shellWidth: number): number {
  return clampDetailWidth(width + delta, shellWidth);
}

/** A width read off the settings row. Anything that is not a usable positive finite number —
 *  `null`, the string the seed writes before the first drag, an array from a hand-edited row —
 *  reads as "never set", which is the value the shell falls back from. */
export function readDetailWidth(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** The collapsed flag. Strictly `true`, so a missing key, a null and the string "false" all read
 *  as expanded: the pane is open until something says otherwise. */
export function readDetailCollapsed(value: unknown): boolean {
  return value === true;
}
