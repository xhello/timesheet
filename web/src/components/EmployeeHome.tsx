'use client';

import { useState, useEffect } from 'react';
import { Business } from '@/lib/supabase';
import { areModelsLoaded, preloadAndWarmupWithProgress } from '@/lib/faceDetection';
import ClockInOut from './ClockInOut';
import SignUpEmployee from './SignUpEmployee';

interface Props {
  business: Business;
  onLogout: () => void;
}

type View = 'home' | 'clock' | 'signup';

export default function EmployeeHome({ business, onLogout }: Props) {
  const [currentView, setCurrentView] = useState<View>('home');
  const [modelsReady, setModelsReady] = useState(areModelsLoaded());
  const [loadProgress, setLoadProgress] = useState<number | null>(areModelsLoaded() ? 100 : 0);

  // Preload face detection library with progress (business page)
  useEffect(() => {
    if (areModelsLoaded()) {
      setModelsReady(true);
      setLoadProgress(100);
      return;
    }
    setLoadProgress(0);
    preloadAndWarmupWithProgress((percent) => {
      setLoadProgress(percent);
      if (percent === 100) setModelsReady(true);
    }).catch(() => setLoadProgress(null));
  }, []);

  if (currentView === 'clock') {
    return (
      <ClockInOut
        business={business}
        onBack={() => setCurrentView('home')}
      />
    );
  }

  if (currentView === 'signup') {
    return (
      <SignUpEmployee
        business={business}
        onBack={() => setCurrentView('home')}
        onSuccess={() => setCurrentView('home')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700 flex flex-col">
      {/* Header */}
      <div className="px-4 py-6 flex items-center justify-between">
        <button
          onClick={onLogout}
          className="text-white/70 hover:text-white transition-colors"
        >
          ← Logout
        </button>
        <div className="text-white/70 text-sm">
          ID: {business.business_code}
        </div>
      </div>

      {/* Business Info */}
      <div className="text-center py-8">
        <div className="text-6xl mb-4">🏢</div>
        <h1 className="text-3xl font-bold text-white mb-2">{business.name}</h1>
        <p className="text-white/70">Employee Portal</p>
      </div>

      {/* Loading / Camera Ready - above buttons */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-full max-w-md space-y-3 mb-2">
          {modelsReady ? (
            <div className="flex items-center justify-center gap-2 text-white/90 text-sm py-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span>Camera Ready</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-white/80 text-sm">
                <span>Loading face detection...</span>
                <span>{loadProgress ?? 0}%</span>
              </div>
              <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/60 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${loadProgress ?? 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons - disabled until camera ready */}
        <button
          onClick={() => modelsReady && setCurrentView('clock')}
          disabled={!modelsReady}
          className={`w-full max-w-md py-8 font-bold text-xl rounded-2xl shadow-lg transition-all flex flex-col items-center gap-2 ${
            modelsReady
              ? 'bg-green-500 hover:bg-green-600 text-white transform hover:scale-105 cursor-pointer'
              : 'bg-gray-400 text-gray-200 cursor-not-allowed opacity-75'
          }`}
        >
          <span className="text-4xl">⏱️</span>
          <span>Clock In / Out</span>
        </button>

        <button
          onClick={() => modelsReady && setCurrentView('signup')}
          disabled={!modelsReady}
          className={`w-full max-w-md py-8 font-bold text-xl rounded-2xl shadow-lg transition-all flex flex-col items-center gap-2 ${
            modelsReady
              ? 'bg-blue-500 hover:bg-blue-600 text-white transform hover:scale-105 cursor-pointer'
              : 'bg-gray-400 text-gray-200 cursor-not-allowed opacity-75'
          }`}
        >
          <span className="text-4xl">👤</span>
          <span>New Employee</span>
        </button>
      </div>
    </div>
  );
}
