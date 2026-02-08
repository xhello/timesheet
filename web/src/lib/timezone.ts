/**
 * Format and parse times in a business's timezone (set at clock-in location)
 * so displayed times are consistent and avoid user/browser timezone confusion.
 * Storage remains UTC (ISO); only display and form inputs use business timezone.
 */

const DEFAULT_TZ = 'UTC';

/**
 * Format an ISO UTC date string for display in a given IANA timezone.
 */
export function formatInTimezone(
  isoString: string,
  timeZone: string = DEFAULT_TZ,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }
): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', { ...options, timeZone });
}

/**
 * Date only in business timezone.
 * Options default to weekday + short month + day (e.g. "Fri, Feb 8"); pass { year: 'numeric' } to include year.
 */
export function formatDateInTimezone(
  isoString: string,
  timeZone: string = DEFAULT_TZ,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }
): string {
  return new Date(isoString).toLocaleDateString('en-US', { ...options, timeZone });
}

/**
 * Time only (e.g. "2:30 PM") in business timezone.
 */
export function formatTimeInTimezone(
  isoString: string,
  timeZone: string = DEFAULT_TZ
): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/**
 * Time with seconds (e.g. "2:30:45 PM") in business timezone — for live clock display.
 */
export function formatTimeWithSecondsInTimezone(
  dateOrIso: Date | string,
  timeZone: string = DEFAULT_TZ
): string {
  const date = typeof dateOrIso === 'string' ? new Date(dateOrIso) : dateOrIso;
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone,
  });
}

/**
 * Get date/time parts in a timezone (for building datetime-local or computing offset).
 */
function getPartsInTimezone(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => {
    const p = parts.find((x) => x.type === type);
    return p ? parseInt(p.value, 10) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/**
 * Convert a UTC instant to a "datetime-local" value string (YYYY-MM-DDTHH:mm)
 * in the given timezone, for use in <input type="datetime-local">.
 */
export function toDateTimeLocalInTimezone(isoString: string, timeZone: string = DEFAULT_TZ): string {
  const date = new Date(isoString);
  const { year, month, day, hour, minute } = getPartsInTimezone(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

/**
 * Parse a datetime-local string (YYYY-MM-DDTHH:mm) as if it were in the given
 * timezone, and return the equivalent UTC ISO string.
 * Used when the user enters a time in the business timezone (e.g. admin/employee forms).
 */
export function dateTimeLocalToUTC(dateTimeLocalStr: string, timeZone: string = DEFAULT_TZ): string {
  const [datePart, timePart] = dateTimeLocalStr.split('T');
  if (!datePart || !timePart) return new Date(dateTimeLocalStr).toISOString();
  const [y, m, d] = datePart.split('-').map(Number);
  const [H, M] = timePart.split(':').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d, H, M, 0, 0);
  let candidate = new Date(targetUtc);
  for (let i = 0; i < 3; i++) {
    const parts = getPartsInTimezone(candidate, timeZone);
    const localMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
    const offsetMs = candidate.getTime() - localMs;
    candidate = new Date(targetUtc + offsetMs);
  }
  return candidate.toISOString();
}
