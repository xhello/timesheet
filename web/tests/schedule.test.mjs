import test from 'node:test';
import assert from 'node:assert/strict';
import {fillByPriority, overlaps, weekOf, rankedRequests, reconcileRequestAssignments} from '../lib/schedule.ts';
const shift=(id,date,start,end,employeeId=null)=>({id,date,start,end,label:'Desk',employeeId,source:'test'});
const request=(id,shiftId,employeeId,createdAt='2026-10-01T00:00:00Z')=>({id,shiftId,employeeId,createdAt,note:''});
function state(shifts,requests){return {ownerId:'owner',ownerName:'Admin',employees:[{id:'senior',priority:1,active:true},{id:'junior',priority:2,active:true}],shifts,requests,weeks:{},priorityConfirmed:true,imported:false,notes:[]};}
test('custom priority wins over submission time',()=>{const s=state([shift('a','2026-10-11','07:30','13:00')],[request('j','a','junior'),request('s','a','senior','2026-10-02T00:00:00Z')]);assert.equal(fillByPriority(s,'2026-10-11'),1);assert.equal(s.shifts[0].employeeId,'senior');});
test('existing manual assignments are preserved',()=>{const s=state([shift('a','2026-10-11','07:30','13:00','junior')],[request('s','a','senior')]);assert.equal(fillByPriority(s,'2026-10-11'),0);assert.equal(s.shifts[0].employeeId,'junior');});
test('overnight conflicts cross midnight and exact boundaries are allowed',()=>{const night=shift('n','2026-10-11','22:00','06:00');assert.ok(overlaps(night,shift('a','2026-10-12','05:00','07:00')));assert.equal(overlaps(night,shift('b','2026-10-12','06:00','10:00')),false);});
test('priority assignment skips a conflicting employee and uses next requester',()=>{const s=state([shift('n','2026-10-11','22:00','06:00','senior'),shift('a','2026-10-12','05:00','08:00')],[request('s','a','senior'),request('j','a','junior')]);assert.equal(fillByPriority(s,'2026-10-11'),1);assert.equal(s.shifts[1].employeeId,'junior');});
test('no request means no auto assignment; other weeks untouched',()=>{const s=state([shift('a','2026-10-11','07:30','13:00'),shift('b','2026-10-18','07:30','13:00')],[request('r','b','senior')]);assert.equal(fillByPriority(s,'2026-10-11'),0);assert.equal(s.shifts[1].employeeId,null);assert.equal(weekOf('2026-10-17'),'2026-10-11');});

