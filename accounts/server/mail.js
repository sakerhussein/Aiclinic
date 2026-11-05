import nodemailer from "nodemailer";

// Invitation and password-reset emails, in Arabic and English in one message. Without SMTP settings they are only logged
// (the link is not printed in production: use the create-admin command, which prints the link for the owner).
export function createMailer(config, { log = console.log } = {}) {
  const transport = config.smtp
    ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
    : null;

  async function send(to, subject, text) {
    if (!transport) { log(`[mail not sent: SMTP is not set] to=${to} subject=${subject}`); return; }
    await transport.sendMail({ from: config.smtp.from, to, subject, text });
  }

  return {
    send,
    invite: ({ to, name, link, inviter }) => send(to, "Your Limitsiz Clinic account / حسابك في Limitsiz Clinic",
      `Hello ${name},\n\n${inviter} invited you to Limitsiz Clinic. Choose your password here (the link works once, for 72 hours):\n${link}\n\n` +
      `مرحباً ${name}،\n\nدعاك ${inviter} للانضمام إلى Limitsiz Clinic. اختر كلمة المرور من هنا (الرابط يعمل مرة واحدة ولمدة 72 ساعة):\n${link}\n`),
    reset: ({ to, name, link }) => send(to, "Reset your password / إعادة تعيين كلمة المرور",
      `Hello ${name},\n\nUse this link to choose a new password (it works once, for 1 hour). If you did not ask for it, ignore this email.\n${link}\n\n` +
      `مرحباً ${name}،\n\nاستخدم هذا الرابط لاختيار كلمة مرور جديدة (يعمل مرة واحدة ولمدة ساعة). إذا لم تطلبه فتجاهل هذه الرسالة.\n${link}\n`),
  };
}
