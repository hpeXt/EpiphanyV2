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

function barClass(variant: ToastVariant): string {
  if (variant === "error") return "bg-[color:var(--rebel-red)]";
  if (variant === "warn") return "bg-[color:var(--acid)] text-[color:var(--ink)]";
  if (variant === "success") return "bg-[color:var(--electric)]";
  return "bg-[color:var(--ink)]";
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
        {toasts.map((t, index) => (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            className={[
              "pointer-events-auto",
              "border-[var(--p5-border-width)] border-[color:var(--ink)] bg-[color:var(--paper)]",
              "shadow-[var(--p5-shadow-ink)]",
              index % 2 === 0 ? "rotate-[-0.6deg]" : "rotate-[0.4deg]",
            ].join(" ")}
            style={{
              clipPath:
                "polygon(0 0, calc(100% - var(--p5-cut)) 0, 100% var(--p5-cut), 100% 100%, 0 100%)",
            }}
          >
            <div
              className={[
                "flex items-center justify-between gap-3 border-b-[var(--p5-border-width)] border-[color:var(--ink)] px-3 py-2",
                barClass(t.variant),
                t.variant === "warn" ? "text-[color:var(--ink)]" : "text-[color:var(--paper)]",
              ].join(" ")}
            >
              <div className="font-mono text-xs font-semibold uppercase tracking-wide">
                {t.title}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className={[
                  "inline-flex h-7 w-7 items-center justify-center",
                  "border-[2px] border-[color:var(--ink)] bg-[color:var(--paper)] text-[color:var(--ink)]",
                  "shadow-[2px_2px_0_var(--ink)]",
                  "focus-visible:outline-none focus-visible:shadow-[var(--p5-shadow-rebel)]",
                ].join(" ")}
                aria-label="Dismiss toast"
              >
                ×
              </button>
            </div>
            <div className="px-3 py-2 text-sm text-[color:var(--ink)]">{t.message}</div>
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

