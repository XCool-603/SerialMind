import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyState({
  icon,
  title,
  desc,
  children,
}: {
  icon: string;
  title: string;
  desc: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-block">
      <Icon cp={icon} size={26} color="var(--t5)" />
      <div className="empty-title">{title}</div>
      <div className="empty-desc">{desc}</div>
      {children && (
        <div className="row gap-8" style={{ marginTop: 12 }}>
          {children}
        </div>
      )}
    </div>
  );
}
