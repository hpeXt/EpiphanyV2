import {
  generateMnemonic as scureGenerateMnemonic,
  mnemonicToSeedSync as scureMnemonicToSeedSync,
  validateMnemonic as scureValidateMnemonic,
} from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';

import type { Mnemonic } from './types.js';

export function generateMnemonic(words: 12 | 24 = 12): Mnemonic {
  const strength = words === 24 ? 256 : 128;
  return scureGenerateMnemonic(englishWordlist, strength);
}

export function validateMnemonic(mnemonic: Mnemonic): boolean {
  return scureValidateMnemonic(mnemonic, englishWordlist);
}

export function mnemonicToMasterSeed(
  mnemonic: Mnemonic,
  passphrase: string = '',
): Uint8Array {
  return scureMnemonicToSeedSync(mnemonic.normalize('NFKD'), passphrase.normalize('NFKD'));
}
