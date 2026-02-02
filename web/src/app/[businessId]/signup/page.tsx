'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Business, getBusinessByCode } from '@/lib/supabase';
import { preloadFaceModels } from '@/lib/faceDetection';
import SignUpEmployee from '@/components/SignUpEmployee';

export default function SignupPage() {
  const params = useParams();
  const router = useRouter();
  const businessId = (params.businessId as string)?.toUpperCase();
  
  const [business, setBusiness] = useState<Business | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Preload face models
    preloadFaceModels();

    const loadBusiness = async () => {
      if (!businessId) {
        setError('Invalid business ID');
        setIsLoading(false);
        return;
      }

      try {
        const biz = await getBusinessByCode(businessId);
        if (biz) {
          setBusiness(biz);
        } else {
          setError('Business not found');
        }
      } catch (err) {
        console.error('Failed to load business:', err);
        setError('Failed to load business');
      } finally {
        setIsLoading(false);
      }
    };

    loadBusiness();
  }, [businessId]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  if (error || !business) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur rounded-2xl p-8 text-center max-w-md">
          <div className="text-6xl mb-4">❌</div>
          <h1 className="text-2xl font-bold text-white mb-2">Business Not Found</h1>
          <p className="text-white/70 mb-6">
            The business ID &quot;{businessId}&quot; does not exist.
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 bg-white/20 hover:bg-white/30 text-white font-semibold rounded-xl transition-colors"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <SignUpEmployee
      business={business}
      onBack={() => router.push(`/${businessId}`)}
      onSuccess={() => router.push(`/${businessId}`)}
    />
  );
}
