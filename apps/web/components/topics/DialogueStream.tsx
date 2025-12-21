"use client";

import { useEffect, useState } from "react";

import { useChildren, type ChildrenOrderBy } from "@/components/topics/hooks/useChildren";

type Props = {
  parentArgumentId: string | null;
};

function toToggleLabel(orderBy: ChildrenOrderBy) {
  return orderBy === "totalVotes_desc" ? "最热" : "最新";
}

export function DialogueStream({ parentArgumentId }: Props) {
  const [orderBy, setOrderBy] = useState<ChildrenOrderBy>("totalVotes_desc");

  useEffect(() => {
    setOrderBy("totalVotes_desc");
  }, [parentArgumentId]);

  const children = useChildren({
    parentArgumentId,
    orderBy,
    limit: 30,
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-700">Dialogue</h2>

        {parentArgumentId ? (
          <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setOrderBy("totalVotes_desc")}
              aria-pressed={orderBy === "totalVotes_desc"}
              className={[
                "rounded-md px-2 py-1",
                orderBy === "totalVotes_desc"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-700 hover:bg-zinc-100",
              ].join(" ")}
            >
              最热
            </button>
            <button
              type="button"
              onClick={() => setOrderBy("createdAt_desc")}
              aria-pressed={orderBy === "createdAt_desc"}
              className={[
                "rounded-md px-2 py-1",
                orderBy === "createdAt_desc"
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-700 hover:bg-zinc-100",
              ].join(" ")}
            >
              最新
            </button>
          </div>
        ) : null}
      </div>

      {!parentArgumentId ? (
        <div className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          Select a node to view replies.
        </div>
      ) : null}

      {parentArgumentId && children.status === "error" ? (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {children.errorMessage}
        </div>
      ) : null}

      {parentArgumentId && children.status === "loading" ? (
        <p className="text-sm text-zinc-600">
          Loading {toToggleLabel(orderBy)}…
        </p>
      ) : null}

      {parentArgumentId && children.status === "success" ? (
        <div className="space-y-3">
          {children.items.length === 0 ? (
            <p className="text-sm text-zinc-600">No replies yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
              {children.items.map((item) => (
                <li key={item.id} className="p-3 text-sm text-zinc-800">
                  {item.label}
                </li>
              ))}
            </ul>
          )}

          {children.hasMore ? (
            <button
              type="button"
              onClick={children.loadMore}
              disabled={children.isLoadingMore}
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
            >
              加载更多
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

