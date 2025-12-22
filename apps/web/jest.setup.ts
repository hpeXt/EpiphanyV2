import "@testing-library/jest-dom";
import { webcrypto } from "crypto";
import { TextDecoder, TextEncoder } from "util";

type Listener = (event: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;

  private listeners: Map<string, Set<Listener>> = new Map();

  constructor(url: string | URL, init?: { withCredentials?: boolean }) {
    this.url = url.toString();
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    const existing = this.listeners.get(type) ?? new Set();
    existing.add(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: Listener) {
    const existing = this.listeners.get(type);
    if (!existing) return;
    existing.delete(listener);
  }

  close() {
    // no-op for tests
  }

  emitMessage(data: string) {
    const event = { data } as MessageEvent;
    for (const listener of this.listeners.get("message") ?? []) {
      listener(event);
    }
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

if (!("EventSource" in globalThis)) {
  (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource =
    MockEventSource;
}

if (!("TextEncoder" in globalThis)) {
  (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
}

if (!("TextDecoder" in globalThis)) {
  (globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
}

if (!("crypto" in globalThis)) {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}

if (!globalThis.crypto.subtle) {
  (globalThis.crypto as unknown as { subtle: SubtleCrypto }).subtle =
    webcrypto.subtle as unknown as SubtleCrypto;
}

if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
}

// ProseMirror/Tiptap relies on elementFromPoint for selection logic; jsdom doesn't implement it.
// Patch both the instance and prototype so documents created by libraries still work.
if (typeof Document !== "undefined" && !Document.prototype.elementFromPoint) {
  Document.prototype.elementFromPoint = function elementFromPoint() {
    return this.body;
  } as unknown as typeof Document.prototype.elementFromPoint;
}
if (!document.elementFromPoint) {
  document.elementFromPoint = () => document.body;
}

// ProseMirror also expects DOMRect APIs on nodes/ranges for selection/scroll logic.
function createMockDomRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => "",
  } as DOMRect;
}

if (typeof Range !== "undefined") {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [createMockDomRect()] as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => createMockDomRect();
  }
}

if (typeof Text !== "undefined") {
  if (!(Text.prototype as any).getClientRects) {
    (Text.prototype as any).getClientRects = () => [createMockDomRect()];
  }
  if (!(Text.prototype as any).getBoundingClientRect) {
    (Text.prototype as any).getBoundingClientRect = () => createMockDomRect();
  }
}
