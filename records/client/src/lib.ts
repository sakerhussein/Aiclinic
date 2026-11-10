// Times are shown and entered in the clinic's own time zone (not the computer's), so a secretary abroad or a wrong PC clock
// cannot shift an appointment.
function offsetMinutes(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(utcMs)).reduce<Record<string, number>>((a, x) => { if (x.type !== "literal") a[x.type] = Number(x.value); return a; }, {});
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs) / 60000;
}

/** "2026-11-11" + 10:30 in the clinic's zone -> UTC ISO string. */
export function localToIso(day: string, hh: number, mm: number, tz: string): string {
  const [y, mo, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  let t = guess - offsetMinutes(guess, tz) * 60000;
  t = guess - offsetMinutes(t, tz) * 60000;
  return new Date(t).toISOString();
}

export const hm = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
export const minutesOfDay = (iso: string, tz: string) => { const [h, m] = hm(iso, tz).split(":").map(Number); return h * 60 + m; };
export const weekdayOf = (day: string) => new Date(day + "T12:00:00Z").getUTCDay();
export const addDays = (day: string, n: number) => new Date(Date.parse(day + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
export const todayIn = (tz: string) => dayOf(new Date().toISOString(), tz);
export const fmtDay = (day: string, lang: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
export const fmtDateTime = (iso: string, tz: string, lang: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
export const fmtShortDate = (day: string, lang: string) => new Intl.DateTimeFormat(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
