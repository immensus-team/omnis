export const TYPE_SCALE = {
  xs: { size: "12px", leading: "16px" },
  sm: { size: "13px", leading: "18px" },
  base: { size: "14px", leading: "20px" },
  lg: { size: "16px", leading: "24px" },
  xl: { size: "20px", leading: "26px" },
  "2xl": { size: "26px", leading: "32px" },
} as const;

export const SPACE = { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 16: "96px" } as const;
export const RADIUS = { sm: "6px", md: "10px", lg: "16px", full: "999px" } as const;
export const DURATION = { fast: "100ms", base: "160ms", slow: "400ms" } as const;
export const EASE_SPRING = "cubic-bezier(0.2, 0, 0, 1)" as const;
export const EASE_STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)" as const;
export const WEIGHT = { regular: 400, medium: 510, semibold: 590 } as const;
