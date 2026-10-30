import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Interest = "clinic" | "consulting";

const SIZES = [
  { value: "1", key: "size_1" },
  { value: "2-5", key: "size_2" },
  { value: "6-10", key: "size_3" },
  { value: "10+", key: "size_4" },
];

const SPECIALTIES = [
  { value: "dental", key: "spec_dental" },
  { value: "dermatology", key: "spec_derm" },
  { value: "family", key: "spec_family" },
  { value: "pediatrics", key: "spec_peds" },
  { value: "physiotherapy", key: "spec_physio" },
  { value: "mental", key: "spec_mental" },
  { value: "other", key: "spec_other" },
];

interface FormValues {
  name: string;
  org: string;
  email: string;
  phone: string;
  size: string;
  specialty: string;
  message: string;
  website: string; // honeypot, hidden from people
}

const EMPTY: FormValues = { name: "", org: "", email: "", phone: "", size: "", specialty: "", message: "", website: "" };

type Status = { kind: "" | "ok" | "err"; text: string };

export default function DemoForm() {
  const { t, lang } = useI18n();
  const [params] = useSearchParams();
  const [interest, setInterest] = useState<Interest>(params.get("interest") === "consulting" ? "consulting" : "clinic");
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "", text: "" });

  // The consulting section links to /?interest=consulting#contact.
  useEffect(() => {
    const p = params.get("interest");
    if (p === "consulting" || p === "clinic") setInterest(p);
  }, [params]);

  const update =
    (field: keyof FormValues) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((prev) => ({ ...prev, [field]: e.target.value }));

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = values.name.trim();
    const email = values.email.trim();

    if (values.website) {
      setValues(EMPTY);
      setStatus({ kind: "ok", text: t("form_spam") });
      return;
    }
    if (!name || !EMAIL_RE.test(email)) {
      setStatus({ kind: "err", text: t("form_invalid") });
      return;
    }

    const isClinic = interest === "clinic";
    setSending(true);
    setStatus({ kind: "", text: "" });
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          clinic: values.org.trim(),
          email,
          phone: values.phone.trim(),
          message: values.message.trim(),
          interest,
          clinic_size: isClinic ? values.size : "",
          specialty: isClinic ? values.specialty : "",
          language: lang,
          page: window.location.pathname,
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setValues(EMPTY);
      setStatus({ kind: "ok", text: t("form_success") });
    } catch (err) {
      console.error("Request failed:", err);
      setStatus({ kind: "err", text: t("form_error") });
    } finally {
      setSending(false);
    }
  }

  const isClinic = interest === "clinic";

  return (
    <form className="demo-form" onSubmit={handleSubmit} noValidate>
      <fieldset className="interest">
        <legend>{t("form_interest")}</legend>
        <div className="interest-opts">
          <label>
            <input type="radio" name="interest" value="clinic" checked={isClinic} onChange={() => setInterest("clinic")} />
            {t("opt_clinic")}
          </label>
          <label>
            <input
              type="radio"
              name="interest"
              value="consulting"
              checked={!isClinic}
              onChange={() => setInterest("consulting")}
            />
            {t("opt_consulting")}
          </label>
        </div>
      </fieldset>

      <div className="form-row">
        <label>
          <span>{t("form_name")}</span>
          <input name="name" type="text" required maxLength={200} autoComplete="name" value={values.name} onChange={update("name")} />
        </label>
        <label>
          <span>{t("form_email")}</span>
          <input name="email" type="email" required maxLength={320} autoComplete="email" value={values.email} onChange={update("email")} />
        </label>
      </div>
      <div className="form-row">
        <label>
          <span>{isClinic ? t("form_clinic") : t("form_company")}</span>
          <input name="org" type="text" maxLength={200} autoComplete="organization" value={values.org} onChange={update("org")} />
        </label>
        <label>
          <span>{t("form_phone")}</span>
          <input name="phone" type="tel" maxLength={40} autoComplete="tel" value={values.phone} onChange={update("phone")} />
        </label>
      </div>

      {isClinic && (
        <div className="form-row">
          <label>
            <span>{t("form_size")}</span>
            <select name="size" value={values.size} onChange={update("size")}>
              <option value="">{t("form_select")}</option>
              {SIZES.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.key)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("form_specialty")}</span>
            <select name="specialty" value={values.specialty} onChange={update("specialty")}>
              <option value="">{t("form_select")}</option>
              {SPECIALTIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.key)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

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
        {sending ? t("form_sending") : isClinic ? t("form_submit") : t("form_submit_consult")}
      </button>
      <p className={`form-status${status.kind ? ` ${status.kind}` : ""}`} role="status" aria-live="polite">
        {status.text}
      </p>
    </form>
  );
}
