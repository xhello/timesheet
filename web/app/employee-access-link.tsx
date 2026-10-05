'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function EmployeeAccessLink() {
  const [url, setUrl] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setUrl(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).toString());
  }, []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Open ${url} and sign in with the phone number your admin registered for you.`);
      toast.success('Employee login link and instructions copied.');
    } catch {
      field.current?.focus();
      field.current?.select();
      toast.error('Select and copy the login link below.');
    }
  }
  return <div className="form-stack">
    <label>Employee login link<input ref={field} value={url} readOnly aria-label="Employee login link"/></label>
    <button className="btn outline full" disabled={!url} onClick={copy}><Copy size={15}/> Copy login link</button>
  </div>;
}
