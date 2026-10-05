'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Users, Settings, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Plus, Sparkles, Check, ExternalLink, RefreshCw, MoreHorizontal, LockKeyhole } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import ShiftBoard from './shift-board';
import WorkHourSettingsPanel from './work-hour-settings';
import EmployeeAccessLink from './employee-access-link';
import { assignmentHourIssues, workHourSettings, weekHourIssues, hourIssueText, overlaps, planWeekCopy, type WorkHourSettings, INITIAL_WEEK, SOURCE_URL, addDays, weekOf, type Employee, type Shift, type ShiftRequest } from '@/lib/schedule';

type Data = {role:'setup'|'guest'|'admin'|'employee';version:number;userName:string;employeeId?:string;employees:(Employee & {connected?:boolean})[];shifts:Shift[];requests:ShiftRequest[];weeks:Record<string,string>;priorityConfirmed:boolean;notes:string[];settings:WorkHourSettings};
type Modal = {kind:'assignment'|'employee'|'shift'|'editShift'|'week';shift?:Shift;employee?:Employee;date?:string};
type ShiftFilter = 'all'|'assigned'|'requested';
const fmt=(date:string,opts:Intl.DateTimeFormatOptions={month:'short',day:'numeric'})=>new Intl.DateTimeFormat('en-US',{...opts,timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
const weekRange=(start:string)=>{const end=addDays(start,6);return start.slice(0,4)===end.slice(0,4)?`${fmt(start)} – ${fmt(end)}, ${start.slice(0,4)}`:`${fmt(start,{month:'short',day:'numeric',year:'numeric'})} – ${fmt(end,{month:'short',day:'numeric',year:'numeric'})}`;};
const orderedIds=(employees:Employee[])=>employees.filter(employee=>employee.active).sort((a,b)=>a.priority-b.priority||a.name.localeCompare(b.name)).map(employee=>employee.id);
function Pick({value,onChange,options,label}:{value:string;onChange:(value:string)=>void;options:{value:string;label:string}[];label:string}){
 return <Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="picker"><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(option=><SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>;
}
function Blank({title,children}:{title:string;children:React.ReactNode}){
 return <Empty><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{children}</EmptyDescription></EmptyHeader></Empty>;
}
function compareRequests(a:ShiftRequest,b:ShiftRequest,employees:Employee[]){
 const rank=(id:string)=>{const priority=employees.find(employee=>employee.id===id)?.priority;return priority&&priority>0?priority:Number.MAX_SAFE_INTEGER;};
 return rank(a.employeeId)-rank(b.employeeId)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
}
function RequestQueue({requests,employees,shift,published,priorityReady,admin,busy,currentEmployeeId,onWithdraw}:{requests:ShiftRequest[];employees:Employee[];shift:Shift;published:boolean;priorityReady:boolean;admin:boolean;busy:boolean;currentEmployeeId?:string;onWithdraw:(request:ShiftRequest)=>void}){
 if(!requests.length)return <p className="helper">No requests yet.</p>;
 return <div className="request-queue detail-request-queue" data-testid="request-queue">
  <p className="request-queue-title">{priorityReady?'Requests, in priority order':'Requests · priority not set'}</p>
  <ol aria-label={`Request queue for ${shift.label} on ${shift.date}`}>
   {[...requests].sort((a,b)=>compareRequests(a,b,employees)).map(request=>{
    const employee=employees.find(employee=>employee.id===request.employeeId),selected=shift.employeeId===request.employeeId,own=request.employeeId===currentEmployeeId;
    return <li key={request.id} data-employee-id={request.employeeId} className={selected?'request-queue-selected':''}>
     <span className="request-rank" aria-label={priorityReady&&employee?.priority?`Priority ${employee.priority}`:'Priority not set'}>{priorityReady&&employee?.priority?`#${employee.priority}`:'—'}</span>
     <span className="request-person">{employee?.name??'Employee'}{own&&<small> (you)</small>}</span>
     {selected&&<span className="request-selection"><Check size={12}/>{!published&&shift.source==='request-priority'?'Draft assignment':published?'Assigned':'Admin assigned'}</span>}
     {(admin||own)&&request.note&&<p className="request-private-note">{request.note}</p>}
     {!published&&(admin||own)&&<button className="text-button request-cancel" disabled={busy} aria-label={`Cancel ${employee?.name??'employee'} request`} onClick={()=>onWithdraw(request)}>Cancel request</button>}
    </li>;
   })}
  </ol>
 </div>;
}

export default function Scheduler(){
 const [data,setData]=useState<Data|null>(null);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [week,setWeek]=useState(INITIAL_WEEK),[tab,setTabState]=useState('schedule'),[filter,setFilter]=useState<ShiftFilter>('all');
 const [modal,setModal]=useState<Modal|null>(null);
 const [confirm,setConfirm]=useState<{title:string;description:string;action:Record<string,unknown>}|null>(null);
 const [priority,setPriority]=useState<string[]>([]),[priorityDirty,setPriorityDirty]=useState(false);
 const [employeeId,setEmployeeId]=useState('none'),[requestEmployeeId,setRequestEmployeeId]=useState('none'),[moveId,setMoveId]=useState('none');
 const [allowOverlap,setAllowOverlap]=useState(false),[overrideHourLimits,setOverrideHourLimits]=useState(false),[overridePublishHours,setOverridePublishHours]=useState(false);
 const [note,setNote]=useState(''),[advanced,setAdvanced]=useState(false);
 const [copySource,setCopySource]=useState('standard'),[copyAssignments,setCopyAssignments]=useState(false);
 const [copyAllowOverlap,setCopyAllowOverlap]=useState(false),[copyOverrideHours,setCopyOverrideHours]=useState(false);
 const [settingsSnapshot,setSettingsSnapshot]=useState<WorkHourSettings|null>(null);
 const latest=useRef(data);latest.current=data;
 const priorityUnsaved=useRef(false);priorityUnsaved.current=priorityDirty;
 const editing=useRef(false);editing.current=!!modal||!!confirm||priorityDirty||busy||tab==='settings';
 const reading=useRef(false),mutating=useRef(false),refreshEpoch=useRef(0);

 useEffect(()=>{setOverrideHourLimits(false);},[employeeId,moveId,modal?.shift?.id]);
 useEffect(()=>{setOverridePublishHours(false);},[confirm]);
 useEffect(()=>{setCopyAllowOverlap(false);setCopyOverrideHours(false);},[copySource,copyAssignments,modal?.kind==='week'?modal.date:undefined,data?.version]);
 const setTab=(next:string)=>{if(next!==tab){setSettingsSnapshot(next==='settings'?workHourSettings(latest.current??{}):null);setTabState(next);}};
 const refresh=useCallback(async()=>{
  if(reading.current||mutating.current||editing.current)return;
  reading.current=true;const epoch=++refreshEpoch.current;
  try{
   const response=await fetch('/api/workspace',{cache:'no-store'});
   const updated=await response.json() as Data & {error?:string};
   if(epoch!==refreshEpoch.current||mutating.current||editing.current)return;
   if(!response.ok)throw new Error(updated.error??'Could not load the schedule.');
   setError('');
   if(latest.current?.version===updated.version&&latest.current?.role===updated.role&&latest.current?.employeeId===updated.employeeId&&latest.current?.userName===updated.userName)return;
   latest.current=updated;setData(updated);
   if(updated.employees){setPriority(orderedIds(updated.employees));setPriorityDirty(false);}
  }catch(cause){if(epoch===refreshEpoch.current&&!editing.current)setError((cause as Error).message);}finally{reading.current=false;}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{
  const check=()=>{if(document.visibilityState==='visible')void refresh();};
  const timer=window.setInterval(check,15000);
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
  return()=>{window.clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
 },[refresh]);
 useEffect(()=>{if(!modal&&!confirm&&!priorityDirty&&!busy&&tab!=='settings')void refresh();},[modal,confirm,priorityDirty,busy,tab,refresh]);
 const act=useCallback(async(payload:Record<string,unknown>,quick=false)=>{
  if(mutating.current)return null;
  const actor=latest.current;
  const originalRequest=payload.action==='withdraw'?actor?.requests.find(request=>request.id===payload.requestId):undefined;
  const shiftId=payload.action==='request'?payload.shiftId:originalRequest?.shiftId;
  const quickEligible=quick&&actor?.role==='employee'&&!!actor.employeeId&&(
   payload.action==='request'&&payload.note===''||payload.action==='withdraw'&&originalRequest?.employeeId===actor.employeeId
  );
  mutating.current=true;refreshEpoch.current++;setBusy(true);
  const send=async(version:number|undefined)=>{
   const response=await fetch('/api/workspace',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,version})});
   return {ok:response.ok,status:response.status,data:await response.json() as Data & {error?:string;message:string}};
  };
  const stale=(result:{status:number;data:{error?:string}})=>result.status===409&&/schedule changed|someone updated/i.test(result.data.error??'');
  try{
   let result=await send(actor?.version);
   if(!result.ok&&stale(result)){
    const current=await fetch('/api/workspace',{cache:'no-store'});
    if(current.ok){
     const saved=await current.json() as Data;latest.current=saved;setData(saved);
     setModal(open=>open?.shift?{...open,shift:saved.shifts?.find(shift=>shift.id===open.shift!.id)??open.shift}:open);
     if(saved.employees){const ids=orderedIds(saved.employees);setPriority(previous=>priorityUnsaved.current?[...previous.filter(id=>ids.includes(id)),...ids.filter(id=>!previous.includes(id))]:ids);}
     const shift=saved.shifts?.find(shift=>shift.id===shiftId);
     // Only the direct employee buttons may retry. Never replay a note or admin
     // edit, act as a different signed-in employee, or alter a published week.
     if(quickEligible&&saved.role==='employee'&&saved.employeeId===actor?.employeeId&&shift&&saved.weeks[weekOf(shift.date)]!=='published'){
      const alreadyDone=payload.action==='request'
       ?saved.requests.some(request=>request.shiftId===shiftId&&request.employeeId===saved.employeeId)
       :!saved.requests.some(request=>request.id===payload.requestId);
      if(alreadyDone)result={ok:true,status:200,data:{...saved,message:payload.action==='request'?'Shift requested.':'Request canceled.'}};
      else result=await send(saved.version);
     }
    }
   }
   if(!result.ok)throw new Error(stale(result)?'The schedule changed. Review and try again.':result.data.error??'Could not save this change.');
   const updated=result.data;
   latest.current=updated;setData(updated);setError('');
   const message=payload.action==='request'?'Shift requested.':payload.action==='withdraw'?'Request canceled.':payload.action==='priority'?'Order saved.':updated.message;
   toast.success(message,{duration:2200});
   setModal(open=>open?.shift?{...open,shift:updated.shifts?.find(shift=>shift.id===open.shift!.id)??open.shift}:open);
   if(updated.employees){setPriority(orderedIds(updated.employees));setPriorityDirty(false);}
   return updated;
  }catch(cause){toast.error((cause as Error).message);return null;}finally{mutating.current=false;setBusy(false);}
 },[]);
 const openShift=useCallback((shift:Shift,selectedEmployeeId?:string|null,showAdvanced=false)=>{
  const current=latest.current;
  setEmployeeId(selectedEmployeeId===undefined?shift.employeeId??'none':selectedEmployeeId??'none');
  setRequestEmployeeId(shift.employeeId??'none');setMoveId('none');setAllowOverlap(false);setOverrideHourLimits(false);setAdvanced(showAdvanced);
  const noteOwner=current?.role==='admin'?shift.employeeId:current?.employeeId;
  setNote(current?.requests.find(request=>request.shiftId===shift.id&&request.employeeId===noteOwner)?.note??'');
  setModal({kind:'assignment',shift});
 },[]);
 useEffect(()=>{
  const context=(document as any).modelContext;if(!context?.registerTool)return;
  const lifecycle=new AbortController();
  const register=(tool:any)=>{try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_shift_schedule',title:'Read shift schedule',description:'Read the visible schedule and permitted requests. No changes.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({role:latest.current?.role,shifts:latest.current?.shifts,requests:latest.current?.requests})});
  register({name:'start_shift_edit',title:'Open shift details',description:'Open a shift for review or editing. Does not save changes.',inputSchema:{type:'object',properties:{shiftId:{type:'string'}},required:['shiftId'],additionalProperties:false},annotations:{readOnlyHint:false},execute:(input:unknown)=>{const shift=latest.current?.shifts?.find(shift=>shift.id===(input as {shiftId?:string})?.shiftId);if(!shift)throw new Error('Shift not found.');openShift(shift);return {openedShiftId:shift.id};}});
  return()=>lifecycle.abort();
 },[openShift]);

 const admin=data?.role==='admin',employees=data?.employees??[];
 const shifts=(data?.shifts??[]).filter(shift=>weekOf(shift.date)===week);
 const requests=(data?.requests??[]).filter(request=>shifts.some(shift=>shift.id===request.shiftId));
 const ownRequests=requests.filter(request=>request.employeeId===data?.employeeId);
 const published=data?.weeks?.[week]==='published';
 const activeEmployees=employees.filter(employee=>employee.active);
 const priorityReady=!!data?.priorityConfirmed&&activeEmployees.length>0&&activeEmployees.every(employee=>Number.isSafeInteger(employee.priority)&&employee.priority>0)&&new Set(activeEmployees.map(employee=>employee.priority)).size===activeEmployees.length;
 const hourSettings=workHourSettings(data??{}),weekIssues=admin&&data?weekHourIssues(data,week):[];
 const assignmentIssues=admin&&data&&modal?.shift&&employeeId!=='none'?assignmentHourIssues(data,modal.shift,employeeId):[];
 const assignmentOverlap=!!(admin&&data&&modal?.shift&&employeeId!=='none'&&data.shifts.some(shift=>shift.id!==modal.shift!.id&&shift.employeeId===employeeId&&overlaps(shift,modal.shift!)));
 const moveTarget=data?.shifts?.find(shift=>shift.id===moveId);
 const moveIssues=admin&&data&&modal?.shift?.employeeId&&moveTarget?assignmentHourIssues(data,moveTarget,modal.shift.employeeId,modal.shift.id):[];
 const copyTarget=modal?.kind==='week'?modal.date??week:week;
 const earlierWeeks=Array.from(new Set((data?.shifts??[]).map(shift=>weekOf(shift.date)))).filter(savedWeek=>savedWeek<copyTarget).sort().reverse();
 const copyTargetHasShifts=(data?.shifts??[]).some(shift=>weekOf(shift.date)===copyTarget);
 let copyPreview:ReturnType<typeof planWeekCopy>|null=null,copyPreviewError='';
 if(admin&&data&&modal?.kind==='week'&&copySource!=='standard'){
  try{copyPreview=planWeekCopy(data,copyTarget,copySource,copyAssignments);}catch(cause){copyPreviewError=(cause as Error).message;}
 }
 const copyNeedsOverlap=copyAssignments&&!!copyPreview?.overlapEmployeeIds.length;
 const copyNeedsHours=copyAssignments&&!!copyPreview?.hourIssues.length;
 useEffect(()=>{if(assignmentIssues.length||assignmentOverlap||moveIssues.length)setAdvanced(true);},[assignmentIssues.length,assignmentOverlap,moveIssues.length]);
 const name=(id:string|null|undefined)=>employees.find(employee=>employee.id===id)?.name??'Open shift';
 const doAndClose=async(payload:Record<string,unknown>)=>{const saved=await act(payload);if(saved)setModal(null);return saved;};
 const savePriority=async(ids:string[])=>{setPriority(ids);setPriorityDirty(true);priorityUnsaved.current=true;await act({action:'priority',ids});};
 const reorder=async(index:number,direction:number)=>{const next=[...priority];[next[index],next[index+direction]]=[next[index+direction],next[index]];await savePriority(next);};
 const requestShift=(shift:Shift)=>{
  const existing=latest.current?.requests.find(request=>request.shiftId===shift.id&&request.employeeId===latest.current?.employeeId);
  if(!existing)void act({action:'request',shiftId:shift.id,note:''},true);
 };
 const assignShift=(shift:Shift,id:string|null)=>{
  const current=latest.current;if(!current)return;
  if(id&&(assignmentHourIssues(current,shift,id).length>0||current.shifts.some(other=>other.id!==shift.id&&other.employeeId===id&&overlaps(other,shift)))){openShift(shift,id,true);return;}
  void act({action:'assign',shiftId:shift.id,employeeId:id});
 };
 const publishWeek=()=>{
  if(!published&&weekIssues.length){setConfirm({title:'Publish with extra hours?',description:'Review these limits and approve an exception to publish.',action:{action:'publish',week,published:true}});return;}
  void act({action:'publish',week,published:!published});
 };
 const openCreateWeek=()=>{
  if(!admin||shifts.length)return;
  const available=Array.from(new Set((latest.current?.shifts??[]).map(shift=>weekOf(shift.date)))).filter(savedWeek=>savedWeek<week).sort().reverse();
  const previous=addDays(week,-7);
  setCopySource(available.includes(previous)?previous:available[0]??'standard');
  setCopyAssignments(false);setCopyAllowOverlap(false);setCopyOverrideHours(false);
  setModal({kind:'week',date:week});
 };
 const header=<header className="topbar simple-topbar"><a href="/" className="brand"><span className="brand-icon"><CalendarDays size={21}/></span>shiftboard<span className="brand-dot">.</span></a><div className="account"><span className="signed-in-name">{data?.userName??''}</span>{admin&&<span className="admin-badge">Admin</span>}<form action="/signout" method="post"><button type="submit" className="text-button">Sign out</button></form></div></header>;
 if(!data)return <>{header}<main className="loading">{error?<Blank title="Schedule unavailable"><span>{error}</span><button className="btn primary" onClick={refresh}>Try again</button></Blank>:<><Skeleton className="h-10 w-64"/><Skeleton className="h-96 w-full mt-8"/></>}</main></>;
 if(data.role==='setup'||data.role==='guest')return <>{header}<main className="onboarding simple-onboarding"><h1>{data.role==='setup'?'Set up your schedule':'Employee sign-in'}</h1><p>{data.role==='setup'?'Import your team and shifts to get started.':'Use the phone number registered by your admin.'}</p>{data.role==='setup'?<button className="btn primary big" disabled={busy} onClick={()=>act({action:'setup'})}>Set up workspace</button>:<a className="btn primary big" href="/login?mode=employee">Sign in with phone</a>}<form action="/signout" method="post"><button type="submit" className="text-button signout">Switch account</button></form></main><Toaster richColors/></>;

 const schedule=<>
  <div className="simple-page-heading"><h1>Schedule</h1><div className="inline-actions">
   {admin&&<button className="btn primary" disabled={busy||!shifts.length} onClick={publishWeek}>{published?'Reopen':'Publish'}</button>}
   <DropdownMenu><DropdownMenuTrigger asChild><button className="btn outline icon-button" aria-label="More actions"><MoreHorizontal size={19}/></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="schedule-menu">
    {admin&&<><DropdownMenuItem onSelect={()=>setModal({kind:'shift',date:week})}><Plus/> Add shift</DropdownMenuItem><DropdownMenuItem disabled={busy||!shifts.length||!priorityReady||published} onSelect={()=>setConfirm({title:'Auto-assign open shifts?',description:'Includes shifts you held open. Existing manual and imported assignments stay in place. Work-hour limits still apply.',action:{action:'auto',week}})}><Sparkles/> Auto-assign</DropdownMenuItem><DropdownMenuSeparator/></>}
    <DropdownMenuItem disabled={busy||priorityDirty} onSelect={()=>void refresh()}><RefreshCw/> Refresh</DropdownMenuItem><DropdownMenuItem onSelect={()=>setWeek(INITIAL_WEEK)}>Go to imported week</DropdownMenuItem>
   </DropdownMenuContent></DropdownMenu>
  </div></div>
  <div className="simple-schedule-toolbar"><div className="simple-week-picker"><button className="btn outline icon-button" aria-label="Previous week" onClick={()=>setWeek(addDays(week,-7))}><ChevronLeft size={19}/></button><h2>{fmt(week)} – {fmt(addDays(week,6))}<span>, {week.slice(0,4)}</span></h2><button className="btn outline icon-button" aria-label="Next week" onClick={()=>setWeek(addDays(week,7))}><ChevronRight size={19}/></button><span className={'status '+(published?'published':'')}>{published?'Published':'Draft'}</span></div>
   {!admin&&<div className="shift-filters" role="group" aria-label="Show shifts"><button aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All shifts</button><button aria-pressed={filter==='assigned'} onClick={()=>setFilter('assigned')}>My shifts</button><button aria-pressed={filter==='requested'} onClick={()=>setFilter('requested')}>My requests <span data-testid="request-count">{ownRequests.length}</span></button></div>}
  </div>
  {!published&&!priorityReady&&<p className="schedule-hint">Waiting for admin to set priority.{admin&&<> <button className="text-button" onClick={()=>setTab('team')}>Set order</button></>}</p>}
  {!published&&priorityReady&&!admin&&<p className="schedule-hint">Assignments may change until published.</p>}
  {admin&&weekIssues.length>0&&<p className="schedule-hint"><button className="text-button hours-over" onClick={()=>setTab('settings')}>{new Set(weekIssues.map(issue=>issue.employeeId)).size} employee(s) over hour limits</button></p>}
  {shifts.length?<ShiftBoard shifts={shifts} employees={employees} requests={requests} week={week} admin={admin} employeeId={data.employeeId} published={published} priorityReady={priorityReady} busy={busy} filter={admin?'all':filter} onRequest={requestShift} onWithdraw={request=>void act({action:'withdraw',requestId:request.id},true)} onOpen={openShift} onAssign={assignShift} onAdd={admin?date=>setModal({kind:'shift',date}):undefined}/>:<section className="content-card"><Blank title="No shifts this week">{admin?<button className="btn primary" disabled={busy} onClick={openCreateWeek}>Create this week</button>:<p>Your admin hasn’t added this week yet.</p>}</Blank></section>}
 </>;
 const team=<>
  <div className="simple-page-heading"><div><h1>Team</h1><p>Higher rows get first choice. Changes save automatically.</p></div><div className="team-actions"><EmployeeAccessLink compact/><button className="btn primary" disabled={busy} onClick={()=>setModal({kind:'employee'})}><Plus size={16}/> Add employee</button><DropdownMenu><DropdownMenuTrigger asChild><button className="btn outline icon-button" aria-label="More team actions"><MoreHorizontal size={19}/></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={busy||activeEmployees.some(employee=>!employee.hireDate)} onSelect={()=>void savePriority([...activeEmployees].sort((a,b)=>a.hireDate.localeCompare(b.hireDate)||a.name.localeCompare(b.name)).map(employee=>employee.id))}>Order by hire date</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
  {!priorityReady&&!priorityDirty&&<div className="priority-setup"><p>Use this order to start automatic assignments.</p><button className="btn outline" disabled={busy||!priority.length} onClick={()=>void savePriority(priority)}>Use this order</button></div>}
  {priorityDirty&&!busy&&<div className="error-banner" role="alert">This order hasn’t saved. <button className="text-button" onClick={()=>void savePriority(priority)}>Retry</button></div>}
  <section className="content-card simple-team-table"><Table><TableHeader><TableRow><TableHead>Priority</TableHead><TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{priority.map((id,index)=>{const employee=employees.find(employee=>employee.id===id);if(!employee)return null;return <TableRow key={id} data-employee-id={id}><TableCell><div className="rank-control"><span>{index+1}</span><button aria-label={`Move ${employee.name} up`} disabled={busy||index===0} onClick={()=>void reorder(index,-1)}><ArrowUp size={16}/></button><button aria-label={`Move ${employee.name} down`} disabled={busy||index===priority.length-1} onClick={()=>void reorder(index,1)}><ArrowDown size={16}/></button></div></TableCell><TableCell><strong>{employee.name}</strong></TableCell><TableCell>{employee.phone||<span className="muted">Not set</span>}</TableCell><TableCell><button className="text-button" disabled={busy} aria-label={`Edit ${employee.name}`} onClick={()=>setModal({kind:'employee',employee})}>Edit</button></TableCell></TableRow>;})}</TableBody></Table></section>
  <details className="imported-notes"><summary>Imported notes</summary><ul className="source-notes">{data.notes.map((note,index)=><li key={index}>{note}</li>)}</ul><a className="text-button" href={SOURCE_URL} target="_blank" rel="noreferrer">Open spreadsheet <ExternalLink size={14}/></a></details>
 </>;

 return <>{header}<main className="app-shell simple-shell">
  {error&&<div role="alert" className="error-banner">{error} <button className="text-button" onClick={refresh}>Try again</button></div>}
  {admin?<Tabs value={tab} onValueChange={setTab}><TabsList variant="line" className="main-tabs simple-main-tabs"><TabsTrigger value="schedule"><CalendarDays/> Schedule</TabsTrigger><TabsTrigger value="team"><Users/> Team</TabsTrigger><TabsTrigger value="settings"><Settings/> Settings</TabsTrigger></TabsList><TabsContent value="schedule">{schedule}</TabsContent><TabsContent value="team">{team}</TabsContent><TabsContent value="settings"><div className="simple-page-heading"><h1>Settings</h1></div>{settingsSnapshot&&(settingsSnapshot.dailyMaxHours!==hourSettings.dailyMaxHours||settingsSnapshot.weeklyMaxHours!==hourSettings.weeklyMaxHours)&&<div className="hours-warning" role="status">Saved limits changed to {hourSettings.dailyMaxHours} hours/day and {hourSettings.weeklyMaxHours} hours/week. Your inputs are preserved.</div>}<WorkHourSettingsPanel settings={settingsSnapshot??hourSettings} employees={employees} shifts={data.shifts} week={week} busy={busy} onSave={async settings=>{const saved=await act({action:'settings',...settings});if(saved)setSettingsSnapshot(workHourSettings(saved));return saved;}}/></TabsContent></Tabs>:schedule}
 </main>
 <Dialog open={!!modal} onOpenChange={open=>{if(!open)setModal(null);}}><DialogContent className="app-dialog simple-dialog"><DialogHeader><DialogTitle>{modal?.kind==='week'?'Create week':modal?.kind==='assignment'?`${modal.shift?.label} · ${fmt(modal.shift!.date)}`:modal?.kind==='employee'?(modal.employee?'Edit employee':'Add employee'):modal?.kind==='editShift'?'Edit shift':'Add shift'}</DialogTitle><DialogDescription>{modal?.kind==='week'?weekRange(copyTarget):modal?.kind==='assignment'?`${modal.shift?.start}–${modal.shift?.end}${modal.shift&&modal.shift.end<=modal.shift.start?' · ends next day':''}`:modal?.kind==='employee'?'Name and phone sign-in.':'Choose the date and hours.'}</DialogDescription></DialogHeader>
  {modal?.kind==='week'&&<form className="form-stack week-copy-form" onSubmit={event=>{
   event.preventDefault();
   if(busy||copyTargetHasShifts||copyPreviewError||(copySource!=='standard'&&!copyPreview)||(copyNeedsOverlap&&!copyAllowOverlap)||(copyNeedsHours&&!copyOverrideHours))return;
   void doAndClose({action:'week',week:copyTarget,...(copySource!=='standard'?{sourceWeek:copySource,copyAssignments,...(copyAssignments?{allowOverlap:copyNeedsOverlap&&copyAllowOverlap,overrideHourLimits:copyNeedsHours&&copyOverrideHours}:{})}:{})});
  }}>
   <label>Copy from<Pick label="Copy from" value={copySource} onChange={source=>{setCopySource(source);if(source==='standard')setCopyAssignments(false);}} options={[...earlierWeeks.map(source=>({value:source,label:`${weekRange(source)}${source===addDays(copyTarget,-7)?' (previous week)':''}`})),{value:'standard',label:'Standard shifts'}]}/></label>
   {copySource!=='standard'&&<label className="checkbox-label"><Checkbox checked={copyAssignments} onCheckedChange={value=>setCopyAssignments(value===true)}/> Include assigned employees</label>}
   {!copyPreviewError&&<div className="week-copy-preview" data-testid="week-copy-preview"><strong>{copySource==='standard'?'35 standard shifts':`${copyPreview?.shifts.length??0} shifts`}</strong><span>{copySource!=='standard'&&copyAssignments?`${copyPreview?.shifts.filter(shift=>shift.employeeId).length??0} assigned`:'No assignments'}</span></div>}
   <p className="helper">New draft. Requests start fresh.</p>
   {!!copyPreview?.unassignedCount&&<p className="helper">{copyPreview.unassignedCount} assignment{copyPreview.unassignedCount===1?'':'s'} will be left open because the employee is inactive or no longer on the team.</p>}
   {copyNeedsOverlap&&<div className="hours-warning week-copy-warning"><p>Overlapping shifts for {copyPreview!.overlapEmployeeIds.map(name).join(', ')}.</p><label className="checkbox-label"><Checkbox checked={copyAllowOverlap} onCheckedChange={value=>setCopyAllowOverlap(value===true)}/> Allow overlapping duties in this week</label></div>}
   {copyNeedsHours&&<div className="hours-warning week-copy-warning"><strong>Work-hour limits exceeded</strong><ul className="week-copy-issues">{copyPreview!.hourIssues.map(issue=><li key={issue.employeeId+issue.kind+issue.period}>{name(issue.employeeId)}: {hourIssueText(issue)}</li>)}</ul><label className="checkbox-label"><Checkbox checked={copyOverrideHours} onCheckedChange={value=>setCopyOverrideHours(value===true)}/> Admin override: allow copied assignments to exceed work-hour limits</label></div>}
   {copyPreviewError&&<p className="week-copy-error" role="alert">{copyPreviewError}</p>}
   {copyTargetHasShifts&&<p className="week-copy-error" role="alert">This week already has shifts. Close this dialog to view them.</p>}
   <button className="btn primary" type="submit" disabled={busy||copyTargetHasShifts||!!copyPreviewError||(copySource!=='standard'&&!copyPreview)||(copyNeedsOverlap&&!copyAllowOverlap)||(copyNeedsHours&&!copyOverrideHours)}>{busy?'Creating…':'Create week'}</button>
  </form>}
  {modal?.kind==='employee'&&<form className="form-stack" onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget);void doAndClose({action:'employee',id:modal.employee?.id,name:fields.get('name'),hireDate:fields.get('hireDate'),phone:fields.get('phone')});}}><label>Name<input required name="name" maxLength={80} defaultValue={modal.employee?.name}/></label><label>Phone<input type="tel" name="phone" autoComplete="tel" maxLength={50} defaultValue={modal.employee?.phone} placeholder="(604) 555-0123"/></label><p className="helper">Use 10 digits for US/Canada or +country code. Leave blank to disable sign-in.</p><details className="advanced-options"><summary>More details</summary><label>Hire date<input type="date" name="hireDate" defaultValue={modal.employee?.hireDate}/></label></details><button className="btn primary" disabled={busy}>Save employee</button></form>}
  {(modal?.kind==='shift'||modal?.kind==='editShift')&&<form className="form-stack" onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget);void doAndClose({action:'shift',id:modal.shift?.id,label:fields.get('label'),date:fields.get('date'),start:fields.get('start'),end:fields.get('end')});}}><label>Shift name<input name="label" required defaultValue={modal.shift?.label??'Morning'}/></label><label>Date<input type="date" name="date" required defaultValue={modal.shift?.date??modal.date??week}/></label><div className="form-row"><label>Start<input type="time" name="start" required defaultValue={modal.shift?.start??'07:30'}/></label><label>End<input type="time" name="end" required defaultValue={modal.shift?.end??'13:00'}/></label></div><p className="helper">An earlier end time means the next day.</p><button className="btn primary" disabled={busy}>Save shift</button></form>}
  {modal?.kind==='assignment'&&<div className="form-stack">
   <RequestQueue requests={requests.filter(request=>request.shiftId===modal.shift!.id)} employees={employees} shift={modal.shift!} published={published} priorityReady={priorityReady} admin={admin} busy={busy} currentEmployeeId={data.employeeId} onWithdraw={request=>void act({action:'withdraw',requestId:request.id})}/>
   {admin?<>
    <label>Assigned employee<Pick label="Assign employee" value={employeeId} onChange={setEmployeeId} options={[{value:'none',label:'Open / unassigned'},...activeEmployees.map(employee=>({value:employee.id,label:employee.name}))]}/></label>
    <details className="advanced-options" open={advanced} onToggle={event=>setAdvanced(event.currentTarget.open)}><summary>Advanced options</summary><div className="form-stack">
     {assignmentOverlap&&<p className="hours-warning">This employee has an overlapping shift.</p>}
     <label className="checkbox-label"><Checkbox checked={allowOverlap} onCheckedChange={value=>setAllowOverlap(value===true)}/> Allow overlapping duties for this assignment</label>
     {assignmentIssues.length>0&&<div className="hours-warning"><strong>Work-hour limits exceeded</strong><ul>{assignmentIssues.map(issue=><li key={issue.kind+issue.period}>{hourIssueText(issue)}</li>)}</ul></div>}
     <label className="checkbox-label"><Checkbox checked={overrideHourLimits} onCheckedChange={value=>setOverrideHourLimits(value===true)}/> Admin override: allow this change to exceed work-hour limits</label>
     {!modal.shift!.employeeId&&modal.shift!.requestAssignmentLocked&&<p className="helper">Held open. Auto-assign includes this shift again.</p>}
     {modal.shift!.employeeId&&<><label>Move assignment<Pick label="Move to open shift" value={moveId} onChange={setMoveId} options={[{value:'none',label:'Choose an open shift'},...shifts.filter(shift=>!shift.employeeId&&shift.id!==modal.shift!.id).map(shift=>({value:shift.id,label:`${fmt(shift.date)} · ${shift.label} (${shift.start})`}))]}/></label>{moveIssues.length>0&&<div className="hours-warning"><ul>{moveIssues.map(issue=><li key={issue.kind+issue.period}>{hourIssueText(issue)}</li>)}</ul></div>}<button className="btn outline" disabled={busy||moveId==='none'} onClick={()=>doAndClose({action:'move',fromId:modal.shift!.id,toId:moveId,allowOverlap,overrideHourLimits})}>Move assignment</button></>}
     {!published&&<details className="record-request"><summary>Record a request</summary><div className="form-stack"><Pick label="Employee requesting shift" value={requestEmployeeId} onChange={id=>{setRequestEmployeeId(id);setNote(data.requests.find(request=>request.shiftId===modal.shift!.id&&request.employeeId===id)?.note??'');}} options={[{value:'none',label:'Choose employee'},...activeEmployees.map(employee=>({value:employee.id,label:employee.name}))]}/><label>Private note<textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={300}/></label><button className="btn outline" disabled={busy||requestEmployeeId==='none'} onClick={()=>doAndClose({action:'request',shiftId:modal.shift!.id,employeeId:requestEmployeeId,note})}>Save request</button></div></details>}
     <div className="shift-detail-actions"><button className="text-button" disabled={!!modal.shift!.employeeId} onClick={()=>setModal({kind:'editShift',shift:modal.shift})}>Edit date / time</button><button className="text-button danger" disabled={!!modal.shift!.employeeId} onClick={()=>setConfirm({title:'Remove this shift?',description:'The shift and its requests will be removed.',action:{action:'deleteShift',shiftId:modal.shift!.id}})}>Remove shift</button></div>{modal.shift!.employeeId&&<p className="helper">Unassign before editing or removing.</p>}
    </div></details>
    <button className="btn primary" disabled={busy||(assignmentOverlap&&!allowOverlap)||(assignmentIssues.length>0&&!overrideHourLimits)} onClick={()=>doAndClose({action:'assign',shiftId:modal.shift!.id,employeeId:employeeId==='none'?null:employeeId,allowOverlap,overrideHourLimits})}>Save assignment</button>
   </>:!published?<>
    <label>Private note <span className="muted">(optional)</span><textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={300} placeholder="Only you and your admin can read this."/></label>
    <button className="btn primary" disabled={busy} onClick={()=>doAndClose({action:'request',shiftId:modal.shift!.id,note})}>{requests.some(request=>request.shiftId===modal.shift!.id&&request.employeeId===data.employeeId)?'Save note':'Request shift'}</button>
   </>:<p className="helper">This week is published.</p>}
  </div>}
 </DialogContent></Dialog>
 <AlertDialog open={!!confirm} onOpenChange={open=>{if(!open)setConfirm(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.description}</AlertDialogDescription></AlertDialogHeader>{confirm?.action.action==='publish'&&confirm.action.published===true&&weekIssues.length>0&&<div className="form-stack"><div className="hours-warning"><ul>{weekIssues.map(issue=><li key={issue.employeeId+issue.kind+issue.period}>{name(issue.employeeId)}: {hourIssueText(issue)}</li>)}</ul></div><label className="checkbox-label"><Checkbox checked={overridePublishHours} onCheckedChange={value=>setOverridePublishHours(value===true)}/> Admin override: approve these extra hours and publish</label></div>}<AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy||(confirm?.action.action==='publish'&&confirm.action.published===true&&weekIssues.length>0&&!overridePublishHours)} onClick={async()=>{const saved=await act({...confirm!.action,...(confirm!.action.action==='publish'?{overrideHourLimits:overridePublishHours}:{})});if(saved){setConfirm(null);setModal(null);}}}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
 <Toaster richColors position="bottom-right"/>
 </>;
}
