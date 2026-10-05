import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import type { State } from './schedule';

const TABLE = 'schedule_workspace';
const WORKSPACE_ID = 'main';
type WriteResult = { meta: { changes: number } };

export async function readState(): Promise<{ state: State; version: number } | null> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .select('payload, version')
    .eq('id', WORKSPACE_ID)
    .maybeSingle();

  if (error) throw error;
  return data ? { state: data.payload as State, version: data.version } : null;
}

export async function createState(state: State): Promise<WriteResult> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .insert({ id: WORKSPACE_ID, payload: state, version: 0 })
    .select('id');

  // Concurrent setup can create the singleton only once.
  if (error?.code === '23505') return { meta: { changes: 0 } };
  if (error) throw error;
  return { meta: { changes: data?.length ?? 0 } };
}

export async function commitState(state: State, version: number): Promise<WriteResult> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .update({ payload: state, version: version + 1 })
    .eq('id', WORKSPACE_ID)
    .eq('version', version)
    .select('id');

  // The version predicate and increment are one database statement, so stale
  // writers cannot overwrite an update committed by another request.
  if (error) throw error;
  return { meta: { changes: data?.length ?? 0 } };
}