const {dailyWorkHours,weeklyWorkHours,assignmentHourIssues,weekHourIssues,workHourSettings}=await import('../lib/schedule.ts');
test('old saved workspaces get 8/40 defaults without replacing state',()=>{const s=state([],[]);assert.deepEqual(workHourSettings(s),{dailyMaxHours:8,weeklyMaxHours:40});assert.equal(s.settings,undefined);});
test('exact daily limit passes and a minute over fails',()=>{const s=state([shift('a','2026-10-11','08:00','12:00','senior')],[]);assert.equal(assignmentHourIssues(s,shift('b','2026-10-11','12:00','16:00'),'senior').length,0);assert.equal(assignmentHourIssues(s,shift('b','2026-10-11','12:00','16:01'),'senior')[0].kind,'day');});
test('overnight work splits across calendar dates and Sunday week boundary',()=>{const days=dailyWorkHours([shift('night','2026-10-17','22:00','06:00','senior')],'senior');assert.deepEqual(days,{'2026-10-17':2,'2026-10-18':6});assert.equal(weeklyWorkHours(days,'2026-10-11'),2);assert.equal(weeklyWorkHours(days,'2026-10-18'),6);const s=state([shift('night','2026-10-17','22:00','06:00','senior')],[]);assert.ok(assignmentHourIssues(s,shift('a','2026-10-18','07:30','13:00'),'senior').some(i=>i.hours===11.5));});
test('overlapping compatible duties count as one interval',()=>{const days=dailyWorkHours([shift('desk','2026-10-11','17:00','22:00','senior'),shift('cleaning','2026-10-11','17:30','20:30','senior')],'senior');assert.equal(days['2026-10-11'],5);});
test('40-hour exact weekly limit passes, next minute fails',()=>{const shifts=Array.from({length:4},(_,i)=>shift(String(i),`2026-10-${11+i}`,'08:00','16:00','senior'));const s=state(shifts,[]);assert.equal(assignmentHourIssues(s,shift('friday','2026-10-15','08:00','16:00'),'senior').length,0);s.shifts.push(shift('friday','2026-10-15','08:00','16:00','senior'));const issues=assignmentHourIssues(s,shift('sat','2026-10-16','08:00','08:01'),'senior');assert.equal(issues.length,1);assert.equal(issues[0].kind,'week');});
test('move removes the source before checking destination totals',()=>{const original=shift('a','2026-10-11','08:00','16:00','senior'),target=shift('b','2026-10-11','09:00','17:00');const s=state([original,target],[]);assert.equal(assignmentHourIssues(s,target,'senior','a').length,0);assert.equal(assignmentHourIssues(s,target,'senior').length,1);});
test('auto assignment skips capped priority winner and uses next eligible employee',()=>{const s=state([shift('existing','2026-10-11','08:00','16:00','senior'),shift('open','2026-10-11','16:00','18:00')],[request('one','open','senior'),request('two','open','junior')]);assert.equal(fillByPriority(s,'2026-10-11'),1);assert.equal(s.shifts[1].employeeId,'junior');});
test('auto assignment accumulates hours for successive shifts',()=>{const s=state([shift('a','2026-10-11','08:00','13:00'),shift('b','2026-10-11','13:00','18:00')],[request('a','a','senior'),request('b','b','senior')]);assert.equal(fillByPriority(s,'2026-10-11'),1);assert.equal(s.shifts[1].employeeId,null);});
test('imported overages remain and are reported at publish review',()=>{const s=state([shift('a','2026-10-11','07:30','13:00','senior'),shift('b','2026-10-11','17:30','20:30','senior')],[]);const issues=weekHourIssues(s,'2026-10-11');assert.equal(issues[0].hours,8.5);assert.equal(s.shifts[0].employeeId,'senior');});
test('custom limits are applied',()=>{const s=state([],[]);s.settings={dailyMaxHours:6,weeklyMaxHours:30};assert.equal(assignmentHourIssues(s,shift('a','2026-10-11','08:00','15:00'),'senior')[0].limit,6);});
test('fractional daily hours totaling exactly 40 do not trigger floating point overages',()=>{const minutes=[1,249,480,480,480,480,230];const days=Object.fromEntries(minutes.map((m,i)=>[`2026-10-${11+i}`,m/60]));assert.equal(weeklyWorkHours(days,'2026-10-11'),40);});

test('request queues rank active employees by priority, timestamp, then id without changing saved order',()=>{
  const s=state([], [request('later','a','senior','2026-10-02T00:00:00Z'),request('junior','a','junior'),request('b','a','senior'),request('a','a','senior'),request('elsewhere','b','senior'),request('inactive','a','inactive'),request('missing','a','missing')]);
  s.employees.push({id:'inactive',priority:0,active:false});
  const before=structuredClone(s.requests);
  assert.deepEqual(rankedRequests(s,'a').map(r=>r.id),['a','b','later','junior']);
  assert.deepEqual(rankedRequests(s).map(r=>r.id),['a','b','elsewhere','later','junior']);
  assert.deepEqual(s.requests,before);
  s.employees[1].priority=1;
  assert.deepEqual(rankedRequests(s,'a').map(r=>r.id),['a','b','junior','later']);
});

