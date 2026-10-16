// SPDX-License-Identifier: Apache-2.0
/** Five-field cron (minute hour day-of-month month day-of-week, UTC), for the schedule trigger's next fire time. */
const FIELDS: [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

export function parseCron(expression: string): Set<number>[] | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (const [i, part] of parts.entries()) {
    const [min, max] = FIELDS[i]!;
    const set = new Set<number>();
    for (const item of part.split(",")) {
      const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(item);
      if (!m) return null;
      const step = m[2] === undefined ? 1 : Number(m[2]);
      const range = m[1] === "*" ? [min, max] : m[1]!.split("-").map(Number);
      const from = range[0]!, to = range[1] ?? (m[2] === undefined ? from : max);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to || step < 1) return null;
      for (let v = from; v <= to; v += step) set.add(i === 4 && v === 7 ? 0 : v);
    }
    sets.push(set);
  }
  return sets;
}

/** The first matching minute strictly after `from`, within a year; null for an invalid or unsatisfiable expression. */
export function nextFire(expression: string, from: Date): Date | null {
  const sets = parseCron(expression);
  if (!sets) return null;
  const [minutes, hours, days, months, weekdays] = sets as [Set<number>, Set<number>, Set<number>, Set<number>, Set<number>];
  const anyDay = days.size === 31, anyWeekday = weekdays.size === 7;
  const t = new Date(from.getTime());
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dayMatch = anyDay && anyWeekday ? true : anyDay ? weekdays.has(t.getUTCDay()) : anyWeekday ? days.has(t.getUTCDate()) : days.has(t.getUTCDate()) || weekdays.has(t.getUTCDay());
    if (months.has(t.getUTCMonth() + 1) && dayMatch && hours.has(t.getUTCHours()) && minutes.has(t.getUTCMinutes())) return t;
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return null;
}
