import {
  canonicalMessageV1,
  deriveTopicKeypair,
  generateMnemonic,
  mnemonicToMasterSeed,
  pubkeyFingerprint,
  sha256HexOfUtf8,
  signCanonicalMessageV1,
  validateMnemonic,
  verifyCanonicalMessageV1,
} from '../index.js';

function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function bytesOfHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function expectLowerHex(value: string, length: number) {
  expect(value).toHaveLength(length);
  expect(value).toEqual(value.toLowerCase());
  expect(value).toMatch(/^[0-9a-f]+$/);
}

describe('BIP39', () => {
  it('mnemonicToMasterSeed matches official BIP39 test vector (passphrase=TREZOR)', () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const seed = mnemonicToMasterSeed(mnemonic, 'TREZOR');

    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed).toHaveLength(64);
    expect(hexOf(seed)).toBe(
      'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
    );
  });

  it('mnemonicToMasterSeed is stable with default passphrase=""', () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

    const seed1 = mnemonicToMasterSeed(mnemonic);
    const seed2 = mnemonicToMasterSeed(mnemonic, '');

    expect(hexOf(seed1)).toBe(hexOf(seed2));
    expect(hexOf(seed1)).toBe(
      '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
    );
  });

  it('generateMnemonic returns valid 12/24 word mnemonic', () => {
    const m12 = generateMnemonic(12);
    const m24 = generateMnemonic(24);
    expect(m12.split(/\s+/)).toHaveLength(12);
    expect(m24.split(/\s+/)).toHaveLength(24);
    expect(validateMnemonic(m12)).toBe(true);
    expect(validateMnemonic(m24)).toBe(true);
  });
});

describe('Topic derivation (HMAC-SHA512 → Ed25519)', () => {
  it('deriveTopicKeypair matches fixture pubkey/seed', () => {
    const mnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const masterSeed = mnemonicToMasterSeed(mnemonic, '');

    const topicId = '0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11';
    const keypair = deriveTopicKeypair(masterSeed, topicId);

    expectLowerHex(keypair.privSeedHex, 64);
    expectLowerHex(keypair.pubkeyHex, 64);
    expect(keypair.privSeedHex).toBe('bd923ee263d27b04fd56910eb07dc4c883b5f860625d188e0e14e95cb81c18d6');
    expect(keypair.pubkeyHex).toBe('bc0f74935a3f33f1d2486174d9487611a65965dc2d699d7d911f84d1d4cd0cc9');
  });
});

describe('Canonical message v1', () => {
  it('uses METHOD uppercased', () => {
    const canonical = canonicalMessageV1({
      method: 'post',
      path: '/v1/topics',
      timestampMs: 1700000000000,
      nonce: 'abc',
      rawBody: null,
    });
    expect(canonical.startsWith('v1|POST|')).toBe(true);
  });

  it('PATH must not include query string', () => {
    expect(() =>
      canonicalMessageV1({
        method: 'GET',
        path: '/v1/topics?limit=1',
        timestampMs: 1,
        nonce: 'abc',
        rawBody: null,
      }),
    ).toThrow(/query/i);
  });

  it('empty body yields BODY_HASH="" and canonical ends with |', () => {
    const canonical = canonicalMessageV1({
      method: 'GET',
      path: '/v1/topics',
      timestampMs: 1700000000000,
      nonce: 'abc',
    });
    expect(canonical).toBe('v1|GET|/v1/topics|1700000000000|abc|');
    expect(canonical.endsWith('|')).toBe(true);
  });

  it('body hash comes from raw body string (not parsed JSON)', () => {
    const rawBody = '{"targetVotes":3}';
    const bodyHash = sha256HexOfUtf8(rawBody);
    expectLowerHex(bodyHash, 64);
    expect(bodyHash).toBe('a710cf2b3ca4d126a0a72fc6beb3361f095d68003f0c61d1f63ce762428858a1');

    const canonical = canonicalMessageV1({
      method: 'POST',
      path: '/v1/arguments/0193e3a6-0b7d-7a8d-9f2c-3c4d5e6f7a8b/votes',
      timestampMs: 1700000000000,
      nonce: '00010203',
      rawBody,
    });
    expect(canonical).toBe(
      'v1|POST|/v1/arguments/0193e3a6-0b7d-7a8d-9f2c-3c4d5e6f7a8b/votes|1700000000000|00010203|a710cf2b3ca4d126a0a72fc6beb3361f095d68003f0c61d1f63ce762428858a1',
    );

    const canonical2 = canonicalMessageV1({
      method: 'POST',
      path: '/v1/arguments/0193e3a6-0b7d-7a8d-9f2c-3c4d5e6f7a8b/votes',
      timestampMs: 1700000000000,
      nonce: '00010203',
      rawBody: '{\n  "targetVotes": 3\n}',
    });
    expect(canonical2).not.toBe(canonical);
  });
});

describe('Ed25519 sign/verify (v1)', () => {
  it('sign/verify works and matches fixture signature', () => {
    const privSeedHex = 'bd923ee263d27b04fd56910eb07dc4c883b5f860625d188e0e14e95cb81c18d6';
    const pubkeyHex = 'bc0f74935a3f33f1d2486174d9487611a65965dc2d699d7d911f84d1d4cd0cc9';

    const canonical =
      'v1|POST|/v1/arguments/0193e3a6-0b7d-7a8d-9f2c-3c4d5e6f7a8b/votes|1700000000000|00010203|a710cf2b3ca4d126a0a72fc6beb3361f095d68003f0c61d1f63ce762428858a1';

    const signatureBytes = signCanonicalMessageV1(bytesOfHex(privSeedHex), canonical);
    expect(signatureBytes).toBeInstanceOf(Uint8Array);
    expect(signatureBytes).toHaveLength(64);

    const signatureHex = hexOf(signatureBytes);
    expectLowerHex(signatureHex, 128);
    expect(signatureHex).toBe(
      'a1568952a961633375dc8ea9cc29378ceafec2b984bf475cd18fc2404c43e7d8e1b5a9e8a87b6fff2f9d20a40a35485fb7ec0a046b1338841fb975c302fbb30b',
    );

    const ok = verifyCanonicalMessageV1(
      bytesOfHex(pubkeyHex),
      canonical,
      signatureBytes,
    );
    expect(ok).toBe(true);

    const tampered = canonical.replace('|1700000000000|', '|1700000000001|');
    expect(
      verifyCanonicalMessageV1(
        bytesOfHex(pubkeyHex),
        tampered,
        signatureBytes,
      ),
    ).toBe(false);
  });
});

describe('UI helpers', () => {
  it('pubkeyFingerprint produces stable prefix/suffix', () => {
    const pubkeyHex = 'bc0f74935a3f33f1d2486174d9487611a65965dc2d699d7d911f84d1d4cd0cc9';
    expect(pubkeyFingerprint(pubkeyHex)).toBe('bc0f7493…0cc9');
  });
});