test('live assignment requires a confirmed, positive, unique integer priority order',()=>{
  for(const priorities of [[0,2],[-1,2],[1,1],[1,1.5],[NaN,2],[Infinity,2]]) {
    const s=state([shift('a','2026-10-11','08:00','16:00')],[request('a','a','senior')]);
    s.employees.forEach((employee,index)=>employee.priority=priorities[index]);
    const before=structuredClone(s);
    assert.equal(reconcileRequestAssignments(s),0);
    assert.deepEqual(s,before);
  }
  const unconfirmed=state([shift('a','2026-10-11','08:00','16:00')],[request('a','a','senior')]);
  unconfirmed.priorityConfirmed=false;
  assert.equal(reconcileRequestAssignments(unconfirmed),0);
  assert.equal(unconfirmed.shifts[0].employeeId,null);
  const gaps=state([shift('a','2026-10-11','08:00','16:00')],[request('a','a','senior')]);
  gaps.employees[0].priority=3;gaps.employees[1].priority=7;
  gaps.employees.push({id:'inactive',priority:3,active:false});
  assert.equal(reconcileRequestAssignments(gaps),1);
});

test('late higher-priority requests replace live winners and withdrawals promote or clear the assignment',()=>{
  const s=state([shift('a','2026-10-11','08:00','16:00')],[request('junior','a','junior')]);
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[0].employeeId,'junior');
  assert.equal(s.shifts[0].source,'request-priority');
  s.requests.push(request('senior','a','senior','2026-10-02T00:00:00Z'));
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[0].employeeId,'senior');
  assert.equal(reconcileRequestAssignments(s),0);
  s.requests=s.requests.filter(r=>r.id!=='senior');
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[0].employeeId,'junior');
  s.requests=[];
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[0].employeeId,null);
  assert.equal(s.shifts[0].hourLimitOverride,false);
  assert.equal(reconcileRequestAssignments(s),0);
});

test('rebuilding the full draft releases quota for another shift and respects saved priority changes',()=>{
  const s=state([shift('b','2026-10-11','16:00','00:00'),shift('a','2026-10-11','08:00','16:00')],[request('a-junior','a','junior'),request('b-junior','b','junior')]);
  assert.equal(reconcileRequestAssignments(s),1);
  assert.deepEqual(s.shifts.map(x=>[x.id,x.employeeId]),[['b',null],['a','junior']]);
  s.requests.push(request('a-senior','a','senior'));
  assert.equal(reconcileRequestAssignments(s),2);
  assert.deepEqual(s.shifts.map(x=>[x.id,x.employeeId]),[['b','junior'],['a','senior']]);
  s.employees[0].priority=2;s.employees[1].priority=1;
  assert.equal(reconcileRequestAssignments(s),2);
  assert.deepEqual(s.shifts.map(x=>[x.id,x.employeeId]),[['b',null],['a','junior']]);
  s.settings={dailyMaxHours:16,weeklyMaxHours:40};
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[0].employeeId,'junior');
  s.settings.dailyMaxHours=8;
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[0].employeeId,null);
});

test('manual, imported, legacy priority, published, and explicitly locked shifts remain immutable',()=>{
  const fixed=[
    {...shift('manual','2026-10-11','08:00','16:00','junior'),source:'manual',note:'Keep',hourLimitOverride:true},
    {...shift('imported','2026-10-12','08:00','16:00','junior'),source:'imported'},
    {...shift('legacy','2026-10-13','08:00','16:00','junior'),source:'priority'},
    {...shift('locked-open','2026-10-14','08:00','16:00'),source:'manual',requestAssignmentLocked:true},
    {...shift('locked-live','2026-10-15','08:00','16:00','junior'),source:'request-priority',requestAssignmentLocked:true},
    {...shift('published-live','2026-10-18','08:00','16:00','junior'),source:'request-priority'},
    shift('published-open','2026-10-19','08:00','16:00'),
  ];
  const open=shift('open','2026-10-16','08:00','16:00');
  const s=state([...fixed,open],[...fixed,open].map(x=>request(x.id,x.id,'senior')));
  s.weeks['2026-10-18']='published';
  const before=structuredClone(fixed);
  assert.equal(reconcileRequestAssignments(s),1);
  assert.deepEqual(s.shifts.slice(0,-1),before);
  assert.equal(open.employeeId,'senior');
});

