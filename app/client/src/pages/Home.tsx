import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { useReveal } from "../hooks";
import type { PhotoId } from "../photos";
import Icon, { type IconName } from "../components/Icons";
import Photo from "../components/Photo";
import HeroLoop from "../components/HeroLoop";
import NeverMiss from "../components/NeverMiss";
import WhatsAppDemo from "../components/WhatsAppDemo";
import DemoForm, { type Plan } from "../components/DemoForm";

// Stagger delay for items that reveal one after another.
const delay = (i: number) => ({ "--d": `${i * 0.08}s` }) as CSSProperties;

const TICKS = ["tick_1", "tick_2", "tick_3", "tick_4", "tick_5", "tick_6"];

const SMALL_AGENTS: { id: string; icon: IconName; row?: [string, string]; bars?: boolean }[] = [
  { id: "recep", icon: "reception" },
  { id: "followup", icon: "followup", row: ["ag_followup_row", "ag_followup_chip"] },
  { id: "insurance", icon: "insurance", row: ["ag_insurance_row", "ag_insurance_chip"] },
  { id: "scribe", icon: "scribe", row: ["ag_scribe_row", "ag_scribe_chip"] },
  { id: "reports", icon: "reports" },
  { id: "fin", icon: "finance", bars: true },
  { id: "assist", icon: "assist" },
];

const SPECIALTIES: { id: PhotoId; key: string }[] = [
  { id: "derm", key: "derm" },
  { id: "dental", key: "dental" },
  { id: "family", key: "family" },
  { id: "peds", key: "peds" },
  { id: "physio", key: "physio" },
  { id: "mental", key: "mental" },
];

const PRACTICE = [
  { src: "/photos/reception.jpg", alt: "photo_reception_alt", tag: "ag_recep_title", pos: "90% center", w: 1024, h: 1024 },
  { src: "/photos/doctor.jpg", alt: "photo_doctor_alt", tag: "ag_scribe_title", pos: "33% center", w: 1400, h: 933 },
  { src: "/photos/patient.jpg", alt: "photo_patient_alt", tag: "ag_booking_title", pos: "40% center", w: 1400, h: 933 },
];

const DAY = [
  { time: "8:12", half: "am", text: "day_1" },
  { time: "11:40", half: "am", text: "day_2" },
  { time: "2:05", half: "pm", text: "day_3" },
  { time: "6:00", half: "pm", text: "day_4" },
];

const PLAN_CARDS: { id: Plan; name: string; price: string; small: boolean; who: string; f: [string, string]; cta: string }[] = [
  { id: "starter", name: "plan_starter", price: "starter_price", small: true, who: "starter_for", f: ["starter_f1", "starter_f2"], cta: "plan_cta" },
  { id: "pro", name: "plan_pro", price: "pro_price", small: true, who: "pro_for", f: ["pro_f1", "pro_f2"], cta: "plan_cta" },
  { id: "enterprise", name: "plan_ent", price: "ent_price", small: false, who: "ent_for", f: ["ent_f1", "ent_f2"], cta: "plan_cta_ent" },
];

