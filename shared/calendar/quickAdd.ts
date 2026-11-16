// Quick add: "Lunch with Sam at Kura tomorrow 1pm" becomes a title, a day,
// times and a place. It only fills in the event dialog; nothing is saved
// until the dialog is. Dates are local days; days of the month read day first,
// as in Australia.

import { addDays, weekday, type DateStr } from '../dates.ts';

export type Quick = { title: string; date: DateStr; start?: string; end?: string; allDay?: boolean; location?: string };

const DAYS: [RegExp, number][] = [
  [/^sun/, 0],
  [/^mon/, 1],
  [/^tue/, 2],
  [/^wed/, 3],
  [/^thu/, 4],
  [/^fri/, 5],
  [/^sat/, 6],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DAY = '(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)';
// A clock time: "3", "3pm", "3:30", "3.30pm", "15:00". Hours and minutes, then am or pm.
const T = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a|p)?';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;

/** Minutes into the day. Without am or pm, 1 to 7 read as afternoon and 8 to 11 as morning. */
function clock(h: string, m: string | undefined, ap: string | undefined, guess = true): number | null {
  let hour = Number(h);
  const min = m ? Number(m) : 0;
  if (hour > 23 || min > 59) return null;
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ap.startsWith('p') ? 12 : 0);
  } else if (guess && hour >= 1 && hour <= 7) hour += 12;
  return hour * 60 + min;
}

/** The date for day d of month m: this year, or next if that's already gone. */
function dayOfMonth(d: number, m: number, year: number | null, today: DateStr): DateStr | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let y = year ?? Number(today.slice(0, 4));
  if (y < 100) y += 2000;
  let date = `${y}-${pad(m)}-${pad(d)}`;
  if (new Date(`${date}T00:00:00Z`).getUTCDate() !== d) return null;
  if (year == null && date < today) date = `${y + 1}-${pad(m)}-${pad(d)}`;
  return date;
}

export function parseQuick(input: string, today: DateStr, now: Date = new Date()): Quick | null {
  let s = ` ${input.replace(/\s+/g, ' ').trim()} `;
  let date: DateStr | null = null;
  let start: number | null = null;
  let end: number | null = null;
  let duration: number | null = null;
  let allDay = false;
  let tonight = false;
  // Each recognised piece is taken out of the text; what's left is the title.
  // Every candidate is tried in turn, so "14" in "14 Nov 10am" doesn't hide the time after it.
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean) => {
    const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (let m = all.exec(s); m; m = all.exec(s)) {
      if (fn(m)) {
        s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`;
        return;
      }
      // Matches share their leading space, so step back one to let the next start there.
      all.lastIndex = m.index + 1;
    }
  };

  take(/\s(?:all[ -]day)(?=\s)/i, () => (allDay = true));
  take(/\sfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)(?=\s)/i, (m) => {
    duration = Math.round(Number(m[1]) * (m[2]!.toLowerCase().startsWith('h') ? 60 : 1));
    return duration > 0;
  });
  // A range: "3-4pm", "10am to 12", "from 2 until 3:30". One end must say am, pm or minutes, or "from" must lead.
  take(new RegExp(`\\s(from\\s+)?(?:at\\s+)?${T}\\s*(?:-|–|to|until|till)\\s*${T}(?=\\s)`, 'i'), (m) => {
    const [, from, h1, m1, a1, h2, m2, a2] = m;
    if (!from && !a1 && !a2 && !m1 && !m2) return false;
    let b = clock(h2!, m2, a2);
    let a = clock(h1!, m1, a1 ?? a2, !a2);
    if (a == null || b == null) return false;
    // "11-1pm": the start is the morning before.
    if (!a1 && a2 && a > b) a -= 12 * 60;
    if (b <= a) b += 12 * 60;
    start = a;
    end = b;
    return true;
  });
  if (start == null) {
    take(new RegExp(`\\s(?:at\\s+|@\\s*)?(noon|midday)(?=\\s)`, 'i'), () => ((start = 12 * 60), true));
  }
  if (start == null) {
    // A single time: needs am or pm, minutes, or "at" in front ("at 3").
    take(new RegExp(`\\s(at\\s+|@\\s*)?${T}(?=\\s)`, 'i'), (m) => {
      const [, at, h, mm, ap] = m;
      if (!at && !ap && !mm) return false;
      if (mm && !ap && !at && Number(h) > 23) return false;
      const v = clock(h!, mm, ap);
      if (v == null) return false;
      start = v;
      return true;
    });
  }

  take(/\s(today|tonight|tomorrow|tmrw|tmr)(?=\s)/i, (m) => {
    const w = m[1]!.toLowerCase();
    tonight = w === 'tonight';
    date = w.startsWith('t') && w !== 'today' && w !== 'tonight' ? addDays(today, 1) : today;
    return true;
  });
  if (!date) {
    take(/\s(?:on\s+)?next\s+week(?=\s)/i, () => ((date = addDays(today, 7)), true));
  }
  if (!date) {
    take(/\sin\s+(\d{1,3})\s+days?(?=\s)/i, (m) => ((date = addDays(today, Number(m[1]))), true));
  }
  if (!date) {
    take(new RegExp(`\\s(?:on\\s+)?(next\\s+|this\\s+)?${DAY}(?=\\s)`, 'i'), (m) => {
      const target = DAYS.find(([re]) => re.test(m[2]!.toLowerCase()))![1];
      let n = (target - weekday(today) + 7) % 7;
      // "Friday" on a Friday is today; "next Friday" is a week on.
      if (n === 0 && m[1]?.toLowerCase().startsWith('next')) n = 7;
      date = addDays(today, n);
      return true;
    });
  }
  if (!date) {
    take(new RegExp(`\\s(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:\\s+(\\d{4}))?(?=\\s)`, 'i'), (m) => {
      date = dayOfMonth(Number(m[1]), MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1, m[3] ? Number(m[3]) : null, today);
      return !!date;
    });
  }
  if (!date) {
    take(new RegExp(`\\s(?:on\\s+)?${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?=\\s)`, 'i'), (m) => {
      date = dayOfMonth(Number(m[2]), MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1, m[3] ? Number(m[3]) : null, today);
      return !!date;
    });
  }
  if (!date) {
    take(/\s(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?=\s)/, (m) => {
      date = dayOfMonth(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null, today);
      return !!date;
    });
  }

  // What's left: the title, and a place after "at" or "@" at its end ("at Kura", "@ the office").
  let location: string | undefined;
  take(/\s(?:at\s+(?=[A-Z0-9])|@\s*)(.+?)\s*$/, (m) => {
    location = m[1]!.trim();
    return location.length > 0;
  });
  const title = s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(on|at|from|for|in)\s+/i, '')
    .replace(/\s+(on|at|from|for|in)$/i, '')
    .trim();
  if (!title) return null;

  if (tonight && start == null) start = 19 * 60;
  const resolvedDate: DateStr = date ?? today;
  const out: Quick = { title, date: resolvedDate };
  if (location) out.location = location;
  if (allDay || (date && start == null)) {
    out.allDay = true;
    return out;
  }
  if (start == null) {
    // No day and no time: the next whole hour today, as the New event button does.
    if (now.getHours() < 23) out.start = hhmm((now.getHours() + 1) * 60);
    return out;
  }
  out.start = hhmm(start);
  const stop = end ?? (duration != null ? (start as number) + (duration as number) : null);
  if (stop != null) {
    if (stop >= 24 * 60) return out;
    out.end = hhmm(stop);
  }
  return out;
}
