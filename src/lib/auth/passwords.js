import bcrypt from "bcryptjs";

const PASSWORD_ROUNDS = 12;

export async function hashPassword(value) {
  return bcrypt.hash(String(value || ""), PASSWORD_ROUNDS);
}

export async function verifyPassword(value, hash) {
  if (!value || !hash) return false;
  return bcrypt.compare(String(value), String(hash));
}
