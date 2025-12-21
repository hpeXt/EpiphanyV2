import {
  authorIdFromPubkeyHex,
  canonicalMessageV1,
  deriveTopicKeypairFromMnemonic,
  mnemonicToMasterSeedHex,
} from "@/lib/identity";

describe("identity (Step 16)", () => {
  it("restores stable masterSeed from mnemonic (BIP39 test vector)", () => {
    const mnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    expect(mnemonicToMasterSeedHex(mnemonic, "TREZOR")).toBe(
      "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04",
    );
  });

  it("derives stable topic pubkey from mnemonic + topicId", () => {
    const mnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
    const keypair = deriveTopicKeypairFromMnemonic(mnemonic, topicId);

    expect(keypair.privSeedHex).toBe(
      "bd923ee263d27b04fd56910eb07dc4c883b5f860625d188e0e14e95cb81c18d6",
    );
    expect(keypair.pubkeyHex).toBe(
      "bc0f74935a3f33f1d2486174d9487611a65965dc2d699d7d911f84d1d4cd0cc9",
    );
  });

  it("builds canonical message consistent with packages/crypto (empty body ends with |)", () => {
    const canonical = canonicalMessageV1({
      method: "GET",
      path: "/v1/topics",
      timestampMs: 1700000000000,
      nonce: "abc",
    });

    expect(canonical).toBe("v1|GET|/v1/topics|1700000000000|abc|");
    expect(canonical.endsWith("|")).toBe(true);
  });

  it("derives authorId as sha256(pubkey_bytes).slice(0,16)", async () => {
    const pubkeyHex =
      "bc0f74935a3f33f1d2486174d9487611a65965dc2d699d7d911f84d1d4cd0cc9";

    await expect(authorIdFromPubkeyHex(pubkeyHex)).resolves.toBe("fd704b74dc0c1225");
  });
});