export default function Home() {
  const { t } = useI18n();
  const [plan, setPlan] = useState<Plan>("starter");
  useReveal([]);

  return (
    <>
      {/* Hero */}
      <section className="hero on-ink">
        <div className="wrap hero-grid">
          <div>
            <p className="pill">
              <span className="live-dot" />
              <span>{t("hero_pill")}</span>
            </p>
            <h1 className="display rise d1">
              {t("hero_title_1")}
              <br />
              {t("hero_title_2")}
            </h1>
            <p className="hero-lead rise d2">{t("hero_lead")}</p>
            <div className="btn-row rise d3">
              <a className="btn btn-accent" href="#contact">
                {t("cta_assessment")}
                <Icon name="arrow" />
              </a>
              <a className="btn btn-outline" href="#how">
                {t("cta_how")}
              </a>
            </div>
            <p className="trust rise d4">
              <Icon name="lock" />
              <span>{t("hero_trust")}</span>
            </p>
          </div>
          <HeroLoop />
        </div>
      </section>

      {/* Ticker */}
      <div className="ticker on-ink">
        <div className="marquee">
          {[false, true].map((dup) =>
            TICKS.map((k) => [
              <span key={`${k}-${dup}-w`} aria-hidden={dup || undefined}>
                {t(k)}
              </span>,
              <span key={`${k}-${dup}-s`} className="sep" aria-hidden="true">
                ∞
              </span>,
            ])
          )}
        </div>
      </div>

      {/* Never miss another … */}
      <NeverMiss />

      {/* 01 Problem */}
      <section className="wrap section">
        <p className="kicker">{t("lbl_problem")}</p>
        <h2 className="display h2" style={{ maxWidth: "18em", marginBottom: 48 }}>
          {t("problem_title")}
        </h2>
        <div className="grid-4">
          {[1, 2, 3, 4].map((n, i) => (
            <div className="problem-card reveal" style={delay(i)} key={n}>
              <span className="num">/0{n}</span>
              <p>{t(`problem_${n}`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 02 Agents */}
      <section id="agents" className="wrap section">
        <div className="section-head">
          <div>
            <p className="kicker">{t("lbl_agents")}</p>
            <h2 className="display h2">{t("agents_title")}</h2>
          </div>
          <p>{t("agents_sub")}</p>
        </div>
        <div className="bento">
          <article className="tile dark s4">
            <div>
              <Icon name="booking" className="tile-icon" />
              <h3 className="h3">{t("ag_booking_title")}</h3>
              <p>{t("ag_booking_text")}</p>
            </div>
            <div className="slots">
              <p className="slots-head">{t("slots_head")}</p>
              <div className="slots-grid">
                {[1, 2, 3].map((n) => (
                  <span key={n} className={`slot${n === 2 ? " on" : ""}`}>
                    {t(`slot_${n}_day`)}
                    <b>{t(`slot_${n}_time`)}</b>
                  </span>
                ))}
              </div>
              <p className="slots-meta">
                <span className="live-dot" />
                {t("slots_meta")}
              </p>
            </div>
          </article>
          {SMALL_AGENTS.map((a, i) => (
            <article className="tile s2 reveal" style={delay(i % 3)} key={a.id}>
              <Icon name={a.icon} className="tile-icon" />
              <h3 className="h3">{t(`ag_${a.id}_title`)}</h3>
              <p>{t(`ag_${a.id}_text`)}</p>
              {a.row && (
                <div className="status-row">
                  <span>{t(a.row[0])}</span>
                  <span className={`chip-ok${a.id === "scribe" ? " halo" : ""}`}>{t(a.row[1])}</span>
                </div>
              )}
              {a.bars && (
                <div className="bars reveal" aria-hidden="true">
                  <span style={{ height: "40%" }} />
                  <span style={{ height: "62%" }} />
                  <span style={{ height: "50%" }} />
                  <span style={{ height: "78%" }} />
                  <span style={{ height: "100%" }} />
                </div>
              )}
            </article>
          ))}
          <article className="tile accent s-all reveal">
            <p className="kicker">{t("orch_label")}</p>
            <p className="big">{t("orch_text")}</p>
          </article>
        </div>
      </section>

      {/* 03 See it in action */}
      <section className="band on-ink">
        <div className="wrap split">
          <div>
            <p className="kicker">{t("lbl_action")}</p>
            <h2 className="display h2" style={{ marginBottom: 20 }}>
              {t("demo_title")}
            </h2>
            <p className="muted" style={{ maxWidth: "30em" }}>
              {t("demo_text")}
            </p>
            <ul className="ticks-list">
              {[1, 2, 3, 4].map((n) => (
                <li key={n}>
                  <span className="tick">
                    <Icon name="check" />
                  </span>
                  {t(`demo_point_${n}`)}
                </li>
              ))}
            </ul>
          </div>
          <WhatsAppDemo />
        </div>
      </section>

      {/* 04 How it works */}
      <section id="how" className="wrap section">
        <div className="panel">
          <p className="kicker">{t("lbl_how")}</p>
          <h2 className="display h2" style={{ marginBottom: 48 }}>
            {t("how_title")}
          </h2>
          <ol className="steps grid-3">
            {[1, 2, 3].map((n, i) => (
              <li key={n} className="reveal" style={delay(i * 2)}>
                <p className="n">{n === 3 ? "∞" : n}</p>
                <h3>{t(`step${n}_title`)}</h3>
                <p>{t(`step${n}_text`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 05 Specialties */}
      <section id="specialties" className="wrap section">
        <div className="section-head">
          <div>
            <p className="kicker">{t("lbl_spec")}</p>
            <h2 className="display h2">{t("spec_title")}</h2>
          </div>
          <p>{t("spec_sub")}</p>
        </div>
        <div className="grid-3">
          {SPECIALTIES.map((s, i) => (
            <article className="spec-card reveal" style={delay(i % 3)} key={s.id}>
              <div className="spec-img">
                <Photo id={s.id} alt={t(`alt_${s.key}`)} sizes="(max-width: 960px) 100vw, 400px" />
              </div>
              <div className="spec-body">
                <h3>{t(`spec_${s.key}`)}</h3>
                <p>{t(`spec_${s.key}_text`)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* 06 A day in the clinic */}
      <section className="wrap section">
        <p className="kicker">{t("lbl_day")}</p>
        <h2 className="display h2" style={{ marginBottom: 48 }}>
          {t("day_title")}
        </h2>
        <div className="grid-4 day">
          {DAY.map((d, i) => (
            <div key={d.text} className="reveal" style={delay(i * 2)}>
              <p className="time" dir="ltr">
                {d.time}
                <small>{t(d.half)}</small>
              </p>
              <p>{t(d.text)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 07 In practice */}
      <section className="wrap section">
        <div className="section-head">
          <div>
            <p className="kicker">{t("lbl_practice")}</p>
            <h2 className="display h2">{t("practice_title")}</h2>
          </div>
          <p>{t("practice_text")}</p>
        </div>
        <div className="grid-3">
          {PRACTICE.map((p, i) => (
            <figure className="photo reveal" style={delay(i)} key={p.src}>
              <img src={p.src} alt={t(p.alt)} width={p.w} height={p.h} loading="lazy" decoding="async" style={{ objectPosition: p.pos }} />
              <span className="scan" aria-hidden="true" />
              <figcaption>
                <span className="live-dot" />
                {t(p.tag)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* 08 Security */}
      <section id="security" className="band on-ink">
        <div className="wrap split" style={{ alignItems: "start" }}>
          <div>
            <p className="kicker">{t("lbl_security")}</p>
            <h2 className="display h2" style={{ marginBottom: 20 }}>
              {t("security_headline")}
            </h2>
            <p className="muted">{t("security_sub")}</p>
          </div>
          <ul className="checks">
            {[1, 2, 3, 4, 5].map((n) => (
              <li key={n}>
                <Icon name="check" />
                <div>
                  <h3>{t(`sec_${n}_title`)}</h3>
                  <p>{t(`sec_${n}_text`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 09 Target results */}
      <section className="wrap section">
        <div className="section-head" style={{ marginBottom: 40 }}>
          <div>
            <p className="kicker">{t("lbl_results")}</p>
            <h2 className="display h2">{t("results_title")}</h2>
          </div>
          <p style={{ fontSize: 15 }}>{t("results_label")}</p>
        </div>
        <div className="grid-4">
          {[1, 2, 3].map((n, i) => (
            <div className="stat reveal" style={delay(i)} key={n}>
              <strong>{t(`res_${n}_num`)}</strong>
              <span>{t(`res_${n}_text`)}</span>
            </div>
          ))}
          <div className="stat dark reveal" style={delay(3)}>
            <strong>24/7</strong>
            <span>{t("res_4_text")}</span>
          </div>
        </div>
      </section>

      {/* 10 Pricing */}
      <section id="pricing" className="wrap section">
        <p className="kicker">{t("lbl_pricing")}</p>
        <h2 className="display h2" style={{ marginBottom: 12 }}>
          {t("pricing_title")}
        </h2>
        <p className="muted" style={{ fontSize: 15, marginBottom: 40 }}>
          {t("pricing_note")}
        </p>
        <div className="grid-3" role="radiogroup" aria-label={t("form_package")}>
          {PLAN_CARDS.map((p) => {
            const on = plan === p.id;
            return (
              <div className={`plan${on ? " on" : ""}`} key={p.id}>
                <div className="plan-top">
                  <p className="tier">{t(p.name)}</p>
                  <button type="button" className="pick" role="radio" aria-checked={on} onClick={() => setPlan(p.id)}>
                    {on ? t("plan_selected") : t("plan_select")}
                  </button>
                </div>
                <p className="price">
                  {t(p.price)}
                  {p.small && <small>{t("per_month")}</small>}
                </p>
                <p className="for">{t(p.who)}</p>
                <ul>
                  <li>{t(p.f[0])}</li>
                  <li>{t(p.f[1])}</li>
                </ul>
                <a className="btn btn-outline btn-sm" href="#contact" onClick={() => setPlan(p.id)}>
                  {t(p.cta)}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {/* 11 Consulting */}
      <section id="consulting" className="band on-ink">
        <div className="wrap split">
          <div>
            <p className="kicker">{t("lbl_consulting")}</p>
            <h2 className="display h2" style={{ marginBottom: 20 }}>
              {t("cons_title")}
            </h2>
            <p className="muted" style={{ maxWidth: "30em" }}>
              {t("cons_sub")}
            </p>
            <div className="cons-list">
              {[
                { n: 1, icon: "audit" as IconName },
                { n: 2, icon: "strategy" as IconName },
              ].map((c) => (
                <div className="cons-item" key={c.n}>
                  <span className="ico">
                    <Icon name={c.icon} />
                  </span>
                  <div>
                    <h3>{t(`cons_${c.n}_title`)}</h3>
                    <p>{t(`cons_${c.n}_text`)}</p>
                  </div>
                </div>
              ))}
            </div>
            <Link className="btn btn-accent" to="/?interest=consulting#contact">
              {t("cons_btn")}
              <Icon name="arrow" />
            </Link>
          </div>
          <div className="cons-photo reveal">
            <Photo id="consulting" alt={t("alt_consulting")} sizes="(max-width: 960px) 90vw, 480px" />
            <span className="scan" aria-hidden="true" />
          </div>
        </div>
      </section>

      {/* 12 FAQ */}
      <section id="faq" className="wrap split section" style={{ alignItems: "start", paddingBottom: 112 }}>
        <div>
          <p className="kicker">{t("lbl_faq")}</p>
          <h2 className="display h2">{t("faq_title")}</h2>
        </div>
        <div className="faq-list">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <details key={n}>
              <summary>{t(`faq_q${n}`)}</summary>
              <p>{t(`faq_a${n}`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Contact: Get Your Free AI Clinic Assessment */}
      <section id="contact" className="contact on-ink">
        <div className="wrap split">
          <div className="contact-left">
            <div>
              <p className="kicker">{t("contact_kicker")}</p>
              <h2 className="display">{t("contact_title")}</h2>
              <p className="contact-intro">{t("contact_text")}</p>
            </div>
            <div className="channels">
              <a className="channel" href="https://wa.me/962795016514">
                <span className="ico wa">
                  <Icon name="chat" />
                </span>
                <span>
                  <b>{t("ch_wa")}</b>
                  <span className="sub" dir="ltr">
                    00962-795016514
                  </span>
                </span>
                <Icon name="arrow" className="go" />
              </a>
              <a className="channel" href="mailto:management@limitsiz.si">
                <span className="ico">
                  <Icon name="mail" />
                </span>
                <span>
                  <b>{t("ch_email")}</b>
                  <span className="sub">management@limitsiz.si</span>
                </span>
                <Icon name="arrow" className="go" />
              </a>
              <p className="place">
                <Icon name="pin" />
                {t("footer_address")}
              </p>
            </div>
          </div>
          <DemoForm plan={plan} onPlanChange={setPlan} />
        </div>
      </section>
    </>
  );
}
