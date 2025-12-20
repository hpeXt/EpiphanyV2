const HEX_ALPHABET = '0123456789abcdef';

export function utf8ToBytes(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

export function bytesToHexLower(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += HEX_ALPHABET[(byte >> 4) & 0x0f];
    hex += HEX_ALPHABET[byte & 0x0f];
  }
  return hex;
}

export function assertUint8ArrayLength(
  bytes: Uint8Array,
  expected: number,
  label: string,
): void {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  if (bytes.length !== expected) {
    throw new Error(`${label} must be ${expected} bytes (got ${bytes.length})`);
  }
}

export function assertNonEmptyString(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

export function assertDoesNotContainPipe(value: string, label: string): void {
  if (value.includes('|')) {
    throw new Error(`${label} must not include '|'`);
  }
}

