'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Business,
  Employee,
  getEmployeesByBusiness,
  getEmployeeByEmail,
  getEmployeeByPhone,
  createEmployee,
} from '@/lib/supabase';
import {
  loadFaceModels,
  detectFace,
  findMatchingEmployee,
  descriptorToObject,
} from '@/lib/faceDetection';

interface Props {
  business: Business;
  onBack: () => void;
  onSuccess: () => void;
}

type Status = 'loading' | 'capturing' | 'confirming' | 'verified' | 'form' | 'error';

export default function SignUpEmployee({ business, onBack, onSuccess }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('Loading face detection...');
  const [capturedDescriptor, setCapturedDescriptor] = useState<Float32Array | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [existingEmployee, setExistingEmployee] = useState<Employee | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [confirmCountdown, setConfirmCountdown] = useState(3);
  const [canConfirm, setCanConfirm] = useState(false);

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    const init = async () => {
      try {
        setMessage('Loading face detection models...');
        await loadFaceModels();
        
        setMessage('Loading existing employees...');
        const emps = await getEmployeesByBusiness(business.id);
        setEmployees(emps);
        
        await startCamera();
        setStatus('capturing');
        setMessage('Position your face in the frame');
      } catch (error) {
        console.error('Init error:', error);
        setStatus('error');
        setMessage('Failed to initialize. Please refresh and try again.');
      }
    };

    init();

    return () => {
      stopCamera();
    };
  }, [business.id]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
      }
    } catch (error) {
      console.error('Camera error:', error);
      throw new Error('Camera access denied');
    }
  };

  const stopCamera = () => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const captureImageFromVideo = () => {
    if (!videoRef.current || !canvasRef.current) return null;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    // Mirror the image to match the video display
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const handleConfirm = () => {
    setStatus('verified');
    setMessage('Face confirmed! Fill in your details.');
    stopCamera();
    
    setTimeout(() => {
      setStatus('form');
    }, 1000);
  };

  const handleRetry = async () => {
    // Reset state
    setCapturedDescriptor(null);
    setCapturedImage(null);
    setConfirmCountdown(3);
    setCanConfirm(false);
    setExistingEmployee(null);
    setMessage('Position your face in the frame');
    
    // Restart camera
    try {
      await startCamera();
      setStatus('capturing');
    } catch (error) {
      console.error('Failed to restart camera:', error);
      setStatus('error');
      setMessage('Failed to restart camera. Please refresh.');
    }
  };

  const handleRecapture = async () => {
    // Reset all detection state
    setCapturedDescriptor(null);
    setCapturedImage(null);
    setConfirmCountdown(3);
    setCanConfirm(false);
    setExistingEmployee(null);
    setMessage('Position your face in the frame');
    
    // Stop current camera if running
    stopCamera();
    
    // Restart camera
    try {
      await startCamera();
      setStatus('capturing');
    } catch (error) {
      console.error('Failed to restart camera:', error);
      setStatus('error');
      setMessage('Failed to restart camera. Please refresh.');
    }
  };

  // Start face detection
  useEffect(() => {
    if (status !== 'capturing' || !videoRef.current) return;

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || capturedDescriptor) return;

      const result = await detectFace(videoRef.current);

      if (result.detected && result.descriptor && result.livenessScore >= 0.5) {
        // Check if face already exists
        const match = findMatchingEmployee(result.descriptor, employees);

        if (match) {
          const employee = employees.find(e => e.id === match.employeeId);
          if (employee) {
            setExistingEmployee(employee);
            setStatus('error');
            setMessage(`Face already registered to ${employee.first_name} ${employee.last_name}`);
            
            if (detectionIntervalRef.current) {
              clearInterval(detectionIntervalRef.current);
            }
            return;
          }
        }

        // Face detected and not existing - capture image and go to confirmation
        const imageData = captureImageFromVideo();
        if (imageData) {
          setCapturedImage(imageData);
          setCapturedDescriptor(result.descriptor);
          setStatus('confirming');
          setMessage('Is this you? Please confirm.');
          setConfirmCountdown(3);
          setCanConfirm(false);
          
          if (detectionIntervalRef.current) {
            clearInterval(detectionIntervalRef.current);
            detectionIntervalRef.current = null;
          }
        }
      } else {
        setMessage(result.message);
      }
    }, 500);

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
    };
  }, [status, employees, capturedDescriptor]);

  // Countdown timer for confirmation
  useEffect(() => {
    if (status !== 'confirming') return;

    if (confirmCountdown > 0) {
      const timer = setTimeout(() => {
        setConfirmCountdown(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCanConfirm(true);
    }
  }, [status, confirmCountdown]);

  const handleSubmit = async () => {
    if (!capturedDescriptor || !firstName.trim() || !lastName.trim()) return;

    setIsSubmitting(true);
    setFormError('');

    try {
      // Check for duplicate email
      if (email.trim()) {
        const existingByEmail = await getEmployeeByEmail(business.id, email);
        if (existingByEmail) {
          setFormError('Email address already exists');
          setIsSubmitting(false);
          return;
        }
      }

      // Check for duplicate phone
      if (phone.trim()) {
        const existingByPhone = await getEmployeeByPhone(business.id, phone);
        if (existingByPhone) {
          setFormError('Phone number already exists');
          setIsSubmitting(false);
          return;
        }
      }

      // Create employee
      await createEmployee({
        business_id: business.id,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim().toLowerCase() || null,
        phone: phone.trim() || null,
        date_of_birth: dob || null,
        face_encoding: descriptorToObject(capturedDescriptor),
      });

      setMessage('Employee registered successfully!');
      setTimeout(() => onSuccess(), 1500);
    } catch (error) {
      console.error('Create employee error:', error);
      setFormError('Failed to register. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'form') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <div className="bg-white border-b px-4 py-4 flex items-center">
          <button onClick={onBack} className="text-blue-600 font-semibold">
            ← Cancel
          </button>
          <h1 className="flex-1 text-center font-semibold">New Employee</h1>
          <div className="w-16" />
        </div>

        {/* Form */}
        <div className="flex-1 p-4 space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <span className="text-green-700">Face captured successfully!</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              First Name *
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Last Name *
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date of Birth
            </label>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {formError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-red-600 text-sm">⚠️ {formError}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!firstName.trim() || !lastName.trim() || isSubmitting}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <span>💾</span>
                <span>Save Employee</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Confirmation screen
  if (status === 'confirming' && capturedImage) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col">
        {/* Header */}
        <div className="px-4 py-4 flex items-center">
          <button onClick={handleRetry} className="text-white/70 hover:text-white">
            ← Back
          </button>
          <h1 className="flex-1 text-center text-white font-semibold">
            Confirm Photo
          </h1>
          <div className="w-12" />
        </div>

        {/* Captured Image */}
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <div className="relative w-full max-w-md aspect-[3/4] bg-black rounded-2xl overflow-hidden">
            <img
              src={capturedImage}
              alt="Captured face"
              className="w-full h-full object-cover"
            />

            {/* Face Guide Overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-64 border-4 rounded-full border-yellow-500" />
            </div>

            {/* Status Badge */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2">
              <div className="px-4 py-2 rounded-full text-white text-sm font-medium bg-yellow-500">
                {canConfirm ? 'Is this you?' : `Please wait... ${confirmCountdown}s`}
              </div>
            </div>
          </div>

          {/* Confirmation Buttons */}
          <div className="w-full max-w-md mt-6 space-y-3">
            <p className="text-white/70 text-center mb-4">
              Please confirm this is a clear photo of your face
            </p>
            
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="w-full py-4 bg-green-500 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold text-lg rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {canConfirm ? (
                <>
                  <span>✓</span>
                  <span>Yes, this is me</span>
                </>
              ) : (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Wait {confirmCountdown}s...</span>
                </>
              )}
            </button>

            <button
              onClick={handleRetry}
              className="w-full py-4 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <span>✗</span>
              <span>No, retake photo</span>
            </button>
          </div>
        </div>

        {/* Hidden canvas for capturing */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 flex items-center">
        <button onClick={onBack} className="text-white/70 hover:text-white">
          ← Back
        </button>
        <h1 className="flex-1 text-center text-white font-semibold">
          New Employee
        </h1>
        <div className="w-12" />
      </div>

      {/* Re-capture button - shown when face already registered */}
      {existingEmployee && (
        <div className="px-4 pb-4">
          <button
            onClick={handleRecapture}
            className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <span>🔄</span>
            <span>Try Again with Different Face</span>
          </button>
        </div>
      )}

      {/* Camera View */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="relative w-full max-w-md aspect-[3/4] bg-black rounded-2xl overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transform scale-x-[-1]"
          />

          {/* Face Guide Overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-48 h-64 border-4 rounded-full ${
              status === 'verified' 
                ? 'border-green-500' 
                : status === 'error' 
                  ? 'border-red-500' 
                  : 'border-white/50'
            }`} />
          </div>

          {/* Status Badge */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2">
            <div className={`px-4 py-2 rounded-full text-white text-sm font-medium ${
              status === 'verified' 
                ? 'bg-green-500' 
                : status === 'error' 
                  ? 'bg-red-500' 
                  : 'bg-blue-500'
            }`}>
              {message}
            </div>
          </div>
        </div>

        {existingEmployee && (
          <div className="w-full max-w-md mt-6">
            <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 text-center">
              <p className="text-red-400">
                This face is already registered to<br />
                <span className="font-bold text-white">
                  {existingEmployee.first_name} {existingEmployee.last_name}
                </span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Hidden canvas for capturing */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
