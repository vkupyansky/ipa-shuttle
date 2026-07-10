import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export const MacButton = forwardRef<HTMLButtonElement, Props>(function MacButton(
  { children, variant = "primary", className = "", ...props },
  ref
) {
  return (
    <button ref={ref} className={`button button--${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
});
