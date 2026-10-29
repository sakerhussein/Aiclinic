import { useState, type ChangeEvent, type FormEvent } from "react";
import { useI18n } from "../i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

interface FormValues {
  name: string;
  clinic: string;
  email: string;
  phone: string;
  message: string;
  website: string; // honeypot, hidden from people
}

const EMPTY: FormValues = { name: "", clinic: "", email: "", phone: "", message: "", website: "" };

type Status = { kind: "" | "ok" | "err"; text: string };

export default function DemoForm() {
  const { t, lang } = useI18n();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "", text: "" });

  const update = (field: keyof FormValues) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((prev) => ({ ...prev, [field]: e.target.value }));

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = values.name.trim();
    const email = values.email.trim();

    if (values.website) {
      // Bot filled the honeypot. Show success without sending anything.
      setValues(EMPTY);
      setStatus({ kind: "ok", text: t("form_spam") });
      return;
    }
    if (!name || !EMAIL_RE.test(email)) {
      setStatus({ kind: "err", text: t("form_invalid") });
      return;
    }

    setSending(true);
    setStatus({ kind: "", text: "" });
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          clinic: values.clinic.trim(),
          email,
          phone: values.phone.trim(),
          message: values.message.trim(),
          language: lang,
          page: window.location.pathname,
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setValues(EMPTY);
      setStatus({ kind: "ok", text: t("form_success") });
    } catch (err) {
      console.error("Demo request failed:", err);
      setStatus({ kind: "err", text: t("form_error") });
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="demo-form" onSubmit={handleSubmit} noValidate>
      <div className="form-row">
        <label>
          <span>{t("form_name")}</span>
          <input name="name" type="text" required maxLength={200} autoComplete="name" value={values.name} onChange={update("name")} />
        </label>
        <label>
          <span>{t("form_clinic")}</span>
          <input name="clinic" type="text" maxLength={200} value={values.clinic} onChange={update("clinic")} />
        </label>
      </div>
      <div className="form-row">
        <label>
          <span>{t("form_email")}</span>
          <input name="email" type="email" required maxLength={320} autoComplete="email" value={values.email} onChange={update("email")} />
        </label>
        <label>
          <span>{t("form_phone")}</span>
          <input name="phone" type="tel" maxLength={40} autoComplete="tel" value={values.phone} onChange={update("phone")} />
        </label>
      </div>
      <label className="full">
        <span>{t("form_message")}</span>
        <textarea name="message" rows={4} maxLength={2000} value={values.message} onChange={update("message")} />
      </label>

      <input
        className="hp"
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={values.website}
        onChange={update("website")}
      />

      <p className="form-note" dangerouslySetInnerHTML={{ __html: t("form_privacy") }} />
      <button className="btn btn-primary" type="submit" disabled={sending}>
        {sending ? t("form_sending") : t("form_submit")}
      </button>
      <p className={`form-status${status.kind ? ` ${status.kind}` : ""}`} role="status" aria-live="polite">
        {status.text}
      </p>
    </form>
  );
}
