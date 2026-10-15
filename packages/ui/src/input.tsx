import type { InputHTMLAttributes } from "react";

/** Props of the Fossil Input, a native input element plus an invalid state. */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Marks the field as invalid (danger border and focus ring). */
  invalid?: boolean;
}

/** Text input styled with semantic tokens. Keyboard focus is visible. */
export function Input({ invalid = false, type = "text", className, ...rest }: InputProps) {
  const classes = ["fui-input", className].filter(Boolean).join(" ");
  const aria = invalid ? ({ "aria-invalid": true } as const) : {};
  return <input type={type} className={classes} {...aria} {...rest} />;
}
