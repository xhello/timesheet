'use client';

import { useState, useEffect } from 'react';
import { createBusiness, generateBusinessCode, getBusinessByCode, hashPassword } from '@/lib/supabase';

interface Props {
  onBack: () => void;
  onSuccess: () => void;
}

export default function BusinessSignUp({ onBack, onSuccess }: Props) {
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  
  // Location state
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState('');
  const [locationLoading, setLocationLoading] = useState(true);

  // Get location on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser');
      setLocationLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationLoading(false);
      },
      (err) => {
        console.error('Location error:', err);
        setLocationError('Unable to get location. Please enable location services.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const isValidEmail = (email: string) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleRegister = async () => {
    if (!businessName.trim() || !email.trim() || !isValidEmail(email)) return;
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!location) {
      setError('Location is required. Please enable location services and refresh.');
      return;
    }

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

      // Hash password
      const passwordHash = await hashPassword(password);

      // Create business in Supabase with location and password
      await createBusiness({
        business_code: code,
        name: businessName.trim(),
        email: email.toLowerCase().trim(),
        latitude: location.latitude,
        longitude: location.longitude,
        password_hash: passwordHash,
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
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    
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

          {/* Direct Links */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-left space-y-3">
            <p className="text-sm font-semibold text-gray-700 mb-2">📎 Direct Links for Employees:</p>
            
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-500">Employee Portal:</p>
                <code className="text-xs bg-gray-100 px-2 py-1 rounded block break-all text-blue-600">
                  {baseUrl}/{generatedCode}
                </code>
              </div>
              
              <div>
                <p className="text-xs text-gray-500">Clock In/Out:</p>
                <code className="text-xs bg-gray-100 px-2 py-1 rounded block break-all text-blue-600">
                  {baseUrl}/{generatedCode}/clock
                </code>
              </div>
              
              <div>
                <p className="text-xs text-gray-500">New Employee Sign Up:</p>
                <code className="text-xs bg-gray-100 px-2 py-1 rounded block break-all text-blue-600">
                  {baseUrl}/{generatedCode}/signup
                </code>
              </div>
            </div>
          </div>

          <p className="text-orange-500 text-sm">
            ⚠️ Save these links! Share them with your employees.
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
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
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
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Password (min 6 characters)
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Confirm Password
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm password"
            className={`w-full px-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 ${
              confirmPassword && password !== confirmPassword 
                ? 'border-red-300 bg-red-50' 
                : 'border-gray-300'
            }`}
          />
          {confirmPassword && password !== confirmPassword && (
            <p className="text-red-500 text-xs mt-1">Passwords do not match</p>
          )}
        </div>

        {/* Location Status */}
        <div className={`rounded-xl p-4 ${
          locationLoading 
            ? 'bg-blue-50 border border-blue-200' 
            : location 
              ? 'bg-green-50 border border-green-200' 
              : 'bg-red-50 border border-red-200'
        }`}>
          <div className="flex items-center gap-3">
            {locationLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                <p className="text-blue-700 text-sm">Getting your location...</p>
              </>
            ) : location ? (
              <>
                <span className="text-xl">📍</span>
                <div>
                  <p className="text-green-700 text-sm font-medium">Location captured</p>
                  <p className="text-green-600 text-xs">
                    Employees must clock in/out within 500m of this location
                  </p>
                </div>
              </>
            ) : (
              <>
                <span className="text-xl">⚠️</span>
                <div>
                  <p className="text-red-700 text-sm font-medium">Location required</p>
                  <p className="text-red-600 text-xs">{locationError}</p>
                </div>
              </>
            )}
          </div>
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
          disabled={!businessName.trim() || !email.trim() || !isValidEmail(email) || !password || password.length < 6 || password !== confirmPassword || isLoading || !location}
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
