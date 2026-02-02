'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Business,
  Employee,
  getEmployeesByBusiness,
  getActiveTimeEntry,
  createTimeEntry,
  updateTimeEntry,
  calculateDistance,
} from '@/lib/supabase';
import {
  loadFaceModels,
  detectFace,
  findMatchingEmployee,
  ConsecutiveMatchTracker,
  REQUIRED_CONSECUTIVE_MATCHES,
  MIN_LIVENESS_SCORE,
} from '@/lib/faceDetection';

interface Props {
  business: Business;
  onBack: () => void;
}

type Status = 'loading' | 'ready' | 'detecting' | 'verified' | 'error';

const MAX_DISTANCE_METERS = 500; // Maximum distance allowed for clock in/out (in meters)
const MAX_DISTANCE_MILES = MAX_DISTANCE_METERS / 1609.34; // Convert to miles for calculation

export default function ClockInOut({ business, onBack }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const employeesRef = useRef<Employee[]>([]);
  const matchTrackerRef = useRef<ConsecutiveMatchTracker>(new ConsecutiveMatchTracker());

  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('Loading face detection...');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [matchedEmployee, setMatchedEmployee] = useState<Employee | null>(null);
  const [hasActiveEntry, setHasActiveEntry] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [matchStreak, setMatchStreak] = useState(0);
  
  // Location state
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState('');
  const [isWithinRange, setIsWithinRange] = useState(false);
  const [distanceFromBusiness, setDistanceFromBusiness] = useState<number | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  // Get user location and check if within range
  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation not supported');
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const userLat = position.coords.latitude;
        const userLon = position.coords.longitude;
        setUserLocation({ latitude: userLat, longitude: userLon });

        // Check distance from business
        if (business.latitude && business.longitude) {
          const distance = calculateDistance(
            userLat,
            userLon,
            business.latitude,
            business.longitude
          );
          setDistanceFromBusiness(distance);
          setIsWithinRange(distance <= MAX_DISTANCE_MILES);
          
          if (distance > MAX_DISTANCE_MILES) {
            const distanceMeters = Math.round(distance * 1609.34);
            setLocationError(`You are ${distanceMeters}m away. Must be within ${MAX_DISTANCE_METERS}m.`);
          } else {
            setLocationError('');
          }
        } else {
          // Business has no location set - allow clock in/out
          setIsWithinRange(true);
          setLocationError('');
        }
      },
      (err) => {
        console.error('Location error:', err);
        setLocationError('Unable to get location. Please enable location services.');
        setIsWithinRange(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [business.latitude, business.longitude]);

  // Load employees and face models
  useEffect(() => {
    const init = async () => {
      try {
        // Start camera and load employees in parallel with models
        const cameraPromise = startCamera();
        const employeesPromise = getEmployeesByBusiness(business.id);
        
        setMessage('Initializing camera...');
        
        // Load models (will be instant if already preloaded)
        await loadFaceModels();
        
        // Wait for camera and employees
        const [, emps] = await Promise.all([cameraPromise, employeesPromise]);
        setEmployees(emps);
        
        setStatus('ready');
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

  const handleRecapture = async () => {
    // Reset matched employee state
    setMatchedEmployee(null);
    setHasActiveEntry(false);
    setMatchStreak(0);
    matchTrackerRef.current.reset();
    setMessage('Position your face in the frame');
    
    // Restart detection
    setStatus('ready');
  };

  // Start face detection when ready
  useEffect(() => {
    // Allow both 'ready' and 'detecting' states
    if ((status !== 'ready' && status !== 'detecting') || !videoRef.current) return;
    if (matchedEmployee) return; // Already matched

    // Only set to detecting on first run
    if (status === 'ready') {
      setStatus('detecting');
      setMessage('Looking for your face...');
      matchTrackerRef.current.reset();
    }

    // Don't create a new interval if one already exists
    if (detectionIntervalRef.current) return;

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current) return;

      const currentEmployees = employeesRef.current;
      if (currentEmployees.length === 0) {
        setMessage('Loading employees...');
        return;
      }

      const result = await detectFace(videoRef.current);

      if (result.detected && result.descriptor && result.livenessScore >= MIN_LIVENESS_SCORE) {
        // Try to match face with employees
        const match = findMatchingEmployee(result.descriptor, currentEmployees);

        if (match) {
          // Track consecutive matches for improved accuracy
          const trackResult = matchTrackerRef.current.addMatch(match.employeeId);
          setMatchStreak(trackResult.streak);

          if (trackResult.confirmed) {
            // Confirmed match after multiple consecutive detections
            const employee = currentEmployees.find(e => e.id === match.employeeId);
            if (employee) {
              setMatchedEmployee(employee);
              setStatus('verified');
              setMessage(`Welcome, ${employee.first_name}!`);

              // Check if they have an active time entry
              const activeEntry = await getActiveTimeEntry(employee.id);
              setHasActiveEntry(!!activeEntry);

              // Stop detection
              if (detectionIntervalRef.current) {
                clearInterval(detectionIntervalRef.current);
                detectionIntervalRef.current = null;
              }
            }
          } else {
            // Show progress towards confirmation
            const employee = currentEmployees.find(e => e.id === match.employeeId);
            if (employee) {
              setMessage(`Verifying ${employee.first_name}... (${trackResult.streak}/${REQUIRED_CONSECUTIVE_MATCHES})`);
            }
          }
        } else {
          // No match - reset tracker
          matchTrackerRef.current.addMatch(null);
          setMatchStreak(0);
          setMessage('Face not recognized. Please sign up first.');
        }
      } else {
        // Face not detected properly - reset tracker
        matchTrackerRef.current.addMatch(null);
        setMatchStreak(0);
        setMessage(result.message);
      }
    }, 500);

    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
    };
  }, [status, matchedEmployee]);

  const handleClockIn = async () => {
    if (!matchedEmployee || isProcessing) return;
    
    if (!isWithinRange) {
      setMessage(`You must be within ${MAX_DISTANCE_METERS}m of the business to clock in.`);
      return;
    }

    setIsProcessing(true);
    try {
      await createTimeEntry({
        employee_id: matchedEmployee.id,
        business_id: business.id,
        clock_in_time: new Date().toISOString(),
        status: 'active',
        clock_in_liveness_verified: true,
        clock_in_liveness_score: 0.9,
        clock_in_latitude: userLocation?.latitude,
        clock_in_longitude: userLocation?.longitude,
      });

      setMessage('Clocked in successfully!');
      setTimeout(() => onBack(), 2000);
    } catch (error) {
      console.error('Clock in error:', error);
      setMessage('Failed to clock in. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClockOut = async () => {
    if (!matchedEmployee || isProcessing) return;
    
    if (!isWithinRange) {
      setMessage(`You must be within ${MAX_DISTANCE_METERS}m of the business to clock out.`);
      return;
    }

    setIsProcessing(true);
    try {
      const activeEntry = await getActiveTimeEntry(matchedEmployee.id);
      
      if (activeEntry) {
        await updateTimeEntry(activeEntry.id, {
          clock_out_time: new Date().toISOString(),
          status: 'completed',
          clock_out_liveness_verified: true,
          clock_out_liveness_score: 0.9,
          clock_out_latitude: userLocation?.latitude,
          clock_out_longitude: userLocation?.longitude,
        });

        setMessage('Clocked out successfully!');
        setTimeout(() => onBack(), 2000);
      }
    } catch (error) {
      console.error('Clock out error:', error);
      setMessage('Failed to clock out. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 flex items-center border-b border-white/10">
        <button onClick={onBack} className="text-white/70 hover:text-white">
          ← Back
        </button>
        <h1 className="flex-1 text-center text-white font-semibold text-xl">
          Clock In / Out
        </h1>
        <div className="w-12" />
      </div>

      {/* Main Content - Side by Side Layout */}
      <div className="flex-1 flex flex-col lg:flex-row p-4 gap-6">
        {/* Left Side - Camera View */}
        <div className="flex-1 flex items-center justify-center">
          <div className="relative w-full max-w-lg aspect-[3/4] bg-black rounded-2xl overflow-hidden">
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
                  : status === 'detecting' 
                    ? 'border-yellow-500' 
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

            {/* Match Progress Indicator */}
            {status === 'detecting' && matchStreak > 0 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <div className="flex gap-2">
                  {Array.from({ length: REQUIRED_CONSECUTIVE_MATCHES }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full transition-colors ${
                        i < matchStreak ? 'bg-green-500' : 'bg-white/30'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Side - Employee Info & Action Buttons */}
        <div className="lg:w-80 flex flex-col justify-center">
          {matchedEmployee ? (
            <div className="space-y-6">
              {/* Employee Info */}
              <div className="bg-white/5 rounded-2xl p-6 text-center">
                <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-4xl">👤</span>
                </div>
                <p className="text-2xl font-bold text-white">{matchedEmployee.full_name}</p>
                <p className="text-white/60">{matchedEmployee.email}</p>
              </div>

              {/* Location Status */}
              <div className={`rounded-xl p-4 ${
                isWithinRange 
                  ? 'bg-green-500/20 border border-green-500/30' 
                  : 'bg-red-500/20 border border-red-500/30'
              }`}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{isWithinRange ? '📍' : '⚠️'}</span>
                  <div>
                    {isWithinRange ? (
                      <>
                        <p className="text-green-400 font-medium">Location verified</p>
                        {distanceFromBusiness !== null && (
                          <p className="text-green-400/70 text-sm">
                            {distanceFromBusiness < 0.1 
                              ? 'You are at the business location' 
                              : `${Math.round(distanceFromBusiness * 1609.34)}m away`}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-red-400 font-medium">Out of range</p>
                        <p className="text-red-400/70 text-sm">{locationError}</p>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Re-capture Button */}
              <button
                onClick={handleRecapture}
                className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <span>🔄</span>
                <span>Not you? Re-capture</span>
              </button>

              {/* Clock In/Out Button */}
              {hasActiveEntry ? (
                <button
                  onClick={handleClockOut}
                  disabled={isProcessing || !isWithinRange}
                  className="w-full py-5 bg-red-500 hover:bg-red-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold text-xl rounded-xl transition-colors flex items-center justify-center gap-3"
                >
                  {isProcessing ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className="text-2xl">🕐</span>
                      <span>{isWithinRange ? 'Clock Out' : 'Out of Range'}</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleClockIn}
                  disabled={isProcessing || !isWithinRange}
                  className="w-full py-5 bg-green-500 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold text-xl rounded-xl transition-colors flex items-center justify-center gap-3"
                >
                  {isProcessing ? (
                    <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className="text-2xl">⏱️</span>
                      <span>{isWithinRange ? 'Clock In' : 'Out of Range'}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          ) : (
            <div className="text-center text-white/60 bg-white/5 rounded-2xl p-8">
              <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">👁️</span>
              </div>
              <p className="text-lg font-medium text-white mb-2">Looking for your face...</p>
              <p className="text-sm">Position your face in the frame to clock in or out</p>
            </div>
          )}
        </div>
      </div>

      {status === 'detecting' && !matchedEmployee && (
        <p className="text-white/60 text-center pb-4">
          Face not recognized. Please sign up first if you&apos;re a new employee.
        </p>
      )}
    </div>
  );
}
