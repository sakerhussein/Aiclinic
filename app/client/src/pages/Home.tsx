import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../i18n";
import { useReveal } from "../hooks";
import type { PhotoId } from "../photos";
import Icon, { type IconName } from "../components/Icons";
import Photo from "../components/Photo";
import HeroVisual from "../components/HeroVisual";
import RotatingWord from "../components/RotatingWord";
import AgentNetwork from "../components/AgentNetwork";
import WhatsAppDemo from "../components/WhatsAppDemo";
import CountUp from "../components/CountUp";
import DemoForm from "../components/DemoForm";

const AGENTS: { id: string; icon: IconName }[] = [
  { id: "booking", icon: "booking" },
  { id: "recep", icon: "reception" },
  { id: "followup", icon: "followup" },
  { id: "insurance", icon: "insurance" },
  { id: "scribe", icon: "scribe" },
  { id: "reports", icon: "reports" },
  { id: "fin", icon: "finance" },
  { id: "assist", icon: "assist" },
];

const SPECIALTIES: PhotoId[] = ["dental", "derm", "family", "peds", "physio", "mental"];

const CONSULTING: { n: number; icon: IconName }[] = [
  { n: 1, icon: "audit" },
  { n: 2, icon: "strategy" },
  { n: 3, icon: "implement" },
];

const STATS = [
  { num: "res_1_num", text: "res_1_text", animate: true },
  { num: "res_2_num", text: "res_2_text", animate: true },
  { num: "res_3_num", text: "res_3_text", animate: true },
  { num: "res_4_num", text: "res_4_text", animate: false },
];

// Stagger delay for items that reveal one after another.
const delay = (i: number) => ({ "--d": `${i * 0.08}s` }) as CSSProperties;

