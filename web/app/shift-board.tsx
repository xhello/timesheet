'use client';

import { Check, Plus } from 'lucide-react';
import { addDays, rankedRequests, type Employee, type Shift, type ShiftRequest } from '@/lib/schedule';
import styles from './shift-board.module.css';

export type ShiftBoardProps = {
  shifts: Shift[];
  employees: Employee[];
  requests: ShiftRequest[];
  week: string;
  admin: boolean;
  readOnly?: boolean;
  employeeId?: string;
  published: boolean;
  priorityReady: boolean;
  busy: boolean;
  filter: 'all' | 'assigned' | 'requested';
  onRequest: (shift: Shift) => void;
  onWithdraw: (request: ShiftRequest) => void;
  onOpen: (shift: Shift) => void;
  onAssign: (shift: Shift, employeeId: string | null) => void;
  onAdd?: (date: string) => void;
};

function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

function rowTone(shift: Shift) {
  if (/clean/i.test(shift.label)) return styles.cleaning;
  if (shift.end <= shift.start) return styles.night;
  if (shift.start < '12:00') return styles.morning;
  if (shift.start < '17:00') return styles.afternoon;
  return styles.evening;
}

export default function ShiftBoard({ shifts, employees, requests, week, admin, readOnly = false, employeeId, published, priorityReady, busy, filter, onRequest, onWithdraw, onOpen, onAssign, onAdd }: ShiftBoardProps) {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const people = new Map(employees.map(employee => [employee.id, employee]));
  const activeEmployees = employees.filter(employee => employee.active).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const requestsByShift = new Map<string, ShiftRequest[]>();
  for (const request of readOnly ? [] : rankedRequests({ employees, requests })) {
    const queue = requestsByShift.get(request.shiftId) ?? [];
    queue.push(request);
    requestsByShift.set(request.shiftId, queue);
  }
  const visibleShifts = shifts.filter(shift => {
    if (filter === 'assigned') return admin ? Boolean(shift.employeeId) : Boolean(employeeId && shift.employeeId === employeeId);
    if (filter === 'requested') return (requestsByShift.get(shift.id) ?? []).some(request => admin || request.employeeId === employeeId);
    return true;
  }).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  // Different hours and labels get their own row. Multiple slots with the same
  // hours remain separate assignments inside the same day cell.
  const rows = new Map<string, { example: Shift; shifts: Shift[] }>();
  for (const shift of visibleShifts) {
    const key = JSON.stringify([shift.start, shift.end, shift.label]);
    const row = rows.get(key) ?? { example: shift, shifts: [] };
    row.shifts.push(shift);
    rows.set(key, row);
  }
  const interactive = !readOnly && (admin || Boolean(employeeId));

  return <div className={styles.scroll} data-testid="spreadsheet-scroll" tabIndex={0} role="region" aria-label={`Schedule for week of ${formatDate(week, { month: 'long', day: 'numeric' })}, scroll horizontally for all days`}>
    <table className={styles.sheet} data-testid="schedule-grid" data-week={week}>
      <caption className={styles.caption}>Week of {formatDate(week, { month: 'long', day: 'numeric', year: 'numeric' })}</caption>
      <colgroup><col className={styles.timeColumn}/>{dates.map(date => <col key={date}/>)}</colgroup>
      <thead><tr><th scope="col" className={styles.corner}>Shift / time</th>{dates.map(date => <th key={date} scope="col" data-date={date}><strong>{formatDate(date, { weekday: 'long' })}</strong><span>{formatDate(date, { month: 'short', day: 'numeric' })}</span></th>)}</tr></thead>
      <tbody>
        {[...rows].map(([key, row]) => <tr key={key} className={rowTone(row.example)} data-testid="shift-row">
          <th scope="row" className={styles.rowHeading}><strong>{row.example.label}</strong><span>{row.example.start}–{row.example.end}</span>{row.example.end <= row.example.start && <small>Ends next day</small>}</th>
          {dates.map(date => {
            const dayShifts = row.shifts.filter(shift => shift.date === date);
            const dateLabel = formatDate(date, { month: 'short', day: 'numeric' });
            return <td key={date} data-date={date} className={styles.cell}>
              {dayShifts.length ? dayShifts.map(shift => {
                const queue = requestsByShift.get(shift.id) ?? [];
                const ownRequest = employeeId ? queue.find(request => request.employeeId === employeeId) : undefined;
                const assignedToYou = Boolean(employeeId && shift.employeeId === employeeId);
                const assignee = shift.employeeId ? people.get(shift.employeeId)?.name ?? 'Assigned employee' : null;
                const provisional = !published && shift.source === 'request-priority' && Boolean(shift.employeeId);
                return <div key={shift.id} className={`${styles.slot} ${assignedToYou || ownRequest ? styles.yourSlot : ''}`} data-testid="shift-card" data-shift-id={shift.id} aria-label={`${shift.label}, ${dateLabel}, ${shift.start}–${shift.end}`}>
                  <div className={styles.assignment}><strong data-testid="assignment-name" className={!assignee ? styles.open : undefined}>{assignee ?? 'Open'}</strong>{assignedToYou && <span className={styles.you}>You</span>}</div>
                  {!readOnly && provisional && <span className={styles.status}>Draft assignment</span>}
                  {!readOnly && !shift.employeeId && shift.requestAssignmentLocked && <span className={styles.status}>Held open</span>}
                  {!!queue.length && <div className={styles.queue} data-testid="request-queue" data-shift-id={shift.id}>
                    <p>{priorityReady ? 'Requests' : 'Requests · priority pending'}</p>
                    <ol aria-label={`Request queue for ${shift.label} on ${dateLabel}`}>{queue.map(request => {
                      const person = people.get(request.employeeId);
                      const own = request.employeeId === employeeId;
                      return <li key={request.id} data-employee-id={request.employeeId} className={own ? styles.yourRequest : undefined}>
                        <span className={styles.rank} aria-label={priorityReady && person ? `Priority ${person.priority}` : 'Priority not set'}>{priorityReady && person ? `#${person.priority}` : '—'}</span>
                        <span className={styles.requestName}>{person?.name ?? 'Employee'}{own && <span className={styles.you}> (you)</span>}</span>
                        {shift.employeeId === request.employeeId && <Check size={13} className={styles.selectedCheck} role="img" aria-label={provisional ? 'Draft assignment' : 'Assigned'}/>}
                      </li>;
                    })}</ol>
                  </div>}
                  {interactive && <div className={styles.actions}>
                    {admin && <select value={shift.employeeId ?? ''} disabled={busy} data-testid="inline-assignee" data-shift-id={shift.id} aria-label={`Assign ${shift.label} on ${dateLabel}`} onChange={event => onAssign(shift, event.target.value || null)}>
                      <option value="">Open</option>
                      {shift.employeeId && !activeEmployees.some(person => person.id === shift.employeeId) && <option value={shift.employeeId}>{assignee}</option>}
                      {activeEmployees.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                    </select>}
                    {!admin && !published && <button type="button" className={`${styles.actionButton} ${ownRequest ? styles.cancelButton : styles.requestButton}`} disabled={busy} data-testid={ownRequest ? 'cancel-request' : 'request-shift'} data-shift-id={shift.id} aria-label={`${ownRequest ? 'Cancel request for' : 'Request'} ${shift.label} on ${dateLabel}`} onClick={() => ownRequest ? onWithdraw(ownRequest) : onRequest(shift)}>{ownRequest ? 'Cancel request' : 'Request shift'}</button>}
                    <button type="button" className={styles.detailsButton} disabled={busy} data-testid="shift-details" data-shift-id={shift.id} aria-label={`Details for ${shift.label} on ${dateLabel}`} onClick={() => onOpen(shift)}>Details</button>
                  </div>}
                </div>;
              }) : <span className={styles.emptyCell} aria-label="No shift">—</span>}
            </td>;
          })}
        </tr>)}
        {!rows.size && <tr><td colSpan={8} className={styles.empty}>{filter === 'assigned' ? 'No shifts assigned to you this week.' : filter === 'requested' ? 'No requests from you this week.' : 'No shifts this week.'}</td></tr>}
      </tbody>
      {admin && !readOnly && onAdd && <tfoot><tr><th scope="row" className={styles.corner}><span className={styles.footerLabel}>Add a shift</span></th>{dates.map(date => <td key={date}><button type="button" className={styles.addButton} disabled={busy} aria-label={`Add shift on ${formatDate(date, { month: 'short', day: 'numeric' })}`} onClick={() => onAdd(date)}><Plus size={14}/> Add</button></td>)}</tr></tfoot>}
    </table>
  </div>;
}
