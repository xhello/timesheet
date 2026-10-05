export type Employee = { id: string; name: string; hireDate: string; priority: number; userId?: string; codeHash?: string; codeExpires?: number; active: boolean };
export type Shift = { id: string; date: string; start: string; end: string; label: string; employeeId: string | null; source: string; note?: string; hourLimitOverride?: boolean };
export type ShiftRequest = { id: string; shiftId: string; employeeId: string; createdAt: string; note: string };
export type WorkHourSettings = { dailyMaxHours: number; weeklyMaxHours: number };
export type HourLimitIssue = { employeeId: string; kind: 'day'|'week'; period: string; hours: number; limit: number };
export type State = { ownerId: string; ownerName: string; employees: Employee[]; shifts: Shift[]; requests: ShiftRequest[]; weeks: Record<string, 'draft'|'published'>; imported: boolean; priorityConfirmed: boolean; notes: string[]; settings?: WorkHourSettings };
export const DEFAULT_WORK_HOUR_SETTINGS: WorkHourSettings = { dailyMaxHours: 8, weeklyMaxHours: 40 };
export function workHourSettings(state: { settings?: WorkHourSettings }): WorkHourSettings { return {...DEFAULT_WORK_HOUR_SETTINGS,...state.settings}; }
export const INITIAL_WEEK = '2026-10-11';
export const SOURCE_URL = 'https://docs.google.com/spreadsheets/d/1ZYFtBImQ6AB2iqnJPl_FNAq7GoCMVN2W-KXh_6_bIpY/edit?gid=1954940101#gid=1954940101';
export function addDays(date: string, days: number) { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
export function weekOf(date: string) { return addDays(date, -new Date(date+'T12:00:00Z').getUTCDay()); }
export function interval(s: Shift) { const start = Date.parse(s.date+'T'+s.start+':00Z'); let end = Date.parse(s.date+'T'+s.end+':00Z'); if(end<=start) end+=86400000; return [start,end]; }
export function overlaps(a: Shift,b: Shift) { const [as,ae]=interval(a),[bs,be]=interval(b); return as<be && bs<ae; }
export function conflict(state: State, shift: Shift, employeeId: string, exclude?: string) { return state.shifts.some(s=>s.id!==shift.id && s.id!==exclude && s.employeeId===employeeId && overlaps(s,shift)); }
// Civil schedule hours: split overnight work at midnight and union compatible duties.
// Calendar dates use UTC arithmetic to avoid the browser/device timezone changing totals.
export function dailyWorkHours(shifts: Shift[], employeeId: string): Record<string,number> {
  const byDay: Record<string,[number,number][]> = {};
  for(const shift of shifts) {
    if(shift.employeeId!==employeeId) continue;
    const [start,end]=interval(shift);
    for(let cursor=start;cursor<end;) {
      const day=new Date(cursor).toISOString().slice(0,10);
      const until=Math.min(end,Date.parse(addDays(day,1)+'T00:00:00Z'));
      (byDay[day]??=[]).push([cursor,until]);cursor=until;
    }
  }
  return Object.fromEntries(Object.entries(byDay).map(([day,segments])=>{
    segments.sort((a,b)=>a[0]-b[0]);let total=0;let [start,end]=segments[0];
    for(const [nextStart,nextEnd] of segments.slice(1)) {
      if(nextStart<=end)end=Math.max(end,nextEnd);
      else {total+=end-start;start=nextStart;end=nextEnd;}
    }
    return [day,(total+end-start)/3600000];
  }));
}
export function weeklyWorkHours(days:Record<string,number>,week:string) {return Object.entries(days).reduce((sum,[day,hours])=>sum+(weekOf(day)===week?Math.round(hours*60):0),0)/60;}
function touchedDates(shift:Shift) {return Object.keys(dailyWorkHours([{...shift,employeeId:'candidate'}],'candidate'));}
function issuesForDates(shifts:Shift[],employeeId:string,dates:string[],settings:WorkHourSettings):HourLimitIssue[] {
  const days=dailyWorkHours(shifts,employeeId),issues:HourLimitIssue[]=[];
  for(const day of new Set(dates))if((days[day]??0)>settings.dailyMaxHours)issues.push({employeeId,kind:'day',period:day,hours:days[day],limit:settings.dailyMaxHours});
  for(const week of new Set(dates.map(weekOf))) {const hours=weeklyWorkHours(days,week);if(hours>settings.weeklyMaxHours)issues.push({employeeId,kind:'week',period:week,hours,limit:settings.weeklyMaxHours});}
  return issues;
}
export function assignmentHourIssues(state:Pick<State,'shifts'|'settings'>,shift:Shift,employeeId:string,exclude?:string) {
  const proposed=state.shifts.filter(s=>s.id!==shift.id&&s.id!==exclude);
  proposed.push({...shift,employeeId});
  return issuesForDates(proposed,employeeId,touchedDates(shift),workHourSettings(state));
}
export function weekHourIssues(state:Pick<State,'shifts'|'settings'|'employees'>,week:string):HourLimitIssue[] {
  return state.employees.flatMap(employee=>{
    const dates=Array.from({length:7},(_,i)=>addDays(week,i));
    for(const s of state.shifts)if(s.employeeId===employee.id&&weekOf(s.date)===week)dates.push(...touchedDates(s));
    return issuesForDates(state.shifts,employee.id,dates,workHourSettings(state));
  });
}
export function formatHours(hours:number) {return Number(hours.toFixed(2)).toString();}
export function hourIssueText(issue:HourLimitIssue) {return `${formatHours(issue.hours)} hours ${issue.kind==='day'?'on':'in the week of'} ${issue.period} (limit ${formatHours(issue.limit)})`;}
export function fillByPriority(state: State, week: string) {
  let assigned=0;
  const shifts=state.shifts.filter(s=>weekOf(s.date)===week).sort((a,b)=>(a.date+a.start+a.id).localeCompare(b.date+b.start+b.id));
  for(const shift of shifts) {
    if(shift.employeeId) continue;
    const requests=state.requests.filter(r=>r.shiftId===shift.id).sort((a,b)=>{
      const ea=state.employees.find(e=>e.id===a.employeeId),eb=state.employees.find(e=>e.id===b.employeeId);
      return (ea?.priority??999)-(eb?.priority??999)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
    });
    const winner=requests.find(r=>state.employees.some(e=>e.id===r.employeeId&&e.active)&&!conflict(state,shift,r.employeeId)&&assignmentHourIssues(state,shift,r.employeeId).length===0);
    if(winner){shift.employeeId=winner.employeeId;shift.source='priority';shift.hourLimitOverride=false;assigned++;}
  }
  return assigned;
}