export default function Home() {
  const { t } = useI18n();
  useReveal([]);

  return (
    <>
      {/* 1. Hero */}
      <section className="hero">
        <div className="hero-bg" aria-hidden="true">
          <div className="hero-dots" />
          <span className="orb orb-1" />
          <span className="orb orb-2" />
          <span className="orb orb-3" />
        </div>
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">{t("hero_eyebrow")}</p>
            <h1>
              {t("hero_title_prefix")} <RotatingWord words={[t("rot_1"), t("rot_2"), t("rot_3")]} />
              <span className="sr-only">{t("rot_1")}</span>
            </h1>
            <p className="lead">{t("hero_sub")}</p>
            <div className="btn-row">
              <a className="btn btn-primary" href="#contact">{t("hero_btn1")}</a>
              <a className="btn btn-ghost" href="#how">{t("hero_btn2")}</a>
            </div>
            <p className="trust">{t("hero_trust")}</p>
            <p className="markets">{t("hero_markets")}</p>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* 2. Problem */}
      <section className="section section-tint">
        <div className="container">
          <h2 className="reveal">{t("problem_title")}</h2>
          <ul className="check-list">
            {["problem_1", "problem_2", "problem_3", "problem_4", "problem_5"].map((k, i) => (
              <li key={k} className="reveal" style={delay(i)}>
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. Orchestration */}
      <section className="section" id="orchestration">
        <div className="container split">
          <div className="reveal">
            <p className="eyebrow">{t("solution_eyebrow")}</p>
            <h2>{t("solution_title")}</h2>
            <p className="lead">{t("solution_text")}</p>
          </div>
          <div className="reveal" style={delay(2)}>
            <AgentNetwork />
          </div>
        </div>
      </section>

      {/* 4. Agents */}
      <section className="section section-tint" id="solutions">
        <div className="container">
          <div className="reveal">
            <p className="eyebrow">{t("agents_eyebrow")}</p>
            <h2>{t("agents_title")}</h2>
            <p className="lead">{t("agents_sub")}</p>
          </div>
          <div className="agents-grid">
            {AGENTS.map((a, i) => (
              <article className="agent-card reveal" style={delay(i)} key={a.id}>
                <span className="icon">
                  <Icon name={a.icon} />
                </span>
                <h3>{t(`ag_${a.id}_title`)}</h3>
                <p className="outcome">{t(`ag_${a.id}_outcome`)}</p>
                <p className="desc">{t(`ag_${a.id}_text`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 5. WhatsApp demo */}
      <section className="section">
        <div className="container split">
          <div className="reveal">
            <p className="eyebrow">{t("demo_eyebrow")}</p>
            <h2>{t("demo_title")}</h2>
            <p className="lead">{t("demo_text")}</p>
            <ul className="demo-points">
              {["demo_point_1", "demo_point_2", "demo_point_3", "demo_point_4"].map((k) => (
                <li key={k}>
                  <span className="tick">
                    <Icon name="check" />
                  </span>
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
          <div className="reveal" style={delay(2)}>
            <WhatsAppDemo />
          </div>
        </div>
      </section>

      {/* 6. Free assessment */}
      <section className="section section-tint" id="assessment">
        <div className="container assess-grid">
          <div className="photo-frame reveal">
            <Photo id="assessment" alt={t("alt_assessment")} />
            <div className="score-widget">
              <svg className="score-ring" viewBox="0 0 64 64" aria-hidden="true">
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#1E4FA8" />
                    <stop offset="1" stopColor="#0F9D8F" />
                  </linearGradient>
                </defs>
                <circle className="bg" cx="32" cy="32" r="28" />
                <circle className="fg" cx="32" cy="32" r="28" />
                <text x="32" y="38">78</text>
              </svg>
              <div>
                <strong>{t("as_4")}</strong>
                <small>{t("as_example")}</small>
              </div>
            </div>
          </div>
          <div className="reveal" style={delay(2)}>
            <p className="eyebrow">{t("as_eyebrow")}</p>
            <h2>{t("as_title")}</h2>
            <p className="lead">{t("as_text")}</p>
            <ul className="demo-points">
              {["as_1", "as_2", "as_3", "as_4", "as_5"].map((k) => (
                <li key={k}>
                  <span className="tick">
                    <Icon name="check" />
                  </span>
                  {t(k)}
                </li>
              ))}
            </ul>
            <p className="btn-row">
              <a className="btn btn-primary" href="#contact">{t("as_btn")}</a>
            </p>
          </div>
        </div>
      </section>

      {/* 7. How it works */}
      <section className="section" id="how">
        <div className="container">
          <h2 className="reveal">{t("how_title")}</h2>
          <ol className="steps">
            {[1, 2, 3].map((n, i) => (
              <li key={n} className="reveal" style={delay(i * 2)}>
                <h3>{t(`step${n}_title`)}</h3>
                <p>{t(`step${n}_text`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 8. Specialties */}
      <section className="section section-tint" id="specialties">
        <div className="container">
          <div className="reveal">
            <h2>{t("spec_title")}</h2>
            <p className="lead">{t("spec_sub")}</p>
          </div>
          <div className="spec-grid">
            {SPECIALTIES.map((id, i) => (
              <article className="spec-card reveal" style={delay(i)} key={id}>
                <div className="spec-img">
                  <Photo id={id} alt={t(`alt_${id}`)} sizes="(max-width: 560px) 100vw, (max-width: 900px) 50vw, 380px" />
                </div>
                <div className="spec-body">
                  <h3>{t(`spec_${id}`)}</h3>
                  <p>{t(`spec_${id}_text`)}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 9. A day in the clinic */}
      <section className="section">
        <div className="container narrow">
          <h2 className="reveal">{t("day_title")}</h2>
          <ul className="timeline">
            {["day_1", "day_2", "day_3", "day_4"].map((k, i) => (
              <li key={k} className="reveal" style={delay(i * 2)} dangerouslySetInnerHTML={{ __html: t(k) }} />
            ))}
          </ul>
          <p className="outro reveal">{t("day_outro")}</p>
        </div>
      </section>

      {/* 10. Security */}
      <section className="section section-tint" id="security">
        <div className="container">
          <div className="reveal">
            <h2>{t("security_title")}</h2>
            <p className="lead">{t("security_headline")}</p>
          </div>
          <div className="card-grid four">
            {[1, 2, 3, 4, 5].map((n, i) => (
              <article className="card reveal" style={delay(i)} key={n}>
                <h3>{t(`sec_${n}_title`)}</h3>
                <p>{t(`sec_${n}_text`)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 11. Target outcomes */}
      <section className="section">
        <div className="container">
          <h2 className="reveal">{t("results_title")}</h2>
          <p className="muted reveal">{t("results_label")}</p>
          <div className="stat-grid">
            {STATS.map((s, i) => (
              <div className="stat reveal" style={delay(i)} key={s.text}>
                <strong>
                  <CountUp text={t(s.num)} animate={s.animate} />
                </strong>
                <span>{t(s.text)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 12. Pricing */}
      <section className="section section-tint" id="pricing">
        <div className="container">
          <h2 className="reveal">{t("pricing_title")}</h2>
          <p className="muted">{t("pricing_note")}</p>
          <div className="table-wrap reveal">
            <table className="pricing">
              <thead>
                <tr>
                  <th scope="col"></th>
                  <th scope="col">{t("plan_starter")}</th>
                  <th scope="col">{t("plan_pro")}</th>
                  <th scope="col">{t("plan_ent")}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["row_for", "starter_for", "pro_for", "ent_for"],
                  ["row_agents", "starter_agents", "pro_agents", "ent_agents"],
                  ["row_support", "starter_support", "pro_support", "ent_support"],
                  ["row_price", "starter_price", "pro_price", "ent_price"],
                ].map(([head, ...cells]) => (
                  <tr key={head}>
                    <th scope="row">{t(head)}</th>
                    {cells.map((c) => (
                      <td key={c}>{t(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="btn-row">
            <a className="btn btn-primary" href="#contact">{t("pricing_btn")}</a>
          </p>
        </div>
      </section>

      {/* 13. Consulting */}
      <section className="section consult" id="consulting">
        <div className="hero-dots consult-dots" aria-hidden="true" />
        <div className="container consult-grid">
          <div className="reveal">
            <p className="eyebrow">{t("cons_eyebrow")}</p>
            <h2>{t("cons_title")}</h2>
            <p className="lead">{t("cons_sub")}</p>
            <div className="consult-list">
              {CONSULTING.map((c, i) => (
                <div className="consult-item reveal" style={delay(i + 1)} key={c.n}>
                  <span className="icon">
                    <Icon name={c.icon} />
                  </span>
                  <div>
                    <h3>{t(`cons_${c.n}_title`)}</h3>
                    <p>{t(`cons_${c.n}_text`)}</p>
                  </div>
                </div>
              ))}
            </div>
            <Link className="btn btn-light" to="/?interest=consulting#contact">
              {t("cons_btn")}
            </Link>
          </div>
          <div className="photo-frame tall reveal" style={delay(2)}>
            <Photo id="consulting" alt={t("alt_consulting")} />
          </div>
        </div>
      </section>

      {/* 14. FAQ */}
      <section className="section" id="faq">
        <div className="container narrow">
          <h2 className="reveal">{t("faq_title")}</h2>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <details key={n} className="reveal">
              <summary>{t(`faq_q${n}`)}</summary>
              <p>{t(`faq_a${n}`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 15. Contact */}
      <section className="section cta" id="contact">
        <div className="container narrow">
          <h2>{t("contact_title")}</h2>
          <p className="lead">{t("contact_text")}</p>
          <DemoForm />
          <p className="direct">
            {t("contact_direct")} <a href="mailto:management@limitsiz.si">management@limitsiz.si</a> ·{" "}
            <a href="https://wa.me/962795016514">WhatsApp 00962-795016514</a>
          </p>
        </div>
      </section>
    </>
  );
}
