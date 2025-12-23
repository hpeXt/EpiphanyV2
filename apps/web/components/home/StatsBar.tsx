"use client";

type Props = {
  totalTopics: number;
  totalArguments: number;
  totalVotes: number;
  isLive?: boolean;
};

export function StatsBar({
  totalTopics,
  totalArguments,
  totalVotes,
  isLive = false,
}: Props) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t-[3px] border-[color:var(--rebel-red)] bg-[color:var(--ink)]/90 px-4 py-3 backdrop-blur-sm">
      <div className="mx-auto flex max-w-screen-xl flex-wrap items-center justify-center gap-6 text-[color:var(--paper)]">
        <div className="flex items-center gap-2">
          <span className="font-display text-2xl">{totalTopics}</span>
          <span className="text-sm opacity-80">活跃议题</span>
        </div>

        <div className="h-4 w-px bg-[color:var(--paper)]/30" />

        <div className="flex items-center gap-2">
          <span className="font-display text-2xl">
            {totalArguments.toLocaleString()}
          </span>
          <span className="text-sm opacity-80">观点</span>
        </div>

        <div className="h-4 w-px bg-[color:var(--paper)]/30" />

        <div className="flex items-center gap-2">
          <span className="font-display text-2xl">
            {totalVotes.toLocaleString()}
          </span>
          <span className="text-sm opacity-80">投票</span>
        </div>

        {isLive && (
          <>
            <div className="h-4 w-px bg-[color:var(--paper)]/30" />
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[color:var(--rebel-red)]" />
              <span className="text-sm opacity-80">实时更新</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
