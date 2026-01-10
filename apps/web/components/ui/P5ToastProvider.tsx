"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type ToastVariant = "info" | "success" | "warn" | "error";

export type P5ToastInput = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type Toast = Required<Pick<P5ToastInput, "message">> & {
  id: string;
  createdAt: number;
  title: string;
  variant: ToastVariant;
  durationMs: number;
};

type ToastApi = {
  toast: (input: P5ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

const ToastContext = createContext<ToastApi | null>(null);

function randomId(): string {
  const alphabet = "0123456789abcdef";
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  let out = "";
  for (const b of bytes) {
    out += alphabet[(b >> 4) & 15];
    out += alphabet[b & 15];
  }
  return out || String(Date.now());
}

function titleForVariant(variant: ToastVariant): string {
  if (variant === "error") return "error";
  if (variant === "warn") return "warning";
  if (variant === "success") return "success";
  return "info";
}

function dotClass(variant: ToastVariant): string {
  if (variant === "error") return "bg-destructive";
  if (variant === "warn") return "bg-[color:var(--chart-2)]";
  if (variant === "success") return "bg-[color:var(--chart-3)]";
  return "bg-accent";
}

export function P5ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeouts = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timeoutId = timeouts.current.get(id);
    if (timeoutId) window.clearTimeout(timeoutId);
    timeouts.current.delete(id);
  }, []);

  const clear = useCallback(() => {
    setToasts([]);
    for (const timeoutId of timeouts.current.values()) {
      window.clearTimeout(timeoutId);
    }
    timeouts.current.clear();
  }, []);

  const toast = useCallback(
    (input: P5ToastInput) => {
      const id = randomId();
      const variant = input.variant ?? "info";
      const next: Toast = {
        id,
        createdAt: Date.now(),
        title: input.title ?? titleForVariant(variant),
        message: input.message,
        variant,
        durationMs: input.durationMs ?? (variant === "error" ? 8_000 : 4_000),
      };

      setToasts((prev) => {
        const nextList = [next, ...prev].slice(0, 4);
        const evicted = prev.slice(3);
        for (const t of evicted) {
          const timeoutId = timeouts.current.get(t.id);
          if (timeoutId) window.clearTimeout(timeoutId);
          timeouts.current.delete(t.id);
        }
        return nextList;
      });

      const timeoutId = window.setTimeout(() => dismiss(id), next.durationMs);
      timeouts.current.set(id, timeoutId);

      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    return () => clear();
  }, [clear]);

  const api = useMemo(() => ({ toast, dismiss, clear }), [toast, dismiss, clear]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions text"
        className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            className={[
              "pointer-events-auto",
              "overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-lg",
            ].join(" ")}
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <span
                aria-hidden
                className={["mt-1.5 h-2 w-2 rounded-full", dotClass(t.variant)].join(" ")}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{t.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t.message}</div>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Dismiss toast"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useP5Toast(): ToastApi {
  const ctx = useContext(ToastContext);
  return (
    ctx ?? {
      toast: () => "",
      dismiss: () => {},
      clear: () => {},
    }
  );
}
