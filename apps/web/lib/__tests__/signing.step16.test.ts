import { mnemonicToMasterSeedHex } from "@/lib/identity";
import { createLocalStorageKeyStore, createV1Signer } from "@/lib/signing";

describe("signing + keystore (Step 16)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores the same topic pubkey after clearing storage and re-importing the same mnemonic", async () => {
    const mnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    const topicId = "0193e3a6-0b7d-7a8d-9f2c-2f3aa3ad1a11";
    const masterSeedHex = mnemonicToMasterSeedHex(mnemonic);

    const store1 = createLocalStorageKeyStore();
    store1.setMasterSeedHex(masterSeedHex);
    const signer1 = createV1Signer(store1);

    const headers1 = await signer1.signV1(topicId, {
      method: "GET",
      path: `/v1/topics/${topicId}/ledger/me`,
      rawBody: null,
    });

    window.localStorage.clear();

    const store2 = createLocalStorageKeyStore();
    store2.setMasterSeedHex(masterSeedHex);
    const signer2 = createV1Signer(store2);

    const headers2 = await signer2.signV1(topicId, {
      method: "GET",
      path: `/v1/topics/${topicId}/ledger/me`,
      rawBody: null,
    });

    expect(headers2["X-Pubkey"]).toBe(headers1["X-Pubkey"]);
  });
});

