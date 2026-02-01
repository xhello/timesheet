'use client';

import { useState } from 'react';
import { createBusiness, generateBusinessCode, getBusinessByCode } from '@/lib/supabase';

interface Props {
  onBack: () => void;
  onSuccess: () => void;
}

export default function BusinessSignUp({ onBack, onSuccess }: Props) {
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleRegister = async () => {
    if (!businessName.trim() || !email.trim() || !isValidEmail(email)) return;

    setIsLoading(true);
    setError('');

    try {
      // Generate unique code
      let code = generateBusinessCode();
      
      // Check if code exists (rare but possible)
      let existing = await getBusinessByCode(code);
      while (existing) {
        code = generateBusinessCode();
        existing = await getBusinessByCode(code);
      }

      setGeneratedCode(code);

      // Create business in Supabase
      await createBusiness({
        business_code: code,
        name: businessName.trim(),
        email: email.toLowerCase().trim(),
      });

      // Send email with business code
      try {
        const response = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: email,
            businessName: businessName,
            businessCode: code,
          }),
        });

        if (response.ok) {
          setEmailSent(true);
        }
      } catch (emailError) {
        console.error('Failed to send email:', emailError);
      }

      setShowSuccess(true);
    } catch (err) {
      setError('Failed to register business. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  if (showSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="text-6xl">✅</div>
          <h1 className="text-2xl font-bold text-gray-900">Business Registered!</h1>
          
          {emailSent ? (
            <p className="text-gray-600">
              Your Business ID has been sent to<br />
              <span className="font-semibold text-blue-600">{email}</span>
            </p>
          ) : (
            <p className="text-orange-600">
              Email could not be sent. Please save this code!
            </p>
          )}

          <div className="bg-gradient-to-br from-blue-600 to-purple-700 rounded-2xl p-8">
            <p className="text-white/70 text-sm mb-2">Your Business ID</p>
            <p className="text-4xl font-mono font-bold text-white tracking-widest">
              {generatedCode}
            </p>
          </div>

          <p className="text-orange-500 text-sm">
            ⚠️ Save this code! You&apos;ll need it to log in.
          </p>

          <button
            onClick={onSuccess}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-4 flex items-center">
        <button onClick={onBack} className="text-blue-600 font-semibold">
          ← Cancel
        </button>
        <h1 className="flex-1 text-center font-semibold">New Business</h1>
        <div className="w-16" />
      </div>

      {/* Form */}
      <div className="flex-1 p-4 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Business Name
          </label>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Enter business name"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email Address (required)
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <p className="text-sm text-gray-500">
          A unique Business ID will be generated and sent to your email address.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        <button
          onClick={handleRegister}
          disabled={!businessName.trim() || !email.trim() || !isValidEmail(email) || isLoading}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Registering...</span>
            </>
          ) : (
            <>
              <span>📧</span>
              <span>Register & Send ID</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
