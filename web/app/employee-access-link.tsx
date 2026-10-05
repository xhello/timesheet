'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function EmployeeAccessLink({ compact = false }: { compact?: boolean }) {
  const [url, setUrl] = useState('');
  const [showLink, setShowLink] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setUrl(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).toString());
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Open ${url} and sign in with the phone number your admin registered for you.`);
      toast.success('Login link copied.');
    } catch {
      setShowLink(true);
      toast.error('Select and copy the login link below.');
    }
  }
  useEffect(() => {
    if (showLink) { field.current?.focus(); field.current?.select(); }
  }, [showLink]);
  return <div className={compact ? 'access-link-compact' : 'form-stack'}>
    {(!compact || showLink) && <label>Employee login link<input ref={field} value={url} readOnly aria-label="Employee login link"/></label>}
    <button className={'btn outline'+(compact?'':' full')} disabled={!url} onClick={copy}><Copy size={15}/> Copy login link</button>
  </div>;
}
