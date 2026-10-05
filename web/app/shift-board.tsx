'use client';

import { useEffect, useId, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { addDays, rankedRequests, type Employee, type Shift, type ShiftRequest } from '@/lib/schedule';
import styles from './shift-board.module.css';

export type ShiftBoardProps = {
  shifts: Shift[];
  employees: Employee[];
  requests: ShiftRequest[];
  week: string;
  admin: boolean;
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

function localToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function ShiftBoard({ shifts, employees, requests, week, admin, employeeId, published, priorityReady, busy, filter, onRequest, onWithdraw, onOpen, onAssign, onAdd }: ShiftBoardProps) {
  const boardId = useId();
  const dates = Array.from({ length: 7 }, (_, index) => addDays(week, index));
  const firstDay = dates.find(date => shifts.some(shift => shift.date === date)) ?? week;
  const [selection, setSelection] = useState<{ week: string; date: string; filter: ShiftBoardProps['filter'] } | null>(null);
  const selectedDay = selection?.week === week && dates.includes(selection.date) ? selection.date : firstDay;

  const people = new Map(employees.map(employee => [employee.id, employee]));
  const activeEmployees = employees.filter(employee => employee.active).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const orderedRequests = rankedRequests({ employees, requests });
  const requestsByShift = new Map<string, ShiftRequest[]>();
  for (const request of orderedRequests) {
    const queue = requestsByShift.get(request.shiftId) ?? [];
    queue.push(request);
    requestsByShift.set(request.shiftId, queue);
  }
  const visibleShifts = shifts.filter(shift => {
    if (filter === 'assigned') return admin ? Boolean(shift.employeeId) : Boolean(employeeId && shift.employeeId === employeeId);
    if (filter === 'requested') return (requestsByShift.get(shift.id) ?? []).some(request => admin || request.employeeId === employeeId);
    return true;
  }).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id));

  // Keep the chosen day during polling. A new personal filter moves to a day
  // with matching shifts when the selected day has none.
  useEffect(() => {
    setSelection(previous => {
      if (previous?.week === week && previous.filter === filter) return previous;
      const hasMatches = (date: string) => visibleShifts.some(shift => shift.date === date);
      if (previous?.week === week && (filter === 'all' || hasMatches(previous.date))) return { ...previous, filter };
      const today = localToday();
      return { week, filter, date: dates.includes(today) && (filter === 'all' || hasMatches(today)) ? today : dates.find(hasMatches) ?? firstDay };
    });
  }, [week, filter, shifts, requests, employeeId, admin]);

  return <section className={styles.board} aria-label="Weekly shifts">
    <div className={styles.dayPicker} aria-label="Choose a day">
      {dates.map(date => {
        const count = visibleShifts.filter(shift => shift.date === date).length;
        return <button key={date} type="button" className={`${styles.dayButton} ${date === selectedDay ? styles.selectedDayButton : ''}`}
          data-testid="day-selector" data-date={date} aria-pressed={date === selectedDay} aria-controls={`${boardId}-${date}`}
          aria-label={`${formatDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} ${count === 1 ? 'shift' : 'shifts'}`}
          onClick={() => setSelection({ week, date, filter })}>
          <span>{formatDate(date, { weekday: 'short' })}</span>
          <strong>{Number(date.slice(-2))}</strong>
          <span className={`${styles.dayDot} ${count ? styles.hasShifts : ''}`} aria-hidden="true"/>
        </button>;
      })}
    </div>

    <div className={styles.weekGrid}>
      {dates.map(date => {
        const dayShifts = visibleShifts.filter(shift => shift.date === date);
        const dateLabel = formatDate(date, { month: 'short', day: 'numeric' });
        return <section key={date} id={`${boardId}-${date}`} className={`${styles.day} ${date === selectedDay ? styles.selectedDay : ''}`}
          data-testid="schedule-day" data-date={date} aria-labelledby={`${boardId}-${date}-heading`}>
          <header className={styles.dayHeading}>
            <h3 id={`${boardId}-${date}-heading`}><span>{formatDate(date, { weekday: 'short' })}</span> {dateLabel}</h3>
            <span className={styles.dayCount}>{dayShifts.length} {dayShifts.length === 1 ? 'shift' : 'shifts'}</span>
          </header>

          <div className={styles.cards}>
            {dayShifts.map(shift => {
              const queue = requestsByShift.get(shift.id) ?? [];
              const ownRequest = employeeId ? queue.find(request => request.employeeId === employeeId) : undefined;
              const assignedToYou = Boolean(employeeId && shift.employeeId === employeeId);
              const assignee = shift.employeeId ? people.get(shift.employeeId)?.name ?? 'Assigned employee' : null;
              const provisional = !published && shift.source === 'request-priority' && Boolean(shift.employeeId);
              const heldOpen = !shift.employeeId && shift.requestAssignmentLocked === true;
              const status = assignee ? provisional ? 'Draft assignment' : published ? 'Assigned' : 'Admin assigned' : heldOpen ? 'Held open' : 'Open shift';
              const cardLabel = `${shift.label}, ${dateLabel}, ${shift.start}–${shift.end}${shift.end <= shift.start ? ', ends next day' : ''}`;
              return <article key={shift.id} className={`${styles.card} ${assignedToYou || ownRequest ? styles.yourCard : ''}`}
                data-testid="shift-card" data-shift-id={shift.id} aria-label={cardLabel}>
                <div className={styles.shiftHeading}>
                  <h4>{shift.label}</h4>
                  <p className={styles.time}>{shift.start}–{shift.end}{shift.end <= shift.start && <span>Next day</span>}</p>
                </div>

                <div className={styles.assignment}>
                  {assignee && <strong>{assignedToYou ? 'You' : assignee}</strong>}
                  <span className={assignedToYou ? styles.yourStatus : styles.status}>{status}</span>
                </div>

                {queue.length > 0 && <div className={styles.queue} data-testid="request-queue" data-shift-id={shift.id}>
                  <p>{priorityReady ? 'Requests by priority' : 'Requests · priority pending'}</p>
                  <ol aria-label={`Request queue for ${shift.label} on ${dateLabel}`}>
                    {queue.map(request => {
                      const person = people.get(request.employeeId);
                      const own = request.employeeId === employeeId;
                      const selected = shift.employeeId === request.employeeId;
                      return <li key={request.id} data-employee-id={request.employeeId} className={own ? styles.yourRequest : undefined}>
                        <span className={styles.rank} aria-label={priorityReady && person ? `Priority ${person.priority}` : 'Priority not set'}>{priorityReady && person ? `#${person.priority}` : '—'}</span>
                        <span className={styles.requestName}>{person?.name ?? 'Employee'}{own && <span className={styles.you}> (you)</span>}</span>
                        {selected && <Check size={14} className={styles.selectedCheck} role="img" aria-label={provisional ? 'Draft assignment' : 'Assigned'}/>}
                      </li>;
                    })}
                  </ol>
                </div>}

                <div className={styles.actions}>
                  {admin && <label className={styles.assignLabel}>
                    <span>Assign</span>
                    <select value={shift.employeeId ?? ''} disabled={busy} data-testid="inline-assignee" data-shift-id={shift.id}
                      aria-label={`Assign ${shift.label} on ${dateLabel}`} onChange={event => onAssign(shift, event.target.value || null)}>
                      <option value="">Open</option>
                      {shift.employeeId && !activeEmployees.some(person => person.id === shift.employeeId) && <option value={shift.employeeId}>{assignee}</option>}
                      {activeEmployees.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                    </select>
                  </label>}
                  {!admin && !published && <button type="button" className={`${styles.actionButton} ${ownRequest ? styles.cancelButton : styles.requestButton}`}
                    disabled={busy} data-testid={ownRequest ? 'cancel-request' : 'request-shift'} data-shift-id={shift.id}
                    aria-label={`${ownRequest ? 'Cancel request for' : 'Request'} ${shift.label} on ${dateLabel}`}
                    onClick={() => ownRequest ? onWithdraw(ownRequest) : onRequest(shift)}>{ownRequest ? 'Cancel request' : 'Request shift'}</button>}
                  <button type="button" className={styles.detailsButton} disabled={busy} data-testid="shift-details" data-shift-id={shift.id}
                    aria-label={`Details for ${shift.label} on ${dateLabel}`} onClick={() => onOpen(shift)}>Details</button>
                </div>
              </article>;
            })}
            {!dayShifts.length && <p className={styles.emptyDay}>{filter === 'assigned' ? admin ? 'No assigned shifts.' : 'No shifts assigned to you.' : filter === 'requested' ? admin ? 'No requested shifts.' : 'No requests from you.' : 'No shifts.'}</p>}
          </div>
          {admin && onAdd && <button type="button" className={styles.addButton} disabled={busy} aria-label={`Add shift on ${dateLabel}`} onClick={() => onAdd(date)}><Plus size={15}/> Add shift</button>}
        </section>;
      })}
    </div>
  </section>;
}
