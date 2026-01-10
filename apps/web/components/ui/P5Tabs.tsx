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
        "inline-flex rounded-md bg-muted p-1",
        className,
      ].join(" ")}
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
              "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              "disabled:opacity-60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
