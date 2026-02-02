'use client';

import { useState, useEffect } from 'react';
import { Business } from '@/lib/supabase';
import { preloadFaceModels, areModelsLoaded } from '@/lib/faceDetection';
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

  // Preload face models as soon as user reaches employee home
  useEffect(() => {
    preloadFaceModels();
    
    // Check if models are loaded periodically
    const checkModels = setInterval(() => {
      if (areModelsLoaded()) {
        setModelsReady(true);
        clearInterval(checkModels);
      }
    }, 500);

    return () => clearInterval(checkModels);
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

      {/* Action Buttons */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
        <button
          onClick={() => setCurrentView('clock')}
          className="w-full max-w-md py-8 bg-green-500 hover:bg-green-600 text-white font-bold text-xl rounded-2xl shadow-lg transition-all transform hover:scale-105 flex flex-col items-center gap-2"
        >
          <span className="text-4xl">⏱️</span>
          <span>Clock In / Out</span>
        </button>

        <button
          onClick={() => setCurrentView('signup')}
          className="w-full max-w-md py-8 bg-blue-500 hover:bg-blue-600 text-white font-bold text-xl rounded-2xl shadow-lg transition-all transform hover:scale-105 flex flex-col items-center gap-2"
        >
          <span className="text-4xl">👤</span>
          <span>New Employee</span>
        </button>
      </div>

      {/* Footer */}
      <div className="py-6 text-center">
        <div className="flex items-center justify-center gap-2 text-white/50 text-sm">
          {modelsReady ? (
            <>
              <div className="w-2 h-2 bg-green-400 rounded-full" />
              <span>Camera Ready</span>
            </>
          ) : (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>Loading camera...</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
