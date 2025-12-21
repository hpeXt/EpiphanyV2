"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { apiClient } from "@/lib/apiClient";

export function TopicList() {
  const [status, setStatus] = useState<"loading" | "error" | "success">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [items, setItems] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await apiClient.listTopics();
      if (cancelled) return;

      if (!result.ok) {
        setErrorMessage(result.error.message);
        setStatus("error");
        return;
      }

      setItems(result.data.items.map((t) => ({ id: t.id, title: t.title })));
      setStatus("success");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return <p className="text-sm text-zinc-600">Loading topics…</p>;
  }

  if (status === "error") {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      >
        {errorMessage}
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-zinc-600">No topics yet.</p>;
  }

  return (
    <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 bg-white">
      {items.map((topic) => (
        <li key={topic.id} className="p-3">
          <Link href={`/topics/${topic.id}`} className="hover:underline">
            {topic.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

