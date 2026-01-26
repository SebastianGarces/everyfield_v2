import { hash, verify } from "@node-rs/argon2";

/**
 * Hash a password using Argon2id
 * Uses recommended parameters from OWASP:
 * - Memory: 19456 KiB (19 MiB)
 * - Iterations: 2
 * - Parallelism: 1
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
}

/**
 * Verify a password against a hash
 * Returns true if the password matches, false otherwise
 */
export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(hash, password);
  } catch {
    // Invalid hash format or verification error
    return false;
  }
}
