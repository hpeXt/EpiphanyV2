type Variant = "text" | "title" | "card" | "avatar" | "button";

type P5SkeletonProps = {
  variant?: Variant;
  className?: string;
  /** 重复数量 */
  count?: number;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  text: "h-4 w-full",
  title: "h-8 w-3/5",
  card: "h-32 w-full",
  avatar: "h-10 w-10 rounded-full",
  button: "h-10 w-24",
};

export function P5Skeleton({
  variant = "text",
  className = "",
  count = 1,
}: P5SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  return (
    <>
      {items.map((i) => (
        <div
          key={i}
          className={[
            "animate-pulse rounded-md bg-muted",
            VARIANT_CLASSES[variant],
            className,
          ].join(" ")}
          role="status"
          aria-label="加载中"
        />
      ))}
    </>
  );
}

/** 组合骨架：卡片内容 */
export function P5SkeletonCard() {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4 shadow-sm">
      <P5Skeleton variant="title" />
      <P5Skeleton variant="text" />
      <P5Skeleton variant="text" className="w-4/5" />
      <div className="flex items-center gap-2 pt-2">
        <P5Skeleton variant="avatar" />
        <P5Skeleton variant="text" className="w-24" />
      </div>
    </div>
  );
}

/** 组合骨架：列表 */
export function P5SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <P5SkeletonCard key={i} />
      ))}
    </div>
  );
}
