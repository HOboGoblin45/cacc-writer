/**
 * server/integrations/calendarSync.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Calendar integration for inspection scheduling.
 *
 * Syncs inspections with:
 *   - Google Calendar (via API)
 *   - iCal format (Apple Calendar, Outlook)
 *   - Generates .ics files for download
 *
 * Also generates optimized daily schedule with drive time estimates.
 */

import { getDb } from '../db/database.js';
import { dbAll } from '../db/database.js';
import log from '../logger.js';

/**
 * Generate an iCal (.ics) file for a single inspection.
 */
export function generateIcsEvent(inspection) {
  const start = formatIcsDate(inspection.scheduled_date, inspection.scheduled_time || '09:00');
  const duration = inspection.duration_minutes || 45;
  const end = addMinutesToIcsDate(start, duration);

  const address = [inspection.address, inspection.city, inspection.state, inspection.zip].filter(Boolean).join(', ');

  return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Appraisal Agent//Inspection//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
BEGIN:VEVENT
DTSTART:${start}
DTEND:${end}
SUMMARY:Inspection — ${address}
DESCRIPTION:Appraisal inspection\\nCase: ${inspection.case_id || ''}\\nType: ${inspection.inspection_type || 'Interior'}\\nContact: ${inspection.contact_name || 'N/A'} ${inspection.contact_phone || ''}\\n\\nNotes: ${(inspection.access_notes || '').replace(/\n/g, '\\n')}
LOCATION:${address}
STATUS:CONFIRMED
CATEGORIES:Appraisal,Inspection
BEGIN:VALARM
TRIGGER:-PT30M
ACTION:DISPLAY
DESCRIPTION:Inspection in 30 minutes — ${address}
END:VALARM
END:VEVENT
END:VCALENDAR`;
}

/**
 * Generate an iCal file for an entire day's schedule.
 */
export function generateDayScheduleIcs(userId, date) {
  const db = getDb();
  const inspections = db.prepare(`
    SELECT i.*, json_extract(f.facts_json, '$.subject.address') as fact_address,
           json_extract(f.facts_json, '$.subject.city') as fact_city,
           json_extract(f.facts_json, '$.subject.state') as fact_state,
           json_extract(f.facts_json, '$.subject.zip') as fact_zip
    FROM inspections i
    LEFT JOIN case_facts f ON f.case_id = i.case_id
    WHERE i.user_id = ? AND i.scheduled_date = ?
    ORDER BY i.scheduled_time
  `).all(userId, date);

  if (inspections.length === 0) return null;

  let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Appraisal Agent//Schedule//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Appraisal Agent — ${date}
`;

  for (const insp of inspections) {
    const address = insp.address || insp.fact_address || 'Unknown';
    const city = insp.city || insp.fact_city || '';
    const state = insp.state || insp.fact_state || '';
    const zip = insp.zip || insp.fact_zip || '';
    const fullAddr = [address, city, state, zip].filter(Boolean).join(', ');
    const start = formatIcsDate(date, insp.scheduled_time || '09:00');
    const end = addMinutesToIcsDate(start, insp.duration_minutes || 45);

    ics += `BEGIN:VEVENT
DTSTART:${start}
DTEND:${end}
SUMMARY:Inspection — ${address}
LOCATION:${fullAddr}
DESCRIPTION:Case: ${insp.case_id || ''}\\nType: ${insp.inspection_type || 'Interior'}\\nContact: ${insp.contact_name || 'N/A'} ${insp.contact_phone || ''}
STATUS:CONFIRMED
CATEGORIES:Appraisal
BEGIN:VALARM
TRIGGER:-PT30M
ACTION:DISPLAY
DESCRIPTION:Inspection in 30 minutes
END:VALARM
END:VEVENT
`;
  }

  ics += 'END:VCALENDAR';
  return ics;
}

/**
 * Generate daily schedule summary with drive time estimates.
 */
export function getDailyBrief(userId, date) {
  const db = getDb();
  const inspections = db.prepare(`
    SELECT i.*, r.form_type,
           json_extract(f.facts_json, '$.subject.address') as address,
           json_extract(f.facts_json, '$.subject.city') as city,
           json_extract(f.facts_json, '$.order.fee') as fee,
           json_extract(f.facts_json, '$.order.dueDate') as due_date
    FROM inspections i
    LEFT JOIN case_records r ON r.case_id = i.case_id
    LEFT JOIN case_facts f ON f.case_id = i.case_id
    WHERE i.user_id = ? AND i.scheduled_date = ?
    ORDER BY i.scheduled_time
  `).all(userId, date);

  const totalFees = inspections.reduce((sum, i) => sum + (parseFloat(i.fee || 0)), 0);
  const totalDuration = inspections.reduce((sum, i) => sum + (i.duration_minutes || 45), 0);
  const estimatedDriveMinutes = Math.max(0, (inspections.length - 1) * 20); // rough 20 min between stops

  return {
    date,
    inspectionCount: inspections.length,
    totalDuration: totalDuration + estimatedDriveMinutes,
    totalFees: Math.round(totalFees),
    estimatedDriveMinutes,
    schedule: inspections.map((insp, i) => ({
      order: i + 1,
      time: insp.scheduled_time || 'TBD',
      address: insp.address || insp.fact_address || 'Unknown',
      city: insp.city || '',
      formType: insp.form_type || '1004',
      fee: parseFloat(insp.fee || 0),
      dueDate: insp.due_date,
      caseId: insp.case_id,
      durationMinutes: insp.duration_minutes || 45,
      contact: insp.contact_name || null,
      phone: insp.contact_phone || null,
    })),
    summary: `${inspections.length} inspection${inspections.length !== 1 ? 's' : ''} scheduled. Est. ${Math.round((totalDuration + estimatedDriveMinutes) / 60 * 10) / 10} hours total. $${Math.round(totalFees).toLocaleString()} in fees.`,
  };
}

// Helpers
function formatIcsDate(date, time) {
  const d = date.replace(/-/g, '');
  const t = (time || '09:00').replace(/:/g, '') + '00';
  return `${d}T${t}`;
}

function addMinutesToIcsDate(icsDate, minutes) {
  const year = parseInt(icsDate.slice(0, 4));
  const month = parseInt(icsDate.slice(4, 6)) - 1;
  const day = parseInt(icsDate.slice(6, 8));
  const hour = parseInt(icsDate.slice(9, 11));
  const min = parseInt(icsDate.slice(11, 13));
  const d = new Date(year, month, day, hour, min + minutes);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`;
}

export default { generateIcsEvent, generateDayScheduleIcs, getDailyBrief };