test('live assignment skips inactive and overlapping requesters without deleting their requests',()=>{
  const s=state([shift('night','2026-10-11','22:00','06:00','senior'),shift('open','2026-10-12','05:00','08:00')],[request('senior','open','senior'),request('junior','open','junior'),request('inactive','open','inactive'),request('missing','open','missing')]);
  s.employees.push({id:'inactive',priority:0,active:false});
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[1].employeeId,'junior');
  assert.equal(s.requests.length,4);
  s.employees[1].active=false;
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[1].employeeId,null);
  assert.equal(s.requests.length,4);
});

test('live assignments respect daily limits and never reuse an automatic hour override',()=>{
  const s=state([shift('fixed','2026-10-11','08:00','16:00','senior'),{...shift('open','2026-10-11','16:00','18:00','senior'),source:'request-priority',hourLimitOverride:true}],[request('senior','open','senior'),request('junior','open','junior')]);
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[1].employeeId,'junior');
  assert.equal(s.shifts[1].hourLimitOverride,false);
  s.settings={dailyMaxHours:1,weeklyMaxHours:40};
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts[1].employeeId,null);
  assert.equal(s.shifts[0].employeeId,'senior');
});

test('live assignments accumulate to exactly 40 weekly hours before using the next eligible requester',()=>{
  const fixed=Array.from({length:4},(_,i)=>shift(`fixed-${i}`,`2026-10-${11+i}`,'08:00','16:00','senior'));
  const s=state([...fixed,shift('last-eight','2026-10-15','08:00','16:00'),shift('extra','2026-10-16','08:00','08:01')],[request('eight','last-eight','senior'),request('senior','extra','senior'),request('junior','extra','junior')]);
  assert.equal(reconcileRequestAssignments(s),2);
  assert.equal(s.shifts[4].employeeId,'senior');
  assert.equal(s.shifts[5].employeeId,'junior');
  assert.equal(weeklyWorkHours(dailyWorkHours(s.shifts,'senior'),'2026-10-11'),40);
});

test('live reconciliation checks overnight hours across the Sunday boundary against fixed published work',()=>{
  const fixed=Array.from({length:5},(_,i)=>shift(`published-${i}`,`2026-10-${19+i}`,'08:00','16:00','senior'));
  const s=state([...fixed,shift('saturday-night','2026-10-17','22:00','06:00')],[request('senior','saturday-night','senior'),request('junior','saturday-night','junior')]);
  s.weeks['2026-10-18']='published';
  assert.equal(reconcileRequestAssignments(s),1);
  assert.equal(s.shifts.at(-1).employeeId,'junior');
  assert.equal(weeklyWorkHours(dailyWorkHours(s.shifts,'senior'),'2026-10-18'),40);
});

test('live shift traversal uses date, start, and id deterministically without reordering stored shifts',()=>{
  const s=state([shift('b','2026-10-11','08:00','16:00'),shift('a','2026-10-11','08:00','16:00')],[request('b','b','senior'),request('a','a','senior')]);
  assert.equal(reconcileRequestAssignments(s),1);
  assert.deepEqual(s.shifts.map(x=>[x.id,x.employeeId]),[['b',null],['a','senior']]);
  assert.equal(reconcileRequestAssignments(s),0);
  const shuffled=state([...s.shifts].reverse().map(x=>({...x,employeeId:null,source:'test'})),[...s.requests].reverse());
  assert.equal(reconcileRequestAssignments(shuffled),1);
  assert.equal(shuffled.shifts.find(x=>x.id==='a').employeeId,'senior');
});
