'use client';

import { useState } from 'react';
import { getBusinessByCode, getBusinessByEmail, hashPassword, supabase } from '@/lib/supabase';

interface Props {
  onBack: () => void;
}

export default function ForgotPassword({ onBack }: Props) {
  const [step, setStep] = useState<'find' | 'reset'>('find');
  const [businessIdOrEmail, setBusinessIdOrEmail] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleFindBusiness = async () => {
    if (!businessIdOrEmail.trim()) return;

    setIsLoading(true);
    setMessage('');

    try {
      let business = null;
      
      // Check if input is email or business ID
      if (isValidEmail(businessIdOrEmail)) {
        business = await getBusinessByEmail(businessIdOrEmail);
      } else {
        business = await getBusinessByCode(businessIdOrEmail.toUpperCase());
      }

      if (business) {
        if (!business.email) {
          setIsSuccess(false);
          setMessage('This business has no email on file. Cannot reset password.');
          return;
        }
        setBusinessId(business.business_code);
        setBusinessEmail(business.email);
        setStep('reset');
      } else {
        setIsSuccess(false);
        setMessage('No business found. Please check your Business ID or email.');
      }
    } catch (err) {
      setIsSuccess(false);
      setMessage('Failed to connect. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      setMessage('Password must be at least 6 characters.');
      setIsSuccess(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('Passwords do not match.');
      setIsSuccess(false);
      return;
    }

    setIsLoading(true);
    setMessage('');

    try {
      // Hash the new password
      const passwordHash = await hashPassword(newPassword);

      // Update password in database
      const { error, data } = await supabase
        .from('businesses')
        .update({ password_hash: passwordHash })
        .eq('business_code', businessId)
        .select();

      if (error) {
        console.error('Supabase error:', error);
        throw new Error(error.message || 'Database update failed');
      }
      
      if (!data || data.length === 0) {
        throw new Error('Business not found or update failed');
      }

      // Send confirmation email
      try {
        await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: businessEmail,
            businessName: 'Password Reset',
            businessCode: businessId,
            type: 'password-reset',
          }),
        });
      } catch (emailErr) {
        console.log('Email notification failed:', emailErr);
      }

      setIsSuccess(true);
      setMessage('Password reset successfully! You can now login with your new password.');
    } catch (err) {
      setIsSuccess(false);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessage(`Failed to reset password: ${errorMsg}`);
      console.error('Password reset error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-4 flex items-center">
        <button onClick={step === 'reset' ? () => setStep('find') : onBack} className="text-blue-600 font-semibold">
          ← {step === 'reset' ? 'Back' : 'Cancel'}
        </button>
        <h1 className="flex-1 text-center font-semibold">Reset Password</h1>
        <div className="w-16" />
      </div>

      {/* Content */}
      <div className="flex-1 p-4 flex flex-col items-center justify-center space-y-6">
        {step === 'find' ? (
          <>
            <div className="text-6xl">🔑</div>
            
            <h2 className="text-xl font-bold text-gray-900">Forgot Password?</h2>
            
            <p className="text-gray-600 text-center max-w-sm">
              Enter your Business ID or email address to reset your password.
            </p>

            <div className="w-full max-w-md">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Business ID or Email
              </label>
              <input
                type="text"
                value={businessIdOrEmail}
                onChange={(e) => setBusinessIdOrEmail(e.target.value)}
                placeholder="Enter Business ID or email"
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
              onClick={handleFindBusiness}
              disabled={!businessIdOrEmail.trim() || isLoading}
              className="w-full max-w-md py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <span>🔍</span>
                  <span>Find Business</span>
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <div className="text-6xl">🔐</div>
            
            <h2 className="text-xl font-bold text-gray-900">Set New Password</h2>
            
            <p className="text-gray-600 text-center max-w-sm">
              Business ID: <span className="font-mono font-bold">{businessId}</span>
              <br />
              <span className="text-sm">Email: {businessEmail}</span>
            </p>

            <div className="w-full max-w-md space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Password (min 6 characters)
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 ${
                    confirmPassword && newPassword !== confirmPassword 
                      ? 'border-red-300 bg-red-50' 
                      : 'border-gray-300'
                  }`}
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-red-500 text-xs mt-1">Passwords do not match</p>
                )}
              </div>
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

            {isSuccess ? (
              <button
                onClick={onBack}
                className="w-full max-w-md py-4 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <span>→</span>
                <span>Go to Login</span>
              </button>
            ) : (
              <button
                onClick={handleResetPassword}
                disabled={!newPassword || newPassword.length < 6 || newPassword !== confirmPassword || isLoading}
                className="w-full max-w-md py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Resetting...</span>
                  </>
                ) : (
                  <>
                    <span>🔑</span>
                    <span>Reset Password</span>
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
