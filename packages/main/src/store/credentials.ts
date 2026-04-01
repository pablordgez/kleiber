import type { RemoteApiCredentials } from "@kleiber/shared";

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(cipherText: Buffer): string;
}

export function encryptCredentials(
  credentials: RemoteApiCredentials,
  safeStorageAdapter: SafeStorageAdapter,
): string {
  if (!safeStorageAdapter.isEncryptionAvailable()) {
    throw new Error("safeStorage encryption is not available on this system.");
  }

  return safeStorageAdapter.encryptString(JSON.stringify(credentials)).toString("base64");
}

export function decryptCredentials(
  encryptedValue: string | null | undefined,
  safeStorageAdapter: SafeStorageAdapter,
): RemoteApiCredentials | null {
  if (!encryptedValue || !safeStorageAdapter.isEncryptionAvailable()) {
    return null;
  }

  try {
    const decrypted = safeStorageAdapter.decryptString(Buffer.from(encryptedValue, "base64"));
    return JSON.parse(decrypted) as RemoteApiCredentials;
  } catch {
    return null;
  }
}
