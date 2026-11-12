// Settings › Online visits, Settings › Payment and each doctor's online settings (design: booking/design/online-visits.html).
import { useState } from "react";
import { patch } from "../api";
import { useI18n } from "../i18n";
import { Banner, Field } from "../ui";
import { Check, Pick, SForm, Saver, useSave } from "./settings";
import { useS, duration } from "./settings-text";
import { fill, useOV } from "./online-text";

export type OVSettings = {
  enabled: boolean; mode: "video" | "audio" | "patient"; staff_change_mode: boolean; who_can_book: "marked" | "seen_before" | "everyone"; link_when: "confirmed" | "booked";
  join_opens_minutes: number; join_closes_minutes: number; channels: string[]; patient_picks: boolean; default_channel: string; print_size: "a6" | "a5";
  print_languages: "patient" | "ar_en"; next_visit_days: number[]; consent_en: string; consent_ar: string; consent_version: number; how_to_en: string; how_to_ar: string;
  message_en: string; message_ar: string; email_subject_en: string; email_subject_ar: string;
};
export type PaySettings = { cliq_enabled: boolean; cliq_alias: string | null; cliq_name: string | null; pay_when: "before" | "after"; for_online: boolean; note_en: string; note_ar: string };
export type OVData = { visits: OVSettings; payment: PaySettings; mailReady: boolean; builtChannels: string[] };
type Svc = { id: string; name_en: string; name_ar: string; duration_minutes: number; active: boolean; online_allowed?: boolean };
type Doc = { id: string; name_en: string; name_ar: string; online_enabled?: boolean; online_min_notice_minutes?: number; teams_link?: string | null };
type P = { data: { onlineVisits: OVData; services: Svc[]; options: { joinOpensMinutes: number[]; joinClosesMinutes: number[]; onlineNoticeMinutes: number[] } }; reload: () => Promise<unknown> };

const CHANNELS = ["whatsapp", "sms", "email", "print"] as const;

