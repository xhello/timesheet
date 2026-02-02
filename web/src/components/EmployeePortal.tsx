'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Employee,
  TimeEntry,
  TimeChangeRequest,
  Business,
  getAllEmployees,
  getTimeEntriesByEmployee,
  getBusinessById,
  createTimeChangeRequest,
  getTimeChangeRequestsByEmployee,
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
  const [changeRequests, setChangeRequests] = useState<TimeChangeRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleAuthSuccess = async (emp: Employee) => {
    setEmployee(emp);
    setIsLoading(true);
    
    try {
      // Load business info
      const biz = await getBusinessById(emp.business_id);
      setBusiness(biz);
      
      // Load time entries (get more for date range filtering)
      const entries = await getTimeEntriesByEmployee(emp.id, 500);
      setTimeEntries(entries);

      // Load change requests
      const requests = await getTimeChangeRequestsByEmployee(emp.id);
      setChangeRequests(requests);
      
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
    setChangeRequests([]);
    setView('auth');
  };

  if (view === 'auth') {
    return <FaceAuth onSuccess={handleAuthSuccess} />;
  }

  return (
    <EmployeeDashboard
      employee={employee!}
      business={business}
      timeEntries={timeEntries}
      changeRequests={changeRequests}
      isLoading={isLoading}
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
  changeRequests,
  isLoading,
  onLogout,
}: {
  employee: Employee;
  business: Business | null;
  timeEntries: TimeEntry[];
  changeRequests: TimeChangeRequest[];
  isLoading: boolean;
  onLogout: () => void;
}) {
  // Date range state - default to current month
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  
  const [startDate, setStartDate] = useState(firstDayOfMonth.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);

  // Notification state
  const [showNotifications, setShowNotifications] = useState(false);
  const pendingCount = changeRequests.filter(r => r.status === 'pending').length;

  // Edit modal state
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editReason, setEditReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const openEditModal = (entry: TimeEntry) => {
    setEditingEntry(entry);
    // Format datetime for input
    const clockInDate = new Date(entry.clock_in_time);
    setEditClockIn(clockInDate.toISOString().slice(0, 16));
    if (entry.clock_out_time) {
      const clockOutDate = new Date(entry.clock_out_time);
      setEditClockOut(clockOutDate.toISOString().slice(0, 16));
    } else {
      setEditClockOut('');
    }
    setEditReason('');
    setSubmitSuccess(false);
  };

  const closeEditModal = () => {
    setEditingEntry(null);
    setEditClockIn('');
    setEditClockOut('');
    setEditReason('');
    setSubmitSuccess(false);
  };

  const handleSubmitChangeRequest = async () => {
    if (!editingEntry || !business || !editReason.trim()) return;
    
    setIsSubmitting(true);
    try {
      await createTimeChangeRequest({
        time_entry_id: editingEntry.id,
        employee_id: employee.id,
        business_id: business.id,
        original_clock_in: editingEntry.clock_in_time,
        original_clock_out: editingEntry.clock_out_time,
        requested_clock_in: new Date(editClockIn).toISOString(),
        requested_clock_out: editClockOut ? new Date(editClockOut).toISOString() : null,
        reason: editReason.trim(),
        status: 'pending',
      });
      setSubmitSuccess(true);
      setTimeout(() => {
        closeEditModal();
      }, 2000);
    } catch (error) {
      console.error('Failed to submit change request:', error);
      alert('Failed to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter entries by date range
  const filteredEntries = timeEntries.filter(entry => {
    const entryDate = new Date(entry.clock_in_time);
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include the entire end day
    return entryDate >= start && entryDate <= end;
  });

  // Calculate total hours in date range
  const calculateTotalHours = () => {
    let totalMinutes = 0;
    filteredEntries.forEach(entry => {
      if (entry.clock_out_time) {
        const clockIn = new Date(entry.clock_in_time);
        const clockOut = new Date(entry.clock_out_time);
        totalMinutes += (clockOut.getTime() - clockIn.getTime()) / (1000 * 60);
      }
    });

    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    return { hours, minutes, totalMinutes };
  };

  const totalTime = calculateTotalHours();

  // Quick date range presets
  const setDatePreset = (preset: 'today' | 'week' | 'month' | 'last-month') => {
    const now = new Date();
    let start: Date;
    let end: Date = now;

    switch (preset) {
      case 'today':
        start = now;
        break;
      case 'week':
        start = new Date(now);
        start.setDate(now.getDate() - now.getDay());
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last-month':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
    }

    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
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
    if (!clockOut) return 'In Progress';
    const start = new Date(clockIn);
    const end = new Date(clockOut);
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
            <div className="flex items-center gap-3">
              {/* Notification Bell */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="relative p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {(changeRequests.length > 0) && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                      {changeRequests.length}
                    </span>
                  )}
                </button>

                {/* Notification Dropdown */}
                {showNotifications && (
                  <div className="absolute right-0 top-12 w-80 bg-white rounded-xl shadow-xl z-50 overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <h3 className="font-semibold text-gray-900">Change Requests</h3>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {changeRequests.length === 0 ? (
                        <div className="p-6 text-center text-gray-500">
                          <p>No change requests</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {changeRequests.map((request) => (
                            <div key={request.id} className="p-4 hover:bg-gray-50">
                              <div className="flex items-start justify-between mb-1">
                                <p className="text-sm font-medium text-gray-900">
                                  {new Date(request.requested_clock_in).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </p>
                                <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${
                                  request.status === 'pending'
                                    ? 'bg-yellow-100 text-yellow-700'
                                    : request.status === 'approved'
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-red-100 text-red-700'
                                }`}>
                                  {request.status === 'pending' ? 'Pending' : request.status === 'approved' ? 'Approved' : 'Declined'}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mb-1">
                                {new Date(request.requested_clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} - {request.requested_clock_out ? new Date(request.requested_clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                              </p>
                              <p className="text-xs text-gray-400 line-clamp-1">{request.reason}</p>
                              {request.reviewed_at && (
                                <p className="text-xs text-gray-400 mt-1">
                                  Reviewed {new Date(request.reviewed_at).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {pendingCount > 0 && (
                      <div className="px-4 py-2 bg-yellow-50 border-t border-yellow-100">
                        <p className="text-xs text-yellow-700">{pendingCount} request{pendingCount > 1 ? 's' : ''} pending review</p>
                      </div>
                    )}
                  </div>
                )}
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
      </div>

      {/* Click outside to close notifications */}
      {showNotifications && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setShowNotifications(false)}
        />
      )}

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Date Range Picker */}
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Date Range</h2>
          
          {/* Quick Presets */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setDatePreset('today')}
              className="px-3 py-1.5 text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => setDatePreset('week')}
              className="px-3 py-1.5 text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors"
            >
              This Week
            </button>
            <button
              onClick={() => setDatePreset('month')}
              className="px-3 py-1.5 text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors"
            >
              This Month
            </button>
            <button
              onClick={() => setDatePreset('last-month')}
              className="px-3 py-1.5 text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors"
            >
              Last Month
            </button>
          </div>

          {/* Date Inputs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Total Hours Summary */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-6 shadow-lg text-white">
          <div className="text-center">
            <p className="text-white/80 text-sm mb-2">Total Hours Worked</p>
            <p className="text-5xl font-bold mb-2">
              {totalTime.hours}<span className="text-3xl">h</span> {totalTime.minutes}<span className="text-3xl">m</span>
            </p>
            <p className="text-white/60 text-sm">
              {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'} found
            </p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-gray-500 text-xs mb-1">Total Days</p>
            <p className="text-2xl font-bold text-gray-900">
              {new Set(filteredEntries.map(e => new Date(e.clock_in_time).toDateString())).size}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-gray-500 text-xs mb-1">Avg per Day</p>
            <p className="text-2xl font-bold text-gray-900">
              {(() => {
                const days = new Set(filteredEntries.map(e => new Date(e.clock_in_time).toDateString())).size;
                if (days === 0) return '0h';
                const avgMinutes = totalTime.totalMinutes / days;
                const h = Math.floor(avgMinutes / 60);
                const m = Math.round(avgMinutes % 60);
                return `${h}h ${m}m`;
              })()}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm text-center">
            <p className="text-gray-500 text-xs mb-1">Entries</p>
            <p className="text-2xl font-bold text-gray-900">{filteredEntries.length}</p>
          </div>
        </div>

        {/* Time Entries List */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Time Entries</h2>
          </div>
          
          {isLoading ? (
            <div className="px-6 py-12 text-center">
              <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              <p className="text-4xl mb-2">📅</p>
              <p>No time entries in this date range</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {filteredEntries.map((entry) => (
                <div key={entry.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{formatDate(entry.clock_in_time)}</p>
                    <p className="text-sm text-gray-500">
                      {formatTime(entry.clock_in_time)} - {entry.clock_out_time ? formatTime(entry.clock_out_time) : 'In Progress'}
                    </p>
                  </div>
                  <div className="text-right mr-4">
                    <p className={`font-semibold ${entry.clock_out_time ? 'text-gray-900' : 'text-green-600'}`}>
                      {calculateDuration(entry.clock_in_time, entry.clock_out_time)}
                    </p>
                    <p className={`text-xs px-2 py-1 rounded-full inline-block ${
                      entry.status === 'active' 
                        ? 'bg-green-100 text-green-700' 
                        : entry.status === 'completed'
                          ? 'bg-gray-100 text-gray-600'
                          : entry.status === 'edited'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {entry.status}
                    </p>
                  </div>
                  <button
                    onClick={() => openEditModal(entry)}
                    className="px-3 py-1.5 text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors"
                  >
                    Request Change
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingEntry && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            {submitSuccess ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">✓</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Request Submitted!</h3>
                <p className="text-gray-600">Your time change request has been sent to admin for review.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-gray-900">Request Time Change</h3>
                  <button
                    onClick={closeEditModal}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500 mb-1">Original Time</p>
                    <p className="text-sm font-medium text-gray-700">
                      {formatDate(editingEntry.clock_in_time)}: {formatTime(editingEntry.clock_in_time)} - {editingEntry.clock_out_time ? formatTime(editingEntry.clock_out_time) : 'In Progress'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Clock In</label>
                    <input
                      type="datetime-local"
                      value={editClockIn}
                      onChange={(e) => setEditClockIn(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">New Clock Out</label>
                    <input
                      type="datetime-local"
                      value={editClockOut}
                      onChange={(e) => setEditClockOut(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Change *</label>
                    <textarea
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      placeholder="Please explain why you need this time change..."
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={closeEditModal}
                      className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSubmitChangeRequest}
                      disabled={!editReason.trim() || isSubmitting}
                      className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        'Submit Request'
                      )}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
