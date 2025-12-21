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
