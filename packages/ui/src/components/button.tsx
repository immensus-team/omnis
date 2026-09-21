import { type VariantProps, cva } from "class-variance-authority";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md,10px)] px-3 py-1.5",
        ghost: "bg-transparent text-[var(--text-primary)] rounded-[var(--radius-sm,6px)] px-2 py-1",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, ...rest }, ref) => (
    <button
      ref={ref}
      /* The variant's own styling is Tailwind utilities, and neither of the two apps compiles
         Tailwind — so in the app the variant is a class string that resolves to nothing, and a
         primary Button comes out looking exactly like a ghost one. The attribute is the same intent
         in a form a plain stylesheet can read (app.css: the approval card's action row, where
         "Approve" has to read as the primary decision — L2-37). */
      data-variant={variant ?? "primary"}
      className={cn(buttonVariants({ variant }), className)}
      {...rest}
    />
  ),
);
Button.displayName = "Button";
