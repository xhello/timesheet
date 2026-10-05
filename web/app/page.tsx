import { requireCurrentUser } from '@/lib/auth';
import { isConfigured } from '@/lib/config';
import Scheduler from './scheduler';
export const dynamic='force-dynamic';
export default async function Page(){
  if(!isConfigured()) return <main className="onboarding"><div className="eyebrow">SHIFTBOARD</div><h1>Connect your workspace.</h1><p>The app is ready for its Supabase connection. Configure the environment variables and database migration described in the project README, then start the app again.</p><p>Sign-in and scheduling become available after setup is complete.</p></main>;
  await requireCurrentUser('/');
  return <Scheduler/>;
}
