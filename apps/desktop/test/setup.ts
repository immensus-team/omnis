// The design system's jsdom bootstrap, imported rather than copied.
//
// The gaps that file fills — ResizeObserver, Element.scrollIntoView, PointerEvent, pointer capture,
// matchMedia, Element.animate, localStorage — are properties of jsdom 25, not of any one package,
// and there is nothing in it that only packages/ui wants. The screens tested here render the design
// system's components directly (Inbox renders the chip bar and the rows; the filters sheet renders
// the sheet), so the same component that is covered in packages/ui is covered here, and a stub added
// for one suite is needed by the other in the same commit.
//
// That is not theoretical: the motion wave added matchMedia and Element.animate for
// @formkit/auto-animate, and while this file was its own copy every desktop test that rendered a
// chip bar failed with "window.matchMedia is not a function" the moment the chip bar grew one.
// A second copy is a copy that drifts — this one cannot.
//
// It is imported by specifier rather than by relative path because @omnis/ui declares its exports:
// reaching into `../../packages/ui/test/` is a path the resolver is right to refuse, and the subpath
// is now part of the package's declared surface instead.
import "@omnis/ui/test/setup";