export function OnlineVisitsTab({ data, reload }: P) {
  const t = useOV(); const s = useS(); const { lang } = useI18n();
  const v = data.onlineVisits.visits;
  const [f, setF] = useState({ enabled: v.enabled, mode: v.mode, staffChangeMode: v.staff_change_mode, whoCanBook: v.who_can_book, linkWhen: v.link_when,
    joinOpensMinutes: v.join_opens_minutes, joinClosesMinutes: v.join_closes_minutes, channels: v.channels, patientPicks: v.patient_picks, defaultChannel: v.default_channel,
    printSize: v.print_size, printLanguages: v.print_languages, nextVisitDays: v.next_visit_days.join(", "),
    consentEn: v.consent_en, consentAr: v.consent_ar, howToEn: v.how_to_en, howToAr: v.how_to_ar, messageEn: v.message_en, messageAr: v.message_ar,
    emailSubjectEn: v.email_subject_en, emailSubjectAr: v.email_subject_ar });
  const [svc, setSvc] = useState<string[]>(data.services.filter((x) => x.online_allowed).map((x) => x.id));
  const { a, ok, submit } = useSave(reload);
  const nm = (x: { name_en: string; name_ar: string }) => (lang === "ar" ? x.name_ar : x.name_en);
  const chanOn = (c: string) => f.channels.includes(c);
  const setChan = (c: string, on: boolean) => {
    const channels = on ? [...f.channels, c] : f.channels.filter((x) => x !== c);
    setF({ ...f, channels, defaultChannel: channels.includes(f.defaultChannel) ? f.defaultChannel : channels[0] ?? f.defaultChannel });
  };
  const txt = (k: keyof typeof f, label: string, dir: "rtl" | "ltr", rows = 3) => (
    <Field label={label}><textarea dir={dir} rows={rows} maxLength={1000} required value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>);
  const days = f.nextVisitDays.split(/[,،\s]+/).map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 1 && x <= 365);
  return (
    <SForm className="stack" onSubmit={submit(() => patch("/api/settings/online-visits", { ...f, nextVisitDays: days.slice(0, 6), onlineServiceIds: svc }))}>
      <section className="panel stack">
        <div className="row between"><h2>{t.tab}</h2><span className={`pill ${v.enabled ? "ok" : ""}`}>{v.enabled ? s.onlineOn : s.onlineOff}</span></div>
        <Check checked={f.enabled} onChange={(x) => setF({ ...f, enabled: x })}>{t.on}<br /><small className="hint">{t.onHint}</small></Check>
        <Banner kind="warn">{t.legal}</Banner>
      </section>
      <section className="panel stack">
        <h2>{t.linkTitle}</h2>
        <div className="radios">
          <label className="radio on"><input type="radio" checked readOnly name="ov-src" /><span><b>{t.linkDoctor}</b><br /><small className="hint">{t.linkDoctorHint}</small></span></label>
          <label className="radio dis"><input type="radio" disabled name="ov-src" /><span><b>{t.linkAuto}</b> <span className="pill">{t.later}</span><br /><small className="hint">{t.linkAutoHint}</small></span></label>
        </div>
      </section>
      <section className="panel stack">
        <h2>{t.visitTitle}</h2>
        <div className="grid2">
          <Field label={t.modeLabel} hint={t.modeHint}><Pick value={f.mode} onChange={(x) => setF({ ...f, mode: x as typeof f.mode })} options={(["audio", "video", "patient"] as const).map((m) => [m, t.modes[m]])} /></Field>
          <Field label={t.whoLabel} hint={t.whoHint}><Pick value={f.whoCanBook} onChange={(x) => setF({ ...f, whoCanBook: x as typeof f.whoCanBook })} options={(["marked", "seen_before", "everyone"] as const).map((m) => [m, t.who[m]])} /></Field>
          <Field label={t.whenLabel}><Pick value={f.linkWhen} onChange={(x) => setF({ ...f, linkWhen: x as typeof f.linkWhen })} options={(["confirmed", "booked"] as const).map((m) => [m, t.when[m]])} /></Field>
          <Field label={t.opensLabel}><Pick value={f.joinOpensMinutes} onChange={(x) => setF({ ...f, joinOpensMinutes: Number(x) })} options={data.options.joinOpensMinutes.map((m) => [m, fill(t.opensOpt, { n: m })])} /></Field>
          <Field label={t.closesLabel}><Pick value={f.joinClosesMinutes} onChange={(x) => setF({ ...f, joinClosesMinutes: Number(x) })} options={data.options.joinClosesMinutes.map((m) => [m, fill(t.closesOpt, { n: m })])} /></Field>
          <Field label={t.nextDays}><input dir="ltr" className="mono" value={f.nextVisitDays} onChange={(e) => setF({ ...f, nextVisitDays: e.target.value })} required /></Field>
        </div>
        <Check checked={f.staffChangeMode} onChange={(x) => setF({ ...f, staffChangeMode: x })}>{t.staffMode}</Check>
      </section>
      <section className="panel stack">
        <h2>{t.servicesTitle}</h2>
        <p className="hint">{t.servicesHint}</p>
        {data.services.filter((x) => x.active).map((x) => (
          <Check key={x.id} checked={svc.includes(x.id)} onChange={(c) => setSvc(c ? [...svc, x.id] : svc.filter((y) => y !== x.id))}>{nm(x)} · {duration(x.duration_minutes, s)}</Check>))}
      </section>
      <section className="panel stack">
        <h2>{t.sendTitle}</h2>
        <p className="hint">{t.sendHint}</p>
        <div>
          {CHANNELS.map((c) => {
            const built = data.onlineVisits.builtChannels.includes(c);
            const name = { whatsapp: t.chWhatsapp, sms: t.chSms, email: t.chEmail, print: t.chPrint }[c];
            const hint = { whatsapp: t.chWhatsappHint, sms: t.chSmsHint, email: t.chEmailHint, print: t.chPrintHint }[c];
            return (
              <div className="chan" key={c}>
                <input type="checkbox" aria-label={name} checked={chanOn(c)} disabled={!built && !chanOn(c)} onChange={(e) => setChan(c, e.target.checked)} />
                <div><b>{name}</b><span className="hint">{hint}</span>
                  {c === "print" && chanOn(c) && <div className="grid2" style={{ marginTop: 6 }}>
                    <Field label={t.printSize}><Pick value={f.printSize} onChange={(x) => setF({ ...f, printSize: x as typeof f.printSize })} options={(["a6", "a5"] as const).map((m) => [m, t.sizes[m]])} /></Field>
                    <Field label={t.printLangs}><Pick value={f.printLanguages} onChange={(x) => setF({ ...f, printLanguages: x as typeof f.printLanguages })} options={(["patient", "ar_en"] as const).map((m) => [m, t.langsOpt[m]])} /></Field>
                  </div>}</div>
                {!built ? <span className="pill">{t.phase2}</span>
                  : c === "email" ? <span className={`pill ${data.onlineVisits.mailReady ? "ok" : "warn"}`}>{data.onlineVisits.mailReady ? t.mailReady : t.mailNotReady}</span> : <span />}
              </div>);
          })}
        </div>
        <Check checked={f.patientPicks} onChange={(x) => setF({ ...f, patientPicks: x })}>{t.patientPicks}</Check>
        <Field label={t.defaultChannel}><Pick value={f.defaultChannel} onChange={(x) => setF({ ...f, defaultChannel: x })} options={f.channels.map((c) => [c, t.chName[c] ?? c])} /></Field>
      </section>
      <section className="panel stack">
        <h2>{t.textsTitle}</h2>
        <p className="hint">{t.textsHint}</p>
        <div className="grid2">
          {txt("consentAr", t.consentAr, "rtl")}{txt("consentEn", t.consentEn, "ltr")}
          {txt("howToAr", t.howToAr, "rtl")}{txt("howToEn", t.howToEn, "ltr")}
          {txt("messageAr", t.messageAr, "rtl", 2)}{txt("messageEn", t.messageEn, "ltr", 2)}
          <Field label={t.subjectAr}><input dir="rtl" required maxLength={200} value={f.emailSubjectAr} onChange={(e) => setF({ ...f, emailSubjectAr: e.target.value })} /></Field>
          <Field label={t.subjectEn}><input dir="ltr" required maxLength={200} value={f.emailSubjectEn} onChange={(e) => setF({ ...f, emailSubjectEn: e.target.value })} /></Field>
        </div>
        <p className="hint">{t.consentChanged}</p>
      </section>
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

export function PaymentTab({ data, reload }: P) {
  const t = useOV();
  const p = data.onlineVisits.payment;
  const [f, setF] = useState({ cliqEnabled: p.cliq_enabled, cliqAlias: p.cliq_alias ?? "", cliqName: p.cliq_name ?? "", payWhen: p.pay_when, forOnline: p.for_online, noteEn: p.note_en, noteAr: p.note_ar });
  const { a, ok, submit } = useSave(reload);
  return (
    <SForm className="panel stack" onSubmit={submit(() => patch("/api/settings/payment", { ...f, cliqAlias: f.cliqAlias.trim() || null, cliqName: f.cliqName.trim() || null }))}>
      <div className="row between"><h2>{t.payTitle}</h2><span className={`pill ${p.cliq_enabled ? "ok" : ""}`}>{p.cliq_enabled ? t.cliqOnPill : t.cliqOffPill}</span></div>
      <p className="hint">{t.payHint}</p>
      <Check checked={f.cliqEnabled} onChange={(x) => setF({ ...f, cliqEnabled: x })}><b>{t.cliqOn}</b></Check>
      <div className="grid2">
        <Field label={t.alias} hint={t.aliasHint}><input className="mono" dir="ltr" maxLength={20} pattern="[A-Za-z0-9]{1,20}" required={f.cliqEnabled} value={f.cliqAlias}
          onChange={(e) => setF({ ...f, cliqAlias: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} /></Field>
        <Field label={t.payName} hint={t.payNameHint}><input maxLength={80} required={f.cliqEnabled} value={f.cliqName} onChange={(e) => setF({ ...f, cliqName: e.target.value })} /></Field>
        <Field label={t.payWhen}><Pick value={f.payWhen} onChange={(x) => setF({ ...f, payWhen: x as typeof f.payWhen })} options={(["before", "after"] as const).map((m) => [m, t.payWhenOpt[m]])} /></Field>
        <Field label={t.usedFor} hint={t.usedHint}><Pick value="online" onChange={() => {}} options={[["online", t.usedOnline]]} /></Field>
        <Field label={t.noteAr}><textarea dir="rtl" rows={2} maxLength={500} required value={f.noteAr} onChange={(e) => setF({ ...f, noteAr: e.target.value })} /></Field>
        <Field label={t.noteEn}><textarea dir="ltr" rows={2} maxLength={500} required value={f.noteEn} onChange={(e) => setF({ ...f, noteEn: e.target.value })} /></Field>
      </div>
      <p className="hint">{t.noteHint}</p>
      <Saver a={a} ok={ok} />
    </SForm>
  );
}

export function DoctorOnlinePanel({ doc, data, reload }: { doc: Doc } & P) {
  const t = useOV(); const s = useS(); const { lang } = useI18n();
  const [f, setF] = useState({ onlineEnabled: !!doc.online_enabled, onlineMinNoticeMinutes: doc.online_min_notice_minutes ?? 60, teamsLink: doc.teams_link ?? "" });
  const { a, ok, submit } = useSave(reload);
  if (!data.onlineVisits.visits.enabled && !doc.online_enabled) return null;
  return (
    <SForm className="panel stack" onSubmit={submit(() => patch(`/api/settings/doctors/${doc.id}/online`, { ...f, teamsLink: f.teamsLink.trim() || null }))}>
      <div className="row between"><h2>{t.docTitle}</h2>{doc.online_enabled && <span className="pill vt">{t.offered}</span>}</div>
      <Check checked={f.onlineEnabled} onChange={(x) => setF({ ...f, onlineEnabled: x })}>{fill(t.docOn, { name: lang === "ar" ? doc.name_ar : doc.name_en })}</Check>
      <Field label={t.minNotice} hint={t.minNoticeHint}><Pick value={f.onlineMinNoticeMinutes} onChange={(x) => setF({ ...f, onlineMinNoticeMinutes: Number(x) })}
        options={data.options.onlineNoticeMinutes.map((m) => [m, m ? fill(t.fromNow, { t: duration(m, s) }) : t.noneOpt])} /></Field>
      <Field label={t.teamsLink} hint={t.teamsHint}>
        <div className="linkrow"><input className="mono" dir="ltr" type="url" maxLength={2000} pattern="https://teams\.(microsoft|live)\.com/.*" value={f.teamsLink}
          onChange={(e) => setF({ ...f, teamsLink: e.target.value })} />
          {f.teamsLink && <a className="btn btn-outline btn-sm" href={f.teamsLink} target="_blank" rel="noopener noreferrer">{t.openTest}</a>}</div>
      </Field>
      <Saver a={a} ok={ok} />
    </SForm>
  );
}
