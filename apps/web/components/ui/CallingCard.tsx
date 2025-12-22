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
        "w-[240px]",
        "border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)]",
        "shadow-[var(--p5-shadow-rebel)]",
        "skew-x-[-3deg] rotate-[-0.6deg]",
        className,
      ].join(" ")}
      style={{
        transition: [
          "transform var(--p5-motion-tooltip-snap-duration) var(--p5-motion-tooltip-snap-ease)",
          "opacity var(--p5-motion-fade-in-duration) var(--p5-motion-fade-in-ease)",
        ].join(", "),
        ...style,
      }}
    >
      <div className="border-b-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--ink)] px-3 py-2 text-white">
        <div
          data-testid={titleTestId}
          className="font-mono text-xs uppercase tracking-wide"
        >
          {title}
        </div>
      </div>

      <div className="space-y-2 px-3 py-2 text-xs text-zinc-800">{children}</div>
    </div>
  );
}

