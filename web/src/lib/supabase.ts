import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for database
export interface Business {
  id: string;
  business_code: string;
  name: string;
  email: string | null;
  address: string | null;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Employee {
  id: string;
  business_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  face_encoding: Record<string, number> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  employee_id: string;
  business_id: string;
  clock_in_time: string;
  clock_out_time: string | null;
  status: 'active' | 'completed' | 'edited' | 'disputed' | 'approved';
  clock_in_liveness_verified: boolean;
  clock_in_liveness_score: number | null;
  clock_out_liveness_verified: boolean;
  clock_out_liveness_score: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Business operations
export async function getBusinessByCode(code: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('business_code', code.toUpperCase())
    .single();
  
  if (error) return null;
  return data;
}

export async function getBusinessByEmail(email: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('email', email.toLowerCase())
    .single();
  
  if (error) return null;
  return data;
}

export async function createBusiness(business: Partial<Business>): Promise<Business> {
  const { data, error } = await supabase
    .from('businesses')
    .insert(business)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// Employee operations
export async function getEmployeesByBusiness(businessId: string): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('business_id', businessId)
    .eq('is_active', true);
  
  if (error) throw error;
  return data || [];
}

export async function createEmployee(employee: Partial<Employee>): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .insert(employee)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getEmployeeByEmail(businessId: string, email: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('business_id', businessId)
    .eq('email', email.toLowerCase())
    .single();
  
  if (error) return null;
  return data;
}

export async function getEmployeeByPhone(businessId: string, phone: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('business_id', businessId)
    .eq('phone', phone)
    .single();
  
  if (error) return null;
  return data;
}

// Time entry operations
export async function getActiveTimeEntry(employeeId: string): Promise<TimeEntry | null> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .eq('status', 'active')
    .is('clock_out_time', null)
    .order('clock_in_time', { ascending: false })
    .limit(1)
    .single();
  
  if (error) return null;
  return data;
}

export async function createTimeEntry(entry: Partial<TimeEntry>): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .insert(entry)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function updateTimeEntry(id: string, updates: Partial<TimeEntry>): Promise<TimeEntry> {
  const { data, error } = await supabase
    .from('time_entries')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

// Get all employees (for face matching across all businesses)
export async function getAllEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('is_active', true);
  
  if (error) throw error;
  return data || [];
}

// Get employee by ID
export async function getEmployeeById(employeeId: string): Promise<Employee | null> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', employeeId)
    .single();
  
  if (error) return null;
  return data;
}

// Get time entries for an employee
export async function getTimeEntriesByEmployee(employeeId: string, limit: number = 50): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('employee_id', employeeId)
    .order('clock_in_time', { ascending: false })
    .limit(limit);
  
  if (error) throw error;
  return data || [];
}

// Get business by ID
export async function getBusinessById(businessId: string): Promise<Business | null> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('id', businessId)
    .single();
  
  if (error) return null;
  return data;
}

// Time Change Request interface and operations
export interface TimeChangeRequest {
  id: string;
  time_entry_id: string;
  employee_id: string;
  business_id: string;
  original_clock_in: string;
  original_clock_out: string | null;
  requested_clock_in: string;
  requested_clock_out: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
  reviewed_at: string | null;
  created_at: string;
}

export async function createTimeChangeRequest(request: Partial<TimeChangeRequest>): Promise<TimeChangeRequest> {
  const { data, error } = await supabase
    .from('time_change_requests')
    .insert(request)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getTimeChangeRequestsByBusiness(businessId: string): Promise<TimeChangeRequest[]> {
  const { data, error } = await supabase
    .from('time_change_requests')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

export async function getPendingTimeChangeRequests(businessId: string): Promise<TimeChangeRequest[]> {
  const { data, error } = await supabase
    .from('time_change_requests')
    .select('*')
    .eq('business_id', businessId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

export async function approveTimeChangeRequest(requestId: string, timeEntryId: string, newClockIn: string, newClockOut: string | null): Promise<void> {
  // Update the time entry
  await supabase
    .from('time_entries')
    .update({
      clock_in_time: newClockIn,
      clock_out_time: newClockOut,
      status: 'edited',
    })
    .eq('id', timeEntryId);
  
  // Update the request status
  await supabase
    .from('time_change_requests')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);
}

export async function declineTimeChangeRequest(requestId: string): Promise<void> {
  await supabase
    .from('time_change_requests')
    .update({
      status: 'declined',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', requestId);
}

export async function getTimeChangeRequestsByEmployee(employeeId: string): Promise<TimeChangeRequest[]> {
  const { data, error } = await supabase
    .from('time_change_requests')
    .select('*')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

// Generate business code
export function generateBusinessCode(): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}
