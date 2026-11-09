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
    // After an administrator (or the server command) reset someone's two-step: they learn at once if they did not ask for it.
    twoStepReset: ({ to, name, by, at, timezone }) => {
      const when = (locale) => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short", timeZone: timezone }).format(at);
      return send(to, "Your two-step verification was reset / أُعيد ضبط التحقق بخطوتين لحسابك",
        `Hello ${name},\n\n${by} reset two-step verification for your Limitsiz Clinic account on ${when("en-GB")} (${timezone}). ` +
        `Your old authenticator app and recovery codes no longer work, and you were signed out everywhere.\n\n` +
        `Next time you sign in, you will scan a new code with your authenticator app.\n\n` +
        `If you did not ask for this, contact your clinic administrator straight away.\n\n` +
        `مرحباً ${name}،\n\nأعاد ${by} ضبط التحقق بخطوتين لحسابك في Limitsiz Clinic في ${when("ar-JO-u-nu-latn")} (${timezone}). ` +
        `لم يعد تطبيق المصادقة القديم ولا رموز الاسترداد تعمل، وتم تسجيل خروجك من كل الأجهزة.\n\n` +
        `في المرة القادمة التي تسجّل فيها الدخول، ستمسح رمزاً جديداً بتطبيق المصادقة.\n\n` +
        `إن لم تطلب هذا، تواصل مع مدير العيادة فوراً.\n`);
    },
  };
}
