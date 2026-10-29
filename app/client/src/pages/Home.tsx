import { useI18n } from "../i18n";
import HeroArt from "../components/HeroArt";
import Icon, { type IconName } from "../components/Icons";
import DemoForm from "../components/DemoForm";

const AGENTS: { icon: IconName; title: string; text: string }[] = [
  { icon: "booking", title: "agent_booking_title", text: "agent_booking_text" },
  { icon: "reception", title: "agent_recep_title", text: "agent_recep_text" },
  { icon: "scribe", title: "agent_scribe_title", text: "agent_scribe_text" },
  { icon: "reports", title: "agent_reports_title", text: "agent_reports_text" },
  { icon: "finance", title: "agent_fin_title", text: "agent_fin_text" },
  { icon: "assist", title: "agent_assist_title", text: "agent_assist_text" },
];

const PROBLEMS = ["problem_1", "problem_2", "problem_3", "problem_4"];
const STEPS = [
  { title: "step1_title", text: "step1_text" },
  { title: "step2_title", text: "step2_text" },
  { title: "step3_title", text: "step3_text" },
];
const DAY = ["day_1", "day_2", "day_3", "day_4"];
const SECURITY = [
  { title: "sec_1_title", text: "sec_1_text" },
  { title: "sec_2_title", text: "sec_2_text" },
  { title: "sec_3_title", text: "sec_3_text" },
  { title: "sec_4_title", text: "sec_4_text" },
  { title: "sec_5_title", text: "sec_5_text" },
];
const STATS = [
  { num: "res_1_num", text: "res_1_text" },
  { num: "res_2_num", text: "res_2_text" },
  { num: "res_3_num", text: "res_3_text" },
  { num: null, text: "res_4_text" },
];
const FAQ = [1, 2, 3, 4, 5, 6];

export default function Home() {
  const { t } = useI18n();

  return (
    <>
      {/* 1. Hero */}
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">{t("hero_eyebrow")}</p>
            <h1>{t("hero_title")}</h1>
            <p className="lead">{t("hero_sub")}</p>
            <div className="btn-row">
              <a className="btn btn-primary" href="#contact">{t("hero_btn1")}</a>
              <a className="btn btn-ghost" href="#how">{t("hero_btn2")}</a>
            </div>
            <p className="trust">{t("hero_trust")}</p>
          </div>
          <HeroArt />
        </div>
      </section>

      {/* 2. Problem */}
      <section className="section section-tint">
        <div className="container">
          <h2>{t("problem_title")}</h2>
          <ul className="check-list">
            {PROBLEMS.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. Solution */}
      <section className="section">
        <div className="container narrow">
          <h2>{t("solution_title")}</h2>
          <p className="lead">{t("solution_text")}</p>
        </div>
      </section>

      {/* 4. Agents */}
      <section className="section section-tint" id="solutions">
        <div className="container">
          <h2>{t("agents_title")}</h2>
          <div className="card-grid">
            {AGENTS.map((a) => (
              <article className="card" key={a.title}>
                <span className="icon">
                  <Icon name={a.icon} />
                </span>
                <h3>{t(a.title)}</h3>
                <p>{t(a.text)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 5. How it works */}
      <section className="section" id="how">
        <div className="container">
          <h2>{t("how_title")}</h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3>{t(s.title)}</h3>
                <p>{t(s.text)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 6. A day in the clinic */}
      <section className="section section-tint">
        <div className="container narrow">
          <h2>{t("day_title")}</h2>
          <ul className="timeline">
            {DAY.map((k) => (
              <li key={k} dangerouslySetInnerHTML={{ __html: t(k) }} />
            ))}
          </ul>
          <p className="outro">{t("day_outro")}</p>
        </div>
      </section>

      {/* 7. Security */}
      <section className="section" id="security">
        <div className="container">
          <h2>{t("security_title")}</h2>
          <p className="lead">{t("security_headline")}</p>
          <div className="card-grid four">
            {SECURITY.map((s) => (
              <article className="card" key={s.title}>
                <h3>{t(s.title)}</h3>
                <p>{t(s.text)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* 8. Target outcomes */}
      <section className="section section-tint">
        <div className="container">
          <h2>{t("results_title")}</h2>
          <p className="muted">{t("results_label")}</p>
          <div className="stat-grid">
            {STATS.map((s) => (
              <div className="stat" key={s.text}>
                <strong>{s.num ? t(s.num) : "24/7"}</strong>
                <span>{t(s.text)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 9. Pricing */}
      <section className="section" id="pricing">
        <div className="container">
          <h2>{t("pricing_title")}</h2>
          <p className="muted">{t("pricing_note")}</p>
          <div className="table-wrap">
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
                <tr>
                  <th scope="row">{t("row_for")}</th>
                  <td>{t("starter_for")}</td>
                  <td>{t("pro_for")}</td>
                  <td>{t("ent_for")}</td>
                </tr>
                <tr>
                  <th scope="row">{t("row_agents")}</th>
                  <td>{t("starter_agents")}</td>
                  <td>{t("pro_agents")}</td>
                  <td>{t("ent_agents")}</td>
                </tr>
                <tr>
                  <th scope="row">{t("row_support")}</th>
                  <td>{t("starter_support")}</td>
                  <td>{t("pro_support")}</td>
                  <td>{t("ent_support")}</td>
                </tr>
                <tr>
                  <th scope="row">{t("row_price")}</th>
                  <td>{t("starter_price")}</td>
                  <td>{t("pro_price")}</td>
                  <td>{t("ent_price")}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="btn-row">
            <a className="btn btn-primary" href="#contact">{t("pricing_btn")}</a>
          </p>
        </div>
      </section>

      {/* 10. FAQ */}
      <section className="section section-tint" id="faq">
        <div className="container narrow">
          <h2>{t("faq_title")}</h2>
          {FAQ.map((n) => (
            <details key={n}>
              <summary>{t(`faq_q${n}`)}</summary>
              <p>{t(`faq_a${n}`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 11. Demo form */}
      <section className="section cta" id="contact">
        <div className="container narrow">
          <h2>{t("contact_title")}</h2>
          <p className="lead">{t("contact_text")}</p>
          <DemoForm />
          <p className="direct">
            {t("contact_direct")}{" "}
            <a href="mailto:management@limitsiz.si">management@limitsiz.si</a> ·{" "}
            <a href="https://wa.me/962795016514">WhatsApp 00962-795016514</a>
          </p>
        </div>
      </section>
    </>
  );
}
