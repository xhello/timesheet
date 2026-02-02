'use client';

import { useState, useEffect } from 'react';
import BusinessLogin from '@/components/BusinessLogin';
import BusinessSignUp from '@/components/BusinessSignUp';
import ForgotBusinessID from '@/components/ForgotBusinessID';
import ForgotPassword from '@/components/ForgotPassword';
import EmployeeHome from '@/components/EmployeeHome';
import { Business } from '@/lib/supabase';
import { preloadFaceModels } from '@/lib/faceDetection';

type View = 'login' | 'signup' | 'forgot-id' | 'forgot-password' | 'employee-home';

export default function Home() {
  const [currentView, setCurrentView] = useState<View>('login');
  const [currentBusiness, setCurrentBusiness] = useState<Business | null>(null);

  // Preload face detection models in background when app starts
  useEffect(() => {
    preloadFaceModels();
  }, []);

  const handleLoginSuccess = (business: Business) => {
    setCurrentBusiness(business);
    setCurrentView('employee-home');
  };

  const handleLogout = () => {
    setCurrentBusiness(null);
    setCurrentView('login');
  };

  return (
    <main className="min-h-screen">
      {currentView === 'login' && (
        <BusinessLogin
          onLoginSuccess={handleLoginSuccess}
          onSignUpClick={() => setCurrentView('signup')}
          onForgotIdClick={() => setCurrentView('forgot-id')}
          onForgotPasswordClick={() => setCurrentView('forgot-password')}
        />
      )}
      
      {currentView === 'signup' && (
        <BusinessSignUp
          onBack={() => setCurrentView('login')}
          onSuccess={() => setCurrentView('login')}
        />
      )}
      
      {currentView === 'forgot-id' && (
        <ForgotBusinessID
          onBack={() => setCurrentView('login')}
        />
      )}

      {currentView === 'forgot-password' && (
        <ForgotPassword
          onBack={() => setCurrentView('login')}
        />
      )}
      
      {currentView === 'employee-home' && currentBusiness && (
        <EmployeeHome
          business={currentBusiness}
          onLogout={handleLogout}
        />
      )}
    </main>
  );
}
