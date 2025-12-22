"use client";

type Tab<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

type Props<T extends string> = {
  value: T;
  tabs: Tab<T>[];
  onValueChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
};

export function P5Tabs<T extends string>({
  value,
  tabs,
  onValueChange,
  ariaLabel,
  className = "",
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={[
        "inline-flex overflow-hidden border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)]",
        "shadow-[var(--p5-shadow-ink)]",
        className,
      ].join(" ")}
      style={{
        clipPath:
          "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onValueChange(tab.value)}
            disabled={tab.disabled}
            aria-pressed={selected}
            className={[
              "px-3 py-1.5 text-sm font-semibold",
              "border-r-[var(--p5-border-width)] border-[color:var(--ink)] last:border-r-0",
              selected
                ? "bg-[color:var(--ink)] text-[color:var(--paper)]"
                : "text-[color:var(--ink)] hover:bg-[color:var(--concrete-200)]",
              "disabled:opacity-60",
              "focus-visible:outline-[3px] focus-visible:outline-[color:var(--rebel-red)] focus-visible:outline-offset-[-3px]",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
