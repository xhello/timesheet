'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Employee,
  TimeEntry,
  Business,
  getAllEmployees,
  getTimeEntriesByEmployee,
  getBusinessById,
  getActiveTimeEntry,
  createTimeEntry,
  updateTimeEntry,
} from '@/lib/supabase';
import {
  loadFaceModels,
  detectFace,
  findMatchingEmployee,
  ConsecutiveMatchTracker,
  REQUIRED_CONSECUTIVE_MATCHES,
  MIN_LIVENESS_SCORE,
} from '@/lib/faceDetection';

type View = 'auth' | 'dashboard';
type AuthStatus = 'loading' | 'ready' | 'detecting' | 'verified' | 'error';

export default function EmployeePortal() {
  const [view, setView] = useState<View>('auth');
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [hasActiveEntry, setHasActiveEntry] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleAuthSuccess = async (emp: Employee) => {
    setEmployee(emp);
    setIsLoading(true);
    
    try {
      // Load business info
      const biz = await getBusinessById(emp.business_id);
      setBusiness(biz);
      
      // Load time entries
      const entries = await getTimeEntriesByEmployee(emp.id);
      setTimeEntries(entries);
      
      // Check active entry
      const active = await getActiveTimeEntry(emp.id);
      setHasActiveEntry(!!active);
      
      setView('dashboard');
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    setEmployee(null);
    setBusiness(null);
    setTimeEntries([]);
    setHasActiveEntry(false);
    setView('auth');
  };

  const handleClockAction = async (action: 'in' | 'out') => {
    if (!employee || !business) return;
    
    setIsLoading(true);
    try {
      if (action === 'in') {
        await createTimeEntry({
          employee_id: employee.id,
          business_id: business.id,
          clock_in_time: new Date().toISOString(),
          status: 'active',
          clock_in_liveness_verified: true,
          clock_in_liveness_score: 0.9,
        });
        setHasActiveEntry(true);
      } else {
        const activeEntry = await getActiveTimeEntry(employee.id);
        if (activeEntry) {
          await updateTimeEntry(activeEntry.id, {
            clock_out_time: new Date().toISOString(),
            status: 'completed',
            clock_out_liveness_verified: true,
            clock_out_liveness_score: 0.9,
          });
          setHasActiveEntry(false);
        }
      }
      
      // Refresh time entries
      const entries = await getTimeEntriesByEmployee(employee.id);
      setTimeEntries(entries);
    } catch (error) {
      console.error('Clock action failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (view === 'auth') {
    return <FaceAuth onSuccess={handleAuthSuccess} />;
  }

  return (
    <EmployeeDashboard
      employee={employee!}
      business={business}
      timeEntries={timeEntries}
      hasActiveEntry={hasActiveEntry}
      isLoading={isLoading}
      onClockAction={handleClockAction}
      onLogout={handleLogout}
    />
  );
}

// Face Authentication Component
function FaceAuth({ onSuccess }: { onSuccess: (employee: Employee) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const matchTrackerRef = useRef<ConsecutiveMatchTracker>(new ConsecutiveMatchTracker());
  const employeesRef = useRef<Employee[]>([]);

  const [status, setStatus] = useState<AuthStatus>('loading');
  const [message, setMessage] = useState('Loading...');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [matchStreak, setMatchStreak] = useState(0);

  useEffect(() => {
    employeesRef.current = employees;
  }, [employees]);

  // Initialize
  useEffect(() => {
    let mounted = true;
    
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: 640, height: 480 },
        });
        
        if (videoRef.current && mounted) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
        }
      } catch (error) {
        console.error('Camera error:', error);
        throw new Error('Camera access denied');
      }
    };

    const init = async () => {
      try {
        setMessage('Loading face detection models...');
        await loadFaceModels();
        
        setMessage('Loading employee database...');
        const emps = await getAllEmployees();
        if (!mounted) return;
        setEmployees(emps);
        
        if (emps.length === 0) {
          setStatus('error');
          setMessage('No employees registered in the system.');
          return;
        }
        
        await startCamera();
        if (!mounted) return;
        setStatus('ready');
        setMessage('Position your face to authenticate');
      } catch (error) {
        console.error('Init error:', error);
        if (!mounted) return;
        setStatus('error');
        setMessage('Failed to initialize. Please refresh.');
      }
    };

    init();

    return () => {
      mounted = false;
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Transition from ready to detecting
  useEffect(() => {
    if (status === 'ready') {
      const timer = setTimeout(() => {
        setStatus('detecting');
        setMessage('Looking for your face...');
        matchTrackerRef.current.reset();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [status]);

  // Face detection
  useEffect(() => {
    if (status !== 'detecting' || !videoRef.current) return;

    if (detectionIntervalRef.current) return;

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current) return;

      const currentEmployees = employeesRef.current;
      if (currentEmployees.length === 0) return;

      const result = await detectFace(videoRef.current);

      if (result.detected && result.descriptor && result.livenessScore >= MIN_LIVENESS_SCORE) {
        const match = findMatchingEmployee(result.descriptor, currentEmployees);

        if (match) {
          const trackResult = matchTrackerRef.current.addMatch(match.employeeId);
          setMatchStreak(trackResult.streak);

          const emp = currentEmployees.find(e => e.id === match.employeeId);

          if (trackResult.confirmed && emp) {
            setStatus('verified');
            setMessage(`Welcome, ${emp.first_name}!`);
            
            // Stop detection
            if (detectionIntervalRef.current) {
              clearInterval(detectionIntervalRef.current);
              detectionIntervalRef.current = null;
            }
            if (streamRef.current) {
              streamRef.current.getTracks().forEach(track => track.stop());
              streamRef.current = null;
            }
            
            setTimeout(() => {
              onSuccess(emp);
            }, 1000);
          } else if (emp) {
            setMessage(`Verifying ${emp.first_name}... (${trackResult.streak}/${REQUIRED_CONSECUTIVE_MATCHES})`);
          }
        } else {
          matchTrackerRef.current.addMatch(null);
          setMatchStreak(0);
          setMessage('Face not recognized. Please try again.');
        }
      } else {
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
  }, [status, onSuccess]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 to-purple-900 flex flex-col">
      {/* Header */}
      <div className="px-4 py-6 text-center">
        <h1 className="text-3xl font-bold text-white mb-2">Employee Portal</h1>
        <p className="text-white/70">Authenticate with your face to access your timesheet</p>
      </div>

      {/* Camera View */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className="relative w-full max-w-md aspect-[3/4] bg-black rounded-2xl overflow-hidden shadow-2xl">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover transform scale-x-[-1]"
          />

          {/* Face Guide */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className={`w-48 h-64 border-4 rounded-full transition-colors ${
              status === 'verified' 
                ? 'border-green-500' 
                : matchStreak > 0 
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
                  : 'bg-indigo-500'
            }`}>
              {message}
            </div>
          </div>

          {/* Progress Indicator */}
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

        {status === 'error' && (
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// Employee Dashboard Component
function EmployeeDashboard({
  employee,
  business,
  timeEntries,
  hasActiveEntry,
  isLoading,
  onClockAction,
  onLogout,
}: {
  employee: Employee;
  business: Business | null;
  timeEntries: TimeEntry[];
  hasActiveEntry: boolean;
  isLoading: boolean;
  onClockAction: (action: 'in' | 'out') => void;
  onLogout: () => void;
}) {
  // Calculate total hours this week
  const getWeeklyHours = () => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    let totalMinutes = 0;
    timeEntries.forEach(entry => {
      const clockIn = new Date(entry.clock_in_time);
      if (clockIn >= startOfWeek) {
        const clockOut = entry.clock_out_time ? new Date(entry.clock_out_time) : new Date();
        totalMinutes += (clockOut.getTime() - clockIn.getTime()) / (1000 * 60);
      }
    });

    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    return `${hours}h ${minutes}m`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const calculateDuration = (clockIn: string, clockOut: string | null) => {
    const start = new Date(clockIn);
    const end = clockOut ? new Date(clockOut) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.round((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{employee.full_name}</h1>
              <p className="text-white/80">{business?.name || 'Employee'}</p>
            </div>
            <button
              onClick={onLogout}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-gray-500 text-sm">This Week</p>
            <p className="text-3xl font-bold text-gray-900">{getWeeklyHours()}</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-gray-500 text-sm">Status</p>
            <p className={`text-xl font-bold ${hasActiveEntry ? 'text-green-600' : 'text-gray-400'}`}>
              {hasActiveEntry ? 'Clocked In' : 'Clocked Out'}
            </p>
          </div>
        </div>

        {/* Clock In/Out Button */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          {hasActiveEntry ? (
            <button
              onClick={() => onClockAction('out')}
              disabled={isLoading}
              className="w-full py-4 bg-red-500 hover:bg-red-600 disabled:bg-gray-400 text-white font-bold text-xl rounded-xl transition-colors flex items-center justify-center gap-3"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span className="text-2xl">🕐</span>
                  <span>Clock Out</span>
                </>
              )}
            </button>
          ) : (
            <button
              onClick={() => onClockAction('in')}
              disabled={isLoading}
              className="w-full py-4 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-bold text-xl rounded-xl transition-colors flex items-center justify-center gap-3"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span className="text-2xl">⏱️</span>
                  <span>Clock In</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Time Entries */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Recent Time Entries</h2>
          </div>
          
          {timeEntries.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              <p>No time entries yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {timeEntries.map((entry) => (
                <div key={entry.id} className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{formatDate(entry.clock_in_time)}</p>
                    <p className="text-sm text-gray-500">
                      {formatTime(entry.clock_in_time)} - {entry.clock_out_time ? formatTime(entry.clock_out_time) : 'In Progress'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${entry.clock_out_time ? 'text-gray-900' : 'text-green-600'}`}>
                      {calculateDuration(entry.clock_in_time, entry.clock_out_time)}
                    </p>
                    <p className={`text-xs px-2 py-1 rounded-full ${
                      entry.status === 'active' 
                        ? 'bg-green-100 text-green-700' 
                        : entry.status === 'completed'
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {entry.status}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
