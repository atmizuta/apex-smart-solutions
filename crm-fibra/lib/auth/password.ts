import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

// Precomputed hash of a string that is not a real password. Comparing
// against this when a username doesn't exist keeps a "user not found"
// login attempt on the same code path (one bcrypt.compare call) as a
// "wrong password" attempt, instead of returning early.
export const DUMMY_HASH = "$2a$12$zgKsVDP.2r8DyqovfLyWCeSkTjuNREyqmHSdRbGru7eqKlzeloOw2";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
