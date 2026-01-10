"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { P5Button } from "@/components/ui/P5Button";

type ConfirmVariant = "danger" | "default";

export type P5ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
};

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: ConfirmVariant;
  resolve: (value: boolean) => void;
};

type ConfirmApi = {
  confirm: (options: P5ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmApi | null>(null);

function defaultConfirmLabel(variant: ConfirmVariant): string {
  return variant === "danger" ? "Confirm" : "OK";
}

export function P5ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const close = useCallback((value: boolean) => {
    setState((prev) => {
      prev?.resolve(value);
      return null;
    });
  }, []);

  const confirm = useCallback((options: P5ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      const variant = options.variant ?? "default";
      setState({
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? defaultConfirmLabel(variant),
        cancelLabel: options.cancelLabel ?? "Cancel",
        variant,
        resolve,
      });
    });
  }, []);

  useEffect(() => {
    if (!state) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close, state]);

  const api = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={api}>
      {children}
      {state ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={state.title}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close(false);
          }}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-lg border border-border/60 bg-card text-card-foreground shadow-lg"
          >
            <div className="border-b border-border/60 px-5 py-4">
              <div className="font-serif text-xl font-semibold text-foreground">{state.title}</div>
            </div>

            <div className="space-y-4 px-5 py-5 text-foreground">
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{state.message}</p>

              <div className="flex flex-wrap justify-end gap-2">
                <P5Button type="button" onClick={() => close(false)} size="sm">
                  {state.cancelLabel}
                </P5Button>
                <P5Button
                  type="button"
                  onClick={() => close(true)}
                  variant={state.variant === "danger" ? "danger" : "primary"}
                  size="sm"
                  autoFocus
                >
                  {state.confirmLabel}
                </P5Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useP5Confirm(): ConfirmApi {
  const ctx = useContext(ConfirmContext);
  return (
    ctx ?? {
      confirm: async (options) => {
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
          return window.confirm(`${options.title}\n\n${options.message}`);
        }
        return false;
      },
    }
  );
}
