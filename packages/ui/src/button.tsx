import type { ButtonHTMLAttributes } from "react";

/** Visual variant of the Button. */
export type ButtonVariant = "primary" | "secondary";

/** Props of the Fossil Button, a native button element plus a variant. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Defaults to "primary". */
  variant?: ButtonVariant;
}

/** Monochrome button. Keyboard focus is visible via components.css. */
export function Button({ variant = "primary", type = "button", className, ...rest }: ButtonProps) {
  const classes = ["fui-button", `fui-button--${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
