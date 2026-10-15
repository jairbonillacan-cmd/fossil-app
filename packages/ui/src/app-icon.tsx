import type { HTMLAttributes } from "react";

export type AppIconProps = HTMLAttributes<HTMLSpanElement>;

/** Provisional app icon: an "F" in a square filled with the accent token. */
export function AppIcon({ className, ...rest }: AppIconProps) {
  const classes = ["fui-app-icon", className].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-hidden="true" {...rest}>
      F
    </span>
  );
}
