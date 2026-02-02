'use client';

import { useState } from 'react';
import { getBusinessByCode, Business } from '@/lib/supabase';

interface Props {
  onLoginSuccess: (business: Business) => void;
  onSignUpClick: () => void;
  onForgotIdClick: () => void;
}

export default function BusinessLogin({ onLoginSuccess, onSignUpClick, onForgotIdClick }: Props) {
  const [businessCode, setBusinessCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!businessCode.trim()) return;
    
    setIsLoading(true);
    setError('');

    try {
      const business = await getBusinessByCode(businessCode);
      
      if (!business) {
        setError('Business ID not found. Please check and try again.');
        return;
      }

      onLoginSuccess(business);
    } catch (err) {
      setError('Failed to connect. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700 flex flex-col items-center justify-center p-4">
      {/* Logo */}
      <div className="text-center mb-12">
        <div className="text-7xl mb-4">⏰</div>
        <h1 className="text-4xl font-bold text-white mb-2">TimeSheet</h1>
        <p className="text-white/70">Face Verification Time Tracking</p>
      </div>

      {/* Login Card */}
      <div className="w-full max-w-md space-y-6">
        {/* Business ID Input */}
        <div>
          <label className="block text-white font-semibold mb-2">Business ID</label>
          <input
            type="text"
            value={businessCode}
            onChange={(e) => setBusinessCode(e.target.value.toUpperCase())}
            placeholder="Enter Business ID (e.g., ABC123)"
            className="w-full px-4 py-4 text-2xl font-mono text-center bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50 tracking-widest"
            maxLength={6}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/20 border border-red-400/50 rounded-lg p-3 text-center">
            <p className="text-white text-sm">{error}</p>
          </div>
        )}

        {/* Login Button */}
        <button
          onClick={handleLogin}
          disabled={!businessCode.trim() || isLoading}
          className="w-full py-4 bg-green-500 hover:bg-green-600 disabled:bg-gray-500 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Logging in...</span>
            </>
          ) : (
            <>
              <span>→</span>
              <span>Login</span>
            </>
          )}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4">
          <div className="flex-1 h-px bg-white/30" />
          <span className="text-white/50 text-sm">OR</span>
          <div className="flex-1 h-px bg-white/30" />
        </div>

        {/* Sign Up Button */}
        <button
          onClick={onSignUpClick}
          className="w-full py-4 border-2 border-white text-white font-semibold rounded-xl hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
        >
          <span>🏢</span>
          <span>Register New Business</span>
        </button>

        {/* Forgot Business ID */}
        <button
          onClick={onForgotIdClick}
          className="w-full py-2 text-white/70 hover:text-white text-sm transition-colors flex items-center justify-center gap-1"
        >
          <span>❓</span>
          <span>Forgot Business ID?</span>
        </button>
      </div>

      {/* Footer */}
      <div className="mt-12 flex items-center gap-2 text-white/50 text-sm">
        <div className="w-2 h-2 bg-green-400 rounded-full" />
        <span>Online</span>
      </div>
    </div>
  );
}
