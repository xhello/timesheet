'use client';
import { useEffect, useState } from 'react';
import { Table, TableHeader, TableHead, TableRow, TableBody, TableCell } from '@/components/ui/table';
import { addDays, dailyWorkHours, weeklyWorkHours, weekHourIssues, formatHours, hourIssueText, type WorkHourSettings, type Employee, type Shift } from '@/lib/schedule';

type Props = { settings: WorkHourSettings; employees: Employee[]; shifts: Shift[]; week: string; busy: boolean; onSave: (settings: WorkHourSettings) => Promise<unknown> };

export default function WorkHourSettingsPanel({ settings, employees, shifts, week, busy, onSave }: Props) {
  const [daily, setDaily] = useState(String(settings.dailyMaxHours));
  const [weekly, setWeekly] = useState(String(settings.weeklyMaxHours));
  useEffect(() => { setDaily(String(settings.dailyMaxHours)); setWeekly(String(settings.weeklyMaxHours)); }, [settings.dailyMaxHours, settings.weeklyMaxHours]);
  const issues = weekHourIssues({ settings, shifts, employees }, week);
  const overLimit = new Set(issues.map(issue => issue.employeeId)).size;
  return <div className="hours-settings-layout">
    <section className="content-card">
      <div className="section-heading"><div><h3>Work-hour limits</h3><p>Automatic assignments stay within these limits. You can approve exceptions.</p></div></div>
      <form className="form-stack" onSubmit={event => { event.preventDefault(); void onSave({ dailyMaxHours: Number(daily), weeklyMaxHours: Number(weekly) }); }}>
        <div className="form-row">
          <label>Maximum hours per day<input type="number" min="0.25" max="24" step="0.25" required value={daily} onChange={event => setDaily(event.target.value)}/></label>
          <label>Maximum hours per week<input type="number" min="0.25" max="168" step="0.25" required value={weekly} onChange={event => setWeekly(event.target.value)}/></label>
        </div>
        <button className="btn primary" disabled={busy || (Number(daily) === settings.dailyMaxHours && Number(weekly) === settings.weeklyMaxHours)}>Save work-hour limits</button>
      </form>
      <details className="hours-explainer">
        <summary>How hours are counted</summary>
        <p>Weeks run Sunday through Saturday. Overnight shifts split at midnight; overlapping duties count once. Changing limits may update tentative assignments. Manual and published assignments stay in place.</p>
      </details>
    </section>
    <section className="content-card">
      <details open={overLimit > 0}>
        <summary className="hours-summary">Weekly hours · {overLimit ? `${overLimit} over limit` : 'Within limits'}</summary>
        <p className="helper">{week} – {addDays(week, 6)}</p>
        <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Daily max</TableHead><TableHead>Week total</TableHead><TableHead>Review</TableHead></TableRow></TableHeader>
          <TableBody>{employees.map(employee => {
            const days = dailyWorkHours(shifts, employee.id);
            const total = weeklyWorkHours(days, week);
            const highest = Math.max(0, ...Array.from({ length: 7 }, (_, index) => days[addDays(week, index)] ?? 0));
            const employeeIssues = issues.filter(issue => issue.employeeId === employee.id);
            return <TableRow key={employee.id}>
              <TableCell><strong>{employee.name}</strong></TableCell>
              <TableCell className={highest > settings.dailyMaxHours ? 'hours-over' : ''}>{formatHours(highest)} / {formatHours(settings.dailyMaxHours)}</TableCell>
              <TableCell className={total > settings.weeklyMaxHours ? 'hours-over' : ''}>{formatHours(total)} / {formatHours(settings.weeklyMaxHours)}</TableCell>
              <TableCell>{employeeIssues.length ? <ul className="hours-issue-list">{employeeIssues.map(issue => <li key={issue.kind + issue.period}>{hourIssueText(issue)}</li>)}</ul> : <span className="muted">Within limits</span>}</TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </details>
    </section>
  </div>;
}
