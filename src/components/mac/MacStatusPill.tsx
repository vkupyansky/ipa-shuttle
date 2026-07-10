import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "progress";

type Props = {
  tone?: Tone;
  children: ReactNode;
};

export function MacStatusPill({ tone = "neutral", children }: Props) {
  return <span className={`statusBadge statusBadge--${tone}`}>{children}</span>;
}
