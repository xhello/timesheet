'use client';
import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';



export default function InviteCode({code,name}:{code:string;name:string}) {
  const [inviteUrl,setInviteUrl]=useState('');
  useEffect(()=>{const base=process.env.NEXT_PUBLIC_SITE_URL||window.location.origin;setInviteUrl(new URL('/login?mode=signup',base).toString());},[]);
  const messageField=useRef<HTMLTextAreaElement>(null);
  const invitation=`Hi ${name}, join our team on Shiftboard.\n\nInvite link: ${inviteUrl}\nJoining code: ${code}\n\nOpen the link, create your account or sign in, verify your email, then enter this code on the “Join your team” screen.\n\nThis code expires 7 days after creation and can be used once. If the code is expired or has already been used, ask your admin for a new code.`;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invitation);
      toast.success('Invite link, joining code, and instructions copied.');
    } catch {
      messageField.current?.focus();
      messageField.current?.select();
      toast.error('Automatic copying is unavailable. The invitation is selected—copy it manually.');
    }
  }

  return <>
    <div className="code-display">{code}</div>
    <label>Ready-to-share invitation
      <textarea ref={messageField} value={invitation} readOnly rows={9} className="invite-message" aria-label="Invitation message with app link and joining code"/>
    </label>
    <button className="btn primary" disabled={!inviteUrl} onClick={copyInvite}><Copy size={16}/> Copy invite link & code</button>
    <p className="helper">Send this invitation to {name}. They can create an account and enter their joining code after verifying their email.</p>
  </>;
}
