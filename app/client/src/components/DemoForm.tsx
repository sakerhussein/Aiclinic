import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../i18n";
import Icon from "./Icons";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Interest = "clinic" | "consulting";
export type Plan = "starter" | "pro" | "enterprise";

export const PLANS: { value: Plan; key: string }[] = [
  { value: "starter", key: "plan_starter" },
  { value: "pro", key: "plan_pro" },
  { value: "enterprise", key: "plan_ent" },
];

const TOPICS = ["missed_calls", "scheduling", "documentation", "reports", "finance"] as const;

const SIZES = [
  { value: "1", key: "size_1" },
  { value: "2-5", key: "size_2" },
  { value: "6-10", key: "size_3" },
  { value: "10+", key: "size_4" },
];

const SPECIALTIES = [
  { value: "dermatology", key: "spec_derm" },
  { value: "dental", key: "spec_dental" },
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

type Status = { kind: "" | "err"; text: string };

interface Props {
  plan: Plan;
  onPlanChange: (plan: Plan) => void;
}

export default function DemoForm({ plan, onPlanChange }: Props) {
  const { t, lang } = useI18n();
  const [params] = useSearchParams();
  const [interest, setInterest] = useState<Interest>(params.get("interest") === "consulting" ? "consulting" : "clinic");
  const [focus, setFocus] = useState<string>("missed_calls");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "", text: "" });

  // The consulting section links to /?interest=consulting#contact.
  useEffect(() => {
    const p = params.get("interest");
    if (p === "consulting" || p === "clinic") setInterest(p);
  }, [params]);

  const isClinic = interest === "clinic";
  const multiSpecialty = values.size !== "" && values.size !== "1";
  const hasContact = values.email.trim() !== "" || values.phone.trim() !== "";
  const contactError = tried && !hasContact;

  const update = (field: keyof FormValues) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setValues((prev) => ({ ...prev, [field]: e.target.value }));
    // Clear an old error once the visitor starts fixing the form.
    if (status.kind) setStatus({ kind: "", text: "" });
  };

  const toggleSpecialty = (value: string) =>
    setSpecialties((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = values.name.trim();
    const email = values.email.trim();
    const phone = values.phone.trim();

    if (values.website) {
      // Bot filled the honeypot. Show success without sending anything.
      setValues(EMPTY);
      setDone(true);
      return;
    }
    setTried(true);
    if (!name) {
      setStatus({ kind: "err", text: t("form_invalid") });
      return;
    }
    if (!email && !phone) {
      setStatus({ kind: "err", text: t("form_contact_error") });
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      setStatus({ kind: "err", text: t("form_email_invalid") });
      return;
    }

    const chosenSpecialties = isClinic
      ? multiSpecialty
        ? specialties
        : values.specialty
          ? [values.specialty]
          : []
      : [];

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
          phone,
          message: values.message.trim(),
          language: lang,
          page: window.location.pathname,
          interest,
          focus: isClinic ? focus : "",
          clinic_size: isClinic ? values.size : "",
          specialties: chosenSpecialties,
          package: isClinic ? plan : "",
        }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setValues(EMPTY);
      setSpecialties([]);
      setTried(false);
      setDone(true);
    } catch (err) {
      console.error("Assessment request failed:", err);
      setStatus({ kind: "err", text: t("form_error") });
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="demo-form">
        <div className="form-done" role="status">
          <span className="ok">
            <Icon name="check" />
          </span>
          <p className="display">{t("form_success_title")}</p>
          <p className="muted">{t("form_success")}</p>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setDone(false)}>
            {t("form_again")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form className="demo-form" onSubmit={handleSubmit} noValidate>
      <fieldset>
        <legend>{t("form_interest")}</legend>
        <div className="f-row">
          <label className={`opt${isClinic ? " on" : ""}`}>
            <input type="radio" name="interest" value="clinic" checked={isClinic} onChange={() => setInterest("clinic")} />
            <span>
              <b>{t("opt_clinic")}</b>
              <small>{t("opt_clinic_sub")}</small>
            </span>
          </label>
          <label className={`opt${!isClinic ? " on" : ""}`}>
            <input type="radio" name="interest" value="consulting" checked={!isClinic} onChange={() => setInterest("consulting")} />
            <span>
              <b>{t("opt_consulting")}</b>
              <small>{t("opt_consulting_sub")}</small>
            </span>
          </label>
        </div>
      </fieldset>

      {isClinic && (
        <>
          <fieldset>
            <legend>{t("fix_first")}</legend>
            <div className="chips">
              {TOPICS.map((topic) => (
                <button
                  key={topic}
                  type="button"
                  className="chip"
                  aria-pressed={focus === topic}
                  onClick={() => setFocus(topic)}
                >
                  {t(`topic_${topic}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="f-row">
            <label className="field">
              <span>{t("form_size")}</span>
              <select name="clinic_size" value={values.size} onChange={update("size")}>
                <option value="">{t("form_select")}</option>
                {SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.key)}
                  </option>
                ))}
              </select>
            </label>
            {!multiSpecialty && (
              <label className="field">
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
            )}
            <label className="field">
              <span>{t("form_package")}</span>
              <select name="package" value={plan} onChange={(e) => onPlanChange(e.target.value as Plan)}>
                {PLANS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.key)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {multiSpecialty && (
            <fieldset>
              <legend style={{ marginBottom: 4, fontSize: 14 }}>{t("form_specialties")}</legend>
              <p className="hint" style={{ marginBottom: 10 }}>
                {t("form_specialties_hint")}
              </p>
              <div className="chips">
                {SPECIALTIES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className="chip"
                    aria-pressed={specialties.includes(s.value)}
                    onClick={() => toggleSpecialty(s.value)}
                  >
                    {t(s.key)}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}

      <div className="f-row">
        <label className="field">
          <span>{t("form_name")}</span>
          <input name="name" type="text" required maxLength={200} autoComplete="name" value={values.name} onChange={update("name")} />
        </label>
        <label className="field">
          <span>{isClinic ? t("form_clinic") : t("form_company")}</span>
          <input name="org" type="text" maxLength={200} autoComplete="organization" value={values.org} onChange={update("org")} />
        </label>
      </div>
      <div className="f-row">
        <label className="field">
          <span>{t("form_email")}</span>
          <input
            name="email"
            type="email"
            maxLength={320}
            autoComplete="email"
            value={values.email}
            onChange={update("email")}
            aria-describedby="contactRule"
            aria-invalid={contactError}
          />
        </label>
        <label className="field">
          <span>{t("form_phone")}</span>
          <input
            name="phone"
            type="tel"
            maxLength={40}
            autoComplete="tel"
            dir="ltr"
            value={values.phone}
            onChange={update("phone")}
            aria-describedby="contactRule"
            aria-invalid={contactError}
          />
        </label>
      </div>
      <p id="contactRule" className={`hint contact-rule${contactError ? " err" : ""}`}>
        {contactError ? t("form_contact_error") : t("form_contact_rule")}
      </p>
      <label className="field">
        <span>{t("form_message")}</span>
        <textarea name="message" rows={3} maxLength={2000} value={values.message} onChange={update("message")} />
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
      <button className="btn btn-ink" type="submit" disabled={sending}>
        {sending ? t("form_sending") : isClinic ? t("form_submit") : t("form_submit_consult")}
        <Icon name="arrow" />
      </button>
      <p className={`form-status${status.kind ? ` ${status.kind}` : ""}`} role="status" aria-live="polite">
        {status.text}
      </p>
    </form>
  );
}
