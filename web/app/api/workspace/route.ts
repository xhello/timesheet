import { getCurrentUser } from '@/lib/auth';
import { normalizePhone } from '@/lib/phone';
import { isSameOriginRequest } from '@/app/auth/origin';
import { createState, readState, commitState } from '@/lib/storage';
import { State, Shift, INITIAL_WEEK, weekOf, addDays, conflict, fillByPriority, workHourSettings, assignmentHourIssues, weekHourIssues, hourIssueText } from '@/lib/schedule';
import imported from '@/lib/imported.json';
import { z } from 'zod';
export const dynamic='force-dynamic';
export const runtime='nodejs';
type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
const initialSchedule:Pick<State,'employees'|'shifts'|'notes'> & Partial<Pick<State,'requests'|'weeks'|'priorityConfirmed'|'settings'>>=imported;
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().startsWith(s),'Invalid date');
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const txt=z.string().trim().min(1).max(80);
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('setup')}),
 z.object({action:z.literal('employee'),id:z.string().optional(),name:txt,hireDate:z.union([date,z.literal('')]),phone:z.string().trim().max(50).optional()}),
 z.object({action:z.literal('priority'),ids:z.array(txt).max(200)}),
 z.object({action:z.literal('settings'),dailyMaxHours:z.number().min(0.25).max(24).multipleOf(0.25),weeklyMaxHours:z.number().min(0.25).max(168).multipleOf(0.25)}),
 z.object({action:z.literal('assign'),shiftId:txt,employeeId:z.string().nullable(),allowOverlap:z.boolean().optional(),overrideHourLimits:z.boolean().optional()}),
 z.object({action:z.literal('move'),fromId:txt,toId:txt,allowOverlap:z.boolean().optional(),overrideHourLimits:z.boolean().optional()}),
 z.object({action:z.literal('shift'),id:z.string().optional(),date,start:time,end:time,label:txt}),
 z.object({action:z.literal('deleteShift'),shiftId:txt}),
 z.object({action:z.literal('request'),shiftId:txt,note:z.string().trim().max(300),employeeId:z.string().optional()}),
 z.object({action:z.literal('withdraw'),requestId:txt}),
 z.object({action:z.literal('auto'),week:date}),
 z.object({action:z.literal('week'),week:date}),
 z.object({action:z.literal('publish'),week:date,published:z.boolean(),overrideHourLimits:z.boolean().optional()}),
]);
function fail(message:string,status=400):never { throw Object.assign(new Error(message),{status}); }
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
function canSetUpWorkspace(user:CurrentUser) {
 const adminEmail=process.env.ADMIN_EMAIL?.trim().toLowerCase();
 return user.authType==='email'&&!!adminEmail&&user.emailVerified===true&&user.email.trim().toLowerCase()===adminEmail;
}
function view(state:State|null,version:number,user:CurrentUser) {
 if(!state) return {role:canSetUpWorkspace(user)?'setup':'guest',version,userName:user.displayName};
 const admin=canSetUpWorkspace(user)&&state.ownerId===user.userId; const employee=user.authType==='phone'?state.employees.find(e=>e.id===user.employeeId&&e.phone&&e.phoneVersion===user.phoneVersion&&e.active):undefined;
 if(!admin&&!employee) return {role:'guest',version,userName:user.displayName};
 return {role:admin?'admin':'employee',userName:user.displayName,employeeId:employee?.id,version,priorityConfirmed:state.priorityConfirmed,notes:admin?state.notes:[],weeks:state.weeks,settings:workHourSettings(state),
  employees:state.employees.map(e=>({id:e.id,name:e.name,active:e.active,hireDate:admin?e.hireDate:'',priority:admin?e.priority:0,phone:admin?(e.phone??''):undefined,connected:admin?!!e.phone:undefined})),
  shifts:state.shifts.map(s=>admin||state.weeks[weekOf(s.date)]==='published'?s:{...s,employeeId:null,source:'draft',note:undefined}),
  requests:admin?state.requests:state.requests.filter(r=>r.employeeId===employee!.id)};
}
export async function GET(){try{const user=await getCurrentUser();if(!user)return json({error:'Sign in to access the schedule.'},401);if(user.authType==='email'&&!user.emailVerified)return json({error:'Verify your email before accessing the schedule.'},403);const saved=await readState();return json(view(saved?.state??null,saved?.version??0,user));}catch(e){console.error('Schedule read failed',e);return json({error:'Your schedule could not load. Please try again.'},503);}}
export async function POST(req:Request){try{
 if(!isSameOriginRequest(req))fail('Request origin is not allowed.',403);
 const user=await getCurrentUser();if(!user)fail('Sign in to continue.',401);
 if(user.authType==='email'&&!user.emailVerified)fail('Verify your email before accessing the schedule.',403);
 let raw:unknown;try{raw=await req.json();}catch{fail('Send a valid JSON request.');}
 const parsed=input.safeParse(raw);if(!parsed.success)fail(parsed.error.issues[0]?.message??'Check your input.');const a=parsed.data;
 const saved=await readState();
 if(a.action==='setup'){
  if(!canSetUpWorkspace(user))fail('Only the configured admin with a verified email can set up this workspace.',403);
  if(saved)fail('This workspace is already set up.',409);
  const employees=structuredClone(initialSchedule.employees).map(employee=>{delete employee.userId;delete employee.codeHash;delete employee.codeExpires;return employee;});
  const state:State={ownerId:user.userId,ownerName:user.displayName,employees,shifts:structuredClone(initialSchedule.shifts),requests:structuredClone(initialSchedule.requests??[]),weeks:{...initialSchedule.weeks??{[INITIAL_WEEK]:'draft'}},imported:true,priorityConfirmed:initialSchedule.priorityConfirmed??false,notes:[...initialSchedule.notes],settings:workHourSettings(initialSchedule)};
  const res=await createState(state);
  if(!res.meta.changes)fail('Workspace was just created. Refresh to continue.',409);
  return json({...view(state,0,user),message:'Front Desk schedule imported.'});
 }
 if(!saved)fail('The admin needs to set up this workspace first.',403);
 const {state,version}=saved;const admin=canSetUpWorkspace(user)&&state.ownerId===user.userId;const me=user.authType==='phone'?state.employees.find(e=>e.id===user.employeeId&&e.phone&&e.phoneVersion===user.phoneVersion&&e.active):undefined;
 if(!admin&&!me)fail('Sign in with the phone number your admin added to your employee profile.',403);
 if(!['request','withdraw'].includes(a.action)&&!admin)fail('Only the admin can make this change.',403);
 if((raw as Record<string,unknown>).version!==version)fail('The schedule changed in another session. Refresh and try again.',409);
 let message='Changes saved.';
 const getShift=(id:string)=>{const s=state.shifts.find(s=>s.id===id);if(!s)fail('Shift no longer exists.',404);return s;};
 const getEmployee=(id:string)=>{const e=state.employees.find(e=>e.id===id&&e.active);if(!e)fail('Employee not found.',404);return e;};
 const markDraft=(s:Shift)=>{state.weeks[weekOf(s.date)]='draft';};
 switch(a.action){
 case 'employee':{
  if(a.hireDate&&a.hireDate>new Date().toISOString().slice(0,10))fail('Hire date cannot be in the future.');
  const previous=a.id?getEmployee(a.id):undefined;
  const phone=a.phone===undefined?(previous?.phone??''):a.phone?normalizePhone(a.phone):'';
  if(phone===null)fail('Enter a 10-digit US/Canada phone number or an international number with +country code.');
  if(phone&&state.employees.some(e=>e.id!==a.id&&e.active&&normalizePhone(e.phone??'')===phone))fail('That phone number is already assigned to another employee.',409);
  if(previous){
   previous.name=a.name;previous.hireDate=a.hireDate;
   if((previous.phone??'')!==phone||phone&&!previous.phoneVersion){previous.phone=phone;previous.phoneVersion=crypto.randomUUID();}
   delete previous.userId;delete previous.codeHash;delete previous.codeExpires;
  } else {
   if(state.employees.length>=200)fail('Employee limit reached.');
   state.employees.push({id:crypto.randomUUID(),name:a.name,hireDate:a.hireDate,phone,phoneVersion:crypto.randomUUID(),priority:state.employees.length+1,active:true});
  }
  message='Employee saved.';break;
 }
 case 'priority':{
  const ids=state.employees.filter(e=>e.active).map(e=>e.id);if(new Set(a.ids).size!==ids.length||a.ids.length!==ids.length||ids.some(id=>!a.ids.includes(id)))fail('Include every active employee once.');
  a.ids.forEach((id,i)=>getEmployee(id).priority=i+1);state.priorityConfirmed=true;message='Priority order saved.';break;
 }
 case 'settings':{state.settings={dailyMaxHours:a.dailyMaxHours,weeklyMaxHours:a.weeklyMaxHours};message='Work-hour limits saved. Existing assignments are unchanged; review any overages.';break;}
 case 'assign':{
  const s=getShift(a.shiftId);if(a.employeeId){getEmployee(a.employeeId);if(conflict(state,s,a.employeeId)&&!a.allowOverlap)fail('This employee has an overlapping shift. Confirm the overlap if both duties can be worked.',422);}
  const issues=a.employeeId?assignmentHourIssues(state,s,a.employeeId):[];
  if(issues.length&&!a.overrideHourLimits)fail('Work-hour limit exceeded: '+issues.map(hourIssueText).join('; ')+'. An admin can explicitly override these limits.',422);
  s.employeeId=a.employeeId;s.source='manual';s.hourLimitOverride=issues.length>0&&a.overrideHourLimits===true;markDraft(s);message='Assignment updated.';break;
 }
 case 'move':{
  const from=getShift(a.fromId),to=getShift(a.toId);if(from.id===to.id)fail('Choose another shift.');if(!from.employeeId)fail('The source shift is empty.');if(to.employeeId)fail('Move to an open shift, or edit the target assignment directly.');
  if(conflict(state,to,from.employeeId,from.id)&&!a.allowOverlap)fail('Moving would create overlapping shifts. Edit the target to confirm compatible duties.',422);
  const issues=assignmentHourIssues(state,to,from.employeeId,from.id);
  if(issues.length&&!a.overrideHourLimits)fail('Moving exceeds a work-hour limit: '+issues.map(hourIssueText).join('; ')+'. Open the shift editor to approve an admin override.',422);
  to.employeeId=from.employeeId;to.source='manual';to.hourLimitOverride=issues.length>0&&a.overrideHourLimits===true;from.employeeId=null;from.source='manual';from.hourLimitOverride=false;markDraft(from);markDraft(to);message='Assignment moved.';break;
 }
 case 'shift':{
  if(a.start===a.end)fail('Start and end times must differ.');
  if(a.id){const s=getShift(a.id);if(s.employeeId)fail('Unassign this shift before changing its time.');if(state.requests.some(r=>r.shiftId===s.id))fail('Withdraw existing requests before changing this shift. Employees requested the original hours.');markDraft(s);Object.assign(s,{date:a.date,start:a.start,end:a.end,label:a.label});markDraft(s);}
  else{if(state.shifts.length>=10000)fail('Schedule limit reached.');const s={id:crypto.randomUUID(),date:a.date,start:a.start,end:a.end,label:a.label,employeeId:null,source:'manual'};state.shifts.push(s);markDraft(s);}break;
 }
 case 'deleteShift':{const s=getShift(a.shiftId);if(s.employeeId)fail('Unassign this shift before removing it.');state.shifts=state.shifts.filter(x=>x.id!==s.id);state.requests=state.requests.filter(r=>r.shiftId!==s.id);markDraft(s);break;}
 case 'request':{
  const s=getShift(a.shiftId);if(state.weeks[weekOf(s.date)]==='published')fail('This week is published. Ask your admin to reopen it.');
  const employeeId=admin?a.employeeId:me!.id;if(!employeeId)fail('Choose an employee.');getEmployee(employeeId);
  const existing=state.requests.find(r=>r.shiftId===s.id&&r.employeeId===employeeId);
  if(existing)existing.note=a.note;else state.requests.push({id:crypto.randomUUID(),shiftId:s.id,employeeId,createdAt:new Date().toISOString(),note:a.note});message='Shift request saved.';break;
 }
 case 'withdraw':{const r=state.requests.find(r=>r.id===a.requestId);if(!r)fail('Request not found.',404);if(!admin&&r.employeeId!==me!.id)fail('This is not your request.',403);if(state.weeks[weekOf(getShift(r.shiftId).date)]==='published')fail('Published requests cannot be withdrawn.');state.requests=state.requests.filter(x=>x.id!==r.id);message='Request withdrawn.';break;}
 case 'auto':{if(!state.priorityConfirmed)fail('Set and save the priority order first.');const count=fillByPriority(state,a.week);state.weeks[a.week]='draft';message=`${count} open shift${count===1?'':'s'} assigned from requests. Existing assignments were preserved. Daily and weekly hour limits were respected.`;break;}
 case 'week':{const w=weekOf(a.week);if(state.shifts.some(s=>weekOf(s.date)===w))fail('This week already has shifts.');const templates=[['Morning','07:30','13:00'],['Afternoon','13:00','17:00'],['Evening','17:00','22:00'],['Hotel cleaning','17:30','20:30'],['Overnight','22:00','06:00']];for(let i=0;i<7;i++)for(const [label,start,end] of templates)state.shifts.push({id:crypto.randomUUID(),date:addDays(w,i),label,start,end,employeeId:null,source:'template'});state.weeks[w]='draft';message='New week created with your five shift types.';break;}
 case 'publish':{if(!state.shifts.some(s=>weekOf(s.date)===a.week))fail('Create shifts before publishing.');if(a.published){const issues=weekHourIssues(state,a.week);if(issues.length&&!a.overrideHourLimits)fail('This schedule exceeds work-hour limits. Review the flagged employees and explicitly approve an admin override before publishing.',422);}state.weeks[a.week]=a.published?'published':'draft';message=a.published?'Schedule published to employees.':'Week reopened for requests and edits.';break;}
 }
 const result=await commitState(state,version);if(!result.meta.changes)fail('Someone updated the schedule. Refresh and try again.',409);
 return json({...view(state,version+1,user),message});
 }catch(e){const status=(e as {status?:number}).status??500;if(status>=500)console.error('Schedule update failed',e);return json({error:status>=500?'Changes could not be saved. Please try again.':(e as Error).message},status);}}
