import type { CSSProperties, ReactNode } from "react";

type Props = {
  title: string;
  titleTestId?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function CallingCard({ title, titleTestId, children, className = "", style }: Props) {
  return (
    <div
      className={[
        "w-[280px]",
        "rounded-lg border border-border/60 bg-card text-card-foreground shadow-lg",
        className,
      ].join(" ")}
      style={{
        ...style,
      }}
    >
      <div className="border-b border-border/60 px-4 py-3">
        <div
          data-testid={titleTestId}
          className="text-sm font-medium text-foreground"
        >
          {title}
        </div>
      </div>

      <div className="space-y-2 px-4 py-3 text-xs text-muted-foreground">{children}</div>
    </div>
  );
}
