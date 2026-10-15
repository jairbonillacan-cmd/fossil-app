import type { HTMLAttributes } from "react";

export type WordmarkProps = HTMLAttributes<HTMLSpanElement>;

/** Provisional brand wordmark "Fossil" in Inter Semibold (docs/DESIGN.md). */
export function Wordmark({ className, ...rest }: WordmarkProps) {
  const classes = ["fui-wordmark", className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      Fossil
    </span>
  );
}
