import type { ReactNode } from "react";

type Props = {
  title: string;
  children?: ReactNode;
};

export function EmptyState({ title, children }: Props) {
  return (
    <div className="emptyState">
      <strong>{title}</strong>
      {children ? <span>{children}</span> : null}
    </div>
  );
}
