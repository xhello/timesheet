'use client';

import { useState } from 'react';
import { getBusinessByEmail } from '@/lib/supabase';

interface Props {
  onBack: () => void;
}

export default function ForgotBusinessID({ onBack }: Props) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSend = async () => {
    if (!email.trim() || !isValidEmail(email)) return;

    setIsLoading(true);
    setMessage('');

    try {
      const business = await getBusinessByEmail(email);

      if (business) {
        // Send email with business code
        const response = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: email,
            businessName: business.name,
            businessCode: business.business_code,
          }),
        });

        if (response.ok) {
          setIsSuccess(true);
          setMessage(`Business ID sent to ${email}!`);
        } else {
          setIsSuccess(false);
          setMessage('Failed to send email. Please try again.');
        }
      } else {
        setIsSuccess(false);
        setMessage('No business found with this email address.');
      }
    } catch (err) {
      setIsSuccess(false);
      setMessage('Failed to connect. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-4 flex items-center">
        <button onClick={onBack} className="text-blue-600 font-semibold">
          ← Cancel
        </button>
        <h1 className="flex-1 text-center font-semibold">Recover Business ID</h1>
        <div className="w-16" />
      </div>

      {/* Content */}
      <div className="flex-1 p-4 flex flex-col items-center justify-center space-y-6">
        <div className="text-6xl">📧</div>
        
        <h2 className="text-xl font-bold text-gray-900">Forgot Business ID?</h2>
        
        <p className="text-gray-600 text-center max-w-sm">
          Enter your email address and we&apos;ll send your Business ID if it exists in our system.
        </p>

        <div className="w-full max-w-md">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>

        {message && (
          <div className={`w-full max-w-md p-4 rounded-lg ${
            isSuccess 
              ? 'bg-green-50 border border-green-200' 
              : 'bg-orange-50 border border-orange-200'
          }`}>
            <p className={`text-sm ${isSuccess ? 'text-green-700' : 'text-orange-700'}`}>
              {isSuccess ? '✅' : '⚠️'} {message}
            </p>
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={!email.trim() || !isValidEmail(email) || isLoading}
          className="w-full max-w-md py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <span>✈️</span>
              <span>Send Business ID</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
