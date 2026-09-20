import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-[var(--accent)] text-[var(--accent-fg)] rounded-[var(--radius-md,10px)] px-3 py-1.5",
        ghost: "bg-transparent text-[var(--text-primary)] rounded-[var(--radius-sm,6px)] px-2 py-1",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, ...rest }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant }), className)} {...rest} />
));
Button.displayName = "Button";
