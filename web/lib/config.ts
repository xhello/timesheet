import 'server-only';

export function getMissingConfiguration(): string[] {
  const missing:string[]=[];
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if(!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY&&!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if(!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if(!process.env.ADMIN_EMAIL) missing.push('ADMIN_EMAIL');
  if(!process.env.EMPLOYEE_SESSION_SECRET || process.env.EMPLOYEE_SESSION_SECRET.length < 32) missing.push('EMPLOYEE_SESSION_SECRET');
  return missing;
}
export function isConfigured() {return getMissingConfiguration().length===0;}
