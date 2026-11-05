import test from "node:test";
import assert from "node:assert/strict";
import { totp, verifyTotp, base32Encode, encrypt, decrypt, safeEqual, sha256 } from "../server/crypto.js";
import { passwordProblem, hashPassword, verifyPassword } from "../server/passwords.js";
import { parseCookies, cookieString, limiter } from "../server/http.js";

test("TOTP matches the RFC 6238 test vector and tolerates one step of drift", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totp(secret, 59_000, 30, 8), "94287082");
  assert.equal(totp(secret, 1111111109_000, 30, 8), "07081804");
  const code = totp(secret, 1_000_000_000_000);
  assert.ok(verifyTotp(secret, code, 1_000_000_000_000));
  assert.ok(verifyTotp(secret, code, 1_000_000_000_000 + 30_000), "one step later still works");
  assert.equal(verifyTotp(secret, code, 1_000_000_000_000 + 120_000), null);
  assert.equal(verifyTotp(secret, "12345", 0), null);
  assert.equal(verifyTotp(secret, "abcdef", 0), null);
});

test("the stored two-step secret is encrypted and tamper-evident", () => {
  const key = Buffer.alloc(32, 1).toString("base64");
  const blob = encrypt("JBSWY3DPEHPK3PXP", key);
  assert.ok(!blob.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(decrypt(blob, key), "JBSWY3DPEHPK3PXP");
  const parts = blob.split("."); parts[2] = Buffer.from("xxxxxxxxxxxxxxxxx").toString("base64");
  assert.throws(() => decrypt(parts.join("."), key));
  assert.throws(() => decrypt(blob, Buffer.alloc(32, 2).toString("base64")));
});

test("password rules: 12+ characters, no common passwords, not the email or name", () => {
  assert.equal(passwordProblem("short"), "too_short");
  assert.equal(passwordProblem("Password12345"), "common");
  assert.equal(passwordProblem("pass-word 1234 5"), "common");
  assert.equal(passwordProblem("aaaaaaaaaaaaaa"), "too_simple");
  assert.equal(passwordProblem("reema.haddad-2026", { email: "reema.haddad@clinic.jo" }), "contains_email");
  assert.equal(passwordProblem("Layla Nasser rocks", { name: "Layla Nasser" }), "contains_name");
  assert.equal(passwordProblem("correct horse battery"), null);
  assert.equal(passwordProblem("كلمة سر طويلة وجميلة جدا"), null);
});

test("passwords are hashed with Argon2id and verified", async () => {
  const h = await hashPassword("correct horse battery");
  assert.match(h, /^\$argon2id\$/);
  assert.ok(await verifyPassword(h, "correct horse battery"));
  assert.ok(!(await verifyPassword(h, "wrong horse battery")));
  assert.ok(!(await verifyPassword("not a hash", "x")));
  assert.notEqual(h, await hashPassword("correct horse battery"), "each hash has its own salt");
});

test("cookies, constant-time compare and the rate limiter", () => {
  assert.deepEqual(parseCookies("a=1; lc_session=abc%3D; b=2"), { a: "1", lc_session: "abc=", b: "2" });
  assert.match(cookieString("__Host-lc_session", "t", { secure: true }), /HttpOnly; SameSite=Lax; Secure/);
  assert.ok(safeEqual("abc", "abc") && !safeEqual("abc", "abd") && !safeEqual("abc", "abcd"));
  assert.equal(sha256("a").length, 64);
  let t = 0; const lim = limiter({ max: 2, windowMs: 1000, now: () => t });
  assert.deepEqual([lim("k"), lim("k"), lim("k")], [true, true, false]);
  t = 1500; assert.ok(lim("k"), "a new window starts");
});
