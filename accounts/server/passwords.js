// Argon2id hashing and the password rules (design §3.5): 12+ characters, nothing on the common list, no composition rules.
import { hash, verify } from "@node-rs/argon2";
import { readFileSync } from "node:fs";

const COMMON = new Set(
  readFileSync(new URL("./common-passwords.txt", import.meta.url), "utf8").split(/\r?\n/).map((s) => squash(s)).filter(Boolean),
);
function squash(s) { return s.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]/g, ""); }

// Argon2id is the library default (algorithm 2). Parameters: 19 MiB, 2 passes, per OWASP's minimum.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (pw) => hash(pw, OPTS);
export const verifyPassword = (stored, pw) => verify(stored, pw).catch(() => false);

// A hash of a random value, so an unknown email costs the same time as a wrong password.
export const DUMMY_HASH = await hash(`dummy-${Math.random()}-${Date.now()}`, OPTS);

// Returns an error code or null.
export function passwordProblem(pw, { email = "", name = "" } = {}) {
  if (typeof pw !== "string" || [...pw].length < 12) return "too_short";
  if (pw.length > 200) return "too_long";
  const s = squash(pw);
  if (COMMON.has(s)) return "common";
  const local = squash(email.split("@")[0] || "");
  if (local.length >= 4 && s.includes(local)) return "contains_email";
  const nm = squash(name);
  if (nm.length >= 5 && s.includes(nm)) return "contains_name";
  if (new Set(s).size <= 3) return "too_simple";
  return null;
}
