// The invitation and reset emails through the real mail library, to a small SMTP server on this machine.
import test from "node:test";
import assert from "node:assert/strict";
import { createMailer } from "../server/mail.js";
import { fakeSmtp, bodyOf } from "./smtp.js";

const smtp = (port) => ({ smtp: { host: "127.0.0.1", port, user: "mailer", pass: "secret", from: "Limitsiz Clinic <no-reply@limitsiz.si>" } });

test("an invitation reaches the SMTP server, signed in, in Arabic and English", async () => {
  const s = await fakeSmtp();
  try {
    await createMailer(smtp(s.port)).invite({ to: "sara@demo.jo", name: "سارة", link: "https://accounts.limitsiz.si/accept?token=abc", inviter: "Reem" });
    assert.equal(s.mails.length, 1);
    const [m] = s.mails;
    assert.deepEqual(m.auth, ["mailer", "secret"]);
    assert.equal(m.from, "no-reply@limitsiz.si");
    assert.deepEqual(m.to, ["sara@demo.jo"]);
    assert.match(m.raw, /^Subject: =\?UTF-8\?/mi);
    const text = bodyOf(m.raw);
    assert.match(text, /Hello سارة/);
    assert.match(text, /دعاك Reem/);
    assert.ok(text.includes("https://accounts.limitsiz.si/accept?token=abc"));
  } finally { await s.close(); }
});

test("a password reset reaches the SMTP server", async () => {
  const s = await fakeSmtp();
  try {
    await createMailer(smtp(s.port)).reset({ to: "sara@demo.jo", name: "Sara", link: "https://accounts.limitsiz.si/reset?token=abc" });
    assert.ok(bodyOf(s.mails[0].raw).includes("https://accounts.limitsiz.si/reset?token=abc"));
  } finally { await s.close(); }
});

test("a failed send is reported to the caller", async () => {
  const s = await fakeSmtp();
  await s.close();                                  // nothing listens on that port now
  await assert.rejects(createMailer(smtp(s.port)).send("sara@demo.jo", "Hello", "Hello"));
});

test("without SMTP settings the email is only logged", async () => {
  const lines = [];
  await createMailer({ smtp: null }, { log: (l) => lines.push(l) }).send("sara@demo.jo", "Hello", "Hello");
  assert.match(lines[0], /mail not sent/);
});
