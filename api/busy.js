import ical from 'node-ical';

const FEED_URLS = [
  process.env.CAL_SLOT_1_URL,
  process.env.CAL_SLOT_2_URL,
  process.env.CAL_SLOT_3_URL,
  process.env.CAL_SLOT_4_URL,
  process.env.CAL_SLOT_5_URL,
  process.env.CAL_SLOT_6_URL,
  process.env.CAL_SLOT_7_URL,
  process.env.CAL_SLOT_8_URL,
  process.env.CAL_SLOT_9_URL,
  process.env.CAL_SLOT_10_URL,
].filter(Boolean);

function toUtcIcs(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export default async function handler(req, res) {
  try {
    if (!FEED_URLS.length) {
      return res.status(400).send('Configure CAL_SLOT_1_URL (and any additional CAL_SLOT_n_URL) in Vercel Environment Variables.');
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + 270 * 24 * 3600 * 1000);
    const slots = [];

    await Promise.all(
      FEED_URLS.map(async (url) => {
        try {
          const data = await ical.async.fromURL(url);
          for (const ev of Object.values(data)) {
            if (!ev || ev.type !== 'VEVENT' || !ev.start || !ev.end) continue;
            if (String(ev.transparency || '').toUpperCase() === 'TRANSPARENT') continue;
            if (ev.rrule) {
              const duration = ev.end.getTime() - ev.start.getTime();
              for (const d of ev.rrule.between(now, horizon, true)) {
                slots.push({ start: d, end: new Date(d.getTime() + duration) });
              }
            } else if (ev.end >= now && ev.start <= horizon) {
              slots.push({ start: ev.start, end: ev.end });
            }
          }
        } catch (err) {
          console.error('Feed fetch error:', err && err.message ? err.message : err);
        }
      })
    );

    slots.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const s of slots) {
      const prev = merged[merged.length - 1];
      if (prev && s.start <= prev.end) {
        if (s.end > prev.end) prev.end = s.end;
      } else {
        merged.push({ start: s.start, end: s.end });
      }
    }

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Consolidated Busy Feed//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Consolidated Busy Hours',
      'X-WR-TIMEZONE:UTC'
    ];

    merged.forEach((m, i) => {
      lines.push(
        'BEGIN:VEVENT',
        `UID:busy-${i}-${toUtcIcs(m.start)}@busy-feed`,
        `DTSTART:${toUtcIcs(m.start)}`,
        `DTEND:${toUtcIcs(m.end)}`,
        'SUMMARY:Busy',
        'TRANSP:OPAQUE',
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
    });

    lines.push('END:VCALENDAR');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate');
    return res.status(200).send(lines.join('\r\n') + '\r\n');
  } catch (err) {
    return res.status(500).send('Error generating busy feed.');
  }
}
