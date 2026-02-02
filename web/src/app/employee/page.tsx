'use client';

import { useEffect } from 'react';
import EmployeePortal from '@/components/EmployeePortal';
import { preloadFaceModels } from '@/lib/faceDetection';

export default function EmployeePage() {
  // Preload face detection models immediately
  useEffect(() => {
    preloadFaceModels();
  }, []);

  return <EmployeePortal />;
}
