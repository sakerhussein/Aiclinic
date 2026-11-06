// A small SMTP server for tests: it takes one sign-in and any messages, and keeps them, so the real mail library runs end to end.
import net from "node:net";

export async function fakeSmtp() {
  const mails = [];
  const server = net.createServer((sock) => {
    let buf = "", data = null, mail = { auth: null, from: null, to: [], raw: "" };
    const say = (line) => sock.write(`${line}\r\n`);
    say("220 test ESMTP");
    sock.on("error", () => {});
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      for (let i; (i = buf.indexOf("\r\n")) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data !== null) {
          if (line === ".") { mails.push({ ...mail, raw: data.join("\r\n") }); data = null; mail = { ...mail, from: null, to: [] }; say("250 queued"); }
          else data.push(line.replace(/^\.\./, "."));
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") { sock.write("250-test\r\n"); say("250 AUTH PLAIN"); }
        else if (cmd === "AUTH") { mail.auth = Buffer.from(line.split(" ").pop(), "base64").toString().split("\0").slice(1); say("235 ok"); }
        else if (cmd === "MAIL") { mail.from = /<(.*?)>/.exec(line)[1]; say("250 ok"); }
        else if (cmd === "RCPT") { mail.to.push(/<(.*?)>/.exec(line)[1]); say("250 ok"); }
        else if (cmd === "DATA") { data = []; say("354 go"); }
        else if (cmd === "QUIT") { say("221 bye"); sock.end(); }
        else say("250 ok");
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { port: server.address().port, mails, close: () => new Promise((r) => server.close(r)) };
}

// The text of a simple message, whichever way the library encoded it.
export function bodyOf(raw) {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const body = rest.join("\r\n\r\n");
  if (/content-transfer-encoding: base64/i.test(head)) return Buffer.from(body, "base64").toString("utf8");
  if (/content-transfer-encoding: quoted-printable/i.test(head)) {
    const bytes = body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(bytes, "latin1").toString("utf8");
  }
  return body;
}
