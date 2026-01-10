"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Variant = "default" | "danger" | "success";

type P5ModalProps = {
  /** 是否显示 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 标题 */
  title: string;
  /** 变体 */
  variant?: Variant;
  /** 内容 */
  children: ReactNode;
  /** Footer（通常是按钮组） */
  footer?: ReactNode;
  /** 点击遮罩关闭 */
  closeOnOverlayClick?: boolean;
  /** 最大宽度 */
  maxWidth?: string;
};

const HEADER_VARIANT: Record<Variant, string> = {
  default: "bg-card text-card-foreground",
  danger: "bg-card text-card-foreground",
  success: "bg-card text-card-foreground",
};

export function P5Modal({
  open,
  onClose,
  title,
  variant = "default",
  children,
  footer,
  closeOnOverlayClick = true,
  maxWidth = "560px",
}: P5ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open) return;

    previousActiveElement.current = document.activeElement as HTMLElement;
    modalRef.current?.focus();

    return () => {
      previousActiveElement.current?.focus();
    };
  }, [open]);

  // 禁止背景滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnOverlayClick && e.target === e.currentTarget) {
        onClose();
      }
    },
    [closeOnOverlayClick, onClose]
  );

  if (!open) return null;

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

      {/* 内容卡片 */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full rounded-lg border border-border/60 bg-card text-card-foreground shadow-lg focus:outline-none"
        style={{ maxWidth }}
      >
        {/* 标题栏 */}
        <div
          className={`
            flex items-center justify-between px-5 py-4
            border-b border-border/60
            ${HEADER_VARIANT[variant]}
          `}
        >
          <h2 id="modal-title" className="font-serif text-xl font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-border/60 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  // Portal 到 body
  if (typeof window === "undefined") return null;
  return createPortal(modal, document.body);
}
