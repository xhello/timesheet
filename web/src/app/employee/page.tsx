'use client';

import { useEffect } from 'react';
import EmployeePortal from '@/components/EmployeePortal';
import { preloadAndWarmup } from '@/lib/faceDetection';

export default function EmployeePage() {
  // Preload face detection models AND warmup immediately
  useEffect(() => {
    preloadAndWarmup();
  }, []);

  return <EmployeePortal />;
}
