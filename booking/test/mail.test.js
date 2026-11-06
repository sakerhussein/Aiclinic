// The nightly audit email through the real mail library, to a small SMTP server on this machine.
import test from "node:test";
import assert from "node:assert/strict";
import { createMailer } from "../server/nightly.js";
import { fakeSmtp, bodyOf } from "../../accounts/test/smtp.js";

test("the audit email reaches the SMTP server and goes to the audit address", async () => {
  const s = await fakeSmtp();
  try {
    const config = { anchorEmail: "owner@limitsiz.si", smtp: { host: "127.0.0.1", port: s.port, user: "mailer", pass: "secret", from: "no-reply@limitsiz.si" } };
    assert.equal(await createMailer(config)({ subject: "Limitsiz Clinic audit anchor 2026-11-06: all intact", text: "Demo: intact\n  hash abc\n" }), true);
    const [m] = s.mails;
    assert.deepEqual(m.auth, ["mailer", "secret"]);
    assert.deepEqual(m.to, ["owner@limitsiz.si"]);
    assert.match(m.raw, /^Subject: Limitsiz Clinic audit anchor 2026-11-06: all intact/m);
    assert.match(bodyOf(m.raw), /hash abc/);
  } finally { await s.close(); }
});

test("without SMTP settings nothing is sent and the log says so", async () => {
  const lines = [];
  assert.equal(await createMailer({ smtp: null }, { log: (l) => lines.push(l) })({ subject: "x", text: "y" }), false);
  assert.match(lines[0], /not sent/);
});
