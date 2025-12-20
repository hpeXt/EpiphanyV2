export type Hex = string;
export type Mnemonic = string;
export type TopicId = string;

export type TopicKeypair = {
  pubkeyHex: Hex; // 32 bytes -> 64 chars hex (lowercase)
  privSeedHex: Hex; // 32 bytes -> 64 chars hex (lowercase)
};

export type SignInputV1 = {
  method: string;
  path: string;
  timestampMs: number;
  nonce: string;
  rawBody?: string | null;
};
