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
  latitude: number | null;
  longitude: number | null;
  password_hash: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Simple password hashing using Web Crypto API
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Verify password
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const passwordHash = await hashPassword(password);
  return passwordHash === hash;
}

// Calculate distance between two coordinates in miles (Haversine formula)
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  clock_out_latitude: number | null;
  clock_out_longitude: number | null;
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

// Get recent time entries for a business (for admin notifications)
export async function getRecentTimeEntriesByBusiness(businessId: string, limit: number = 20): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('business_id', businessId)
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
  time_entry_id: string | null; // null for "add hours" requests
  employee_id: string;
  business_id: string;
  original_clock_in: string | null; // null for "add hours" requests
  original_clock_out: string | null;
  requested_clock_in: string;
  requested_clock_out: string | null;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
  reviewed_at: string | null;
  created_at: string;
  request_type?: 'edit' | 'add'; // 'add' for new hours request
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

export async function approveTimeChangeRequest(
  requestId: string, 
  timeEntryId: string | null, 
  newClockIn: string, 
  newClockOut: string | null,
  employeeId?: string,
  businessId?: string
): Promise<void> {
  if (timeEntryId) {
    // Update existing time entry
    await supabase
      .from('time_entries')
      .update({
        clock_in_time: newClockIn,
        clock_out_time: newClockOut,
        status: 'edited',
      })
      .eq('id', timeEntryId);
  } else if (employeeId && businessId) {
    // Create new time entry for "add hours" request
    await supabase
      .from('time_entries')
      .insert({
        employee_id: employeeId,
        business_id: businessId,
        clock_in_time: newClockIn,
        clock_out_time: newClockOut,
        status: 'approved',
        clock_in_liveness_verified: false,
        clock_out_liveness_verified: false,
      });
  }
  
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
