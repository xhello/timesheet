'use client';

import { useState, useEffect } from 'react';
import {
  Business,
  Employee,
  TimeEntry,
  TimeChangeRequest,
  getBusinessByCode,
  verifyPassword,
  getPendingTimeChangeRequests,
  getTimeChangeRequestsByBusiness,
  getEmployeeById,
  getEmployeesByBusiness,
  getTimeEntriesByEmployee,
  getRecentTimeEntriesByBusiness,
  approveTimeChangeRequest,
  declineTimeChangeRequest,
} from '@/lib/supabase';

type View = 'login' | 'dashboard';

export default function AdminPage() {
  const [view, setView] = useState<View>('login');
  const [business, setBusiness] = useState<Business | null>(null);

  const handleLogin = (biz: Business) => {
    setBusiness(biz);
    setView('dashboard');
  };

  const handleLogout = () => {
    setBusiness(null);
    setView('login');
  };

  if (view === 'login') {
    return <AdminLogin onLogin={handleLogin} />;
  }

  return <AdminDashboard business={business!} onLogout={handleLogout} />;
}

// Admin Login Component
function AdminLogin({ onLogin }: { onLogin: (business: Business) => void }) {
  const [businessCode, setBusinessCode] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessCode.trim() || !password) return;

    setIsLoading(true);
    setError('');

    try {
      const business = await getBusinessByCode(businessCode);
      if (!business) {
        setError('Business ID not found.');
        return;
      }

      // Verify password
      if (!business.password_hash) {
        // Legacy business without password
        onLogin(business);
        return;
      }

      const isValid = await verifyPassword(password, business.password_hash);
      if (isValid) {
        onLogin(business);
      } else {
        setError('Invalid password.');
      }
    } catch (err) {
      setError('Failed to connect. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🔐</div>
          <h1 className="text-3xl font-bold text-white mb-2">Admin Portal</h1>
          <p className="text-slate-400">Enter your Business ID and password to manage time change requests</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white/10 backdrop-blur rounded-2xl p-8 space-y-6">
          <div>
            <label className="block text-white font-medium mb-2">Business ID</label>
            <input
              type="text"
              value={businessCode}
              onChange={(e) => setBusinessCode(e.target.value.toUpperCase())}
              placeholder="Enter Business ID"
              className="w-full px-4 py-4 text-xl font-mono text-center bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50 tracking-widest"
              maxLength={6}
            />
          </div>

          <div>
            <label className="block text-white font-medium mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full px-4 py-4 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50"
            />
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-center">
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!businessCode.trim() || !password || isLoading}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              'Login'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// Employee with time entries
interface EmployeeWithHours extends Employee {
  timeEntries: TimeEntry[];
  totalHours: number;
}

// Activity item for notifications
interface ActivityItem {
  id: string;
  employeeName: string;
  action: 'clock_in' | 'clock_out';
  time: string;
}

// Admin Dashboard Component
function AdminDashboard({ business, onLogout }: { business: Business; onLogout: () => void }) {
  const [pendingRequests, setPendingRequests] = useState<TimeChangeRequest[]>([]);
  const [allRequests, setAllRequests] = useState<TimeChangeRequest[]>([]);
  const [employees, setEmployees] = useState<Map<string, Employee>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'all' | 'hours' | 'reports'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Employee hours state
  const [allEmployees, setAllEmployees] = useState<EmployeeWithHours[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [loadingHours, setLoadingHours] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeWithHours | null>(null);

  // Report state
  const [reportStartDate, setReportStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toISOString().split('T')[0];
  });
  const [reportEndDate, setReportEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [reportData, setReportData] = useState<EmployeeWithHours[]>([]);
  const [reportGenerated, setReportGenerated] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);

  // Notification state
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [lastSeenTime, setLastSeenTime] = useState<string | null>(null);

  const loadRequests = async () => {
    try {
      const [pending, all] = await Promise.all([
        getPendingTimeChangeRequests(business.id),
        getTimeChangeRequestsByBusiness(business.id),
      ]);
      setPendingRequests(pending);
      setAllRequests(all);

      // Load employee data for all unique employee IDs
      const employeeIds = [...new Set(all.map(r => r.employee_id))];
      const employeeMap = new Map<string, Employee>();
      for (const id of employeeIds) {
        const emp = await getEmployeeById(id);
        if (emp) employeeMap.set(id, emp);
      }
      setEmployees(employeeMap);
    } catch (error) {
      console.error('Failed to load requests:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadRecentActivity = async () => {
    try {
      const entries = await getRecentTimeEntriesByBusiness(business.id, 30);
      const emps = await getEmployeesByBusiness(business.id);
      const empMap = new Map(emps.map(e => [e.id, e.full_name]));

      const activityItems: ActivityItem[] = [];
      
      for (const entry of entries) {
        const empName = empMap.get(entry.employee_id) || 'Unknown';
        
        // Add clock in activity
        activityItems.push({
          id: `${entry.id}-in`,
          employeeName: empName,
          action: 'clock_in',
          time: entry.clock_in_time,
        });
        
        // Add clock out activity if exists
        if (entry.clock_out_time) {
          activityItems.push({
            id: `${entry.id}-out`,
            employeeName: empName,
            action: 'clock_out',
            time: entry.clock_out_time,
          });
        }
      }

      // Sort by time descending
      activityItems.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setActivities(activityItems.slice(0, 20)); // Keep latest 20
    } catch (error) {
      console.error('Failed to load activity:', error);
    }
  };

  const handleClearNotifications = () => {
    if (activities.length > 0) {
      setLastSeenTime(activities[0].time);
    }
    setShowNotifications(false);
  };

  // Count unseen notifications
  const unseenCount = lastSeenTime 
    ? activities.filter(a => new Date(a.time) > new Date(lastSeenTime)).length 
    : activities.length;

  const loadEmployeeHours = async () => {
    setLoadingHours(true);
    try {
      const emps = await getEmployeesByBusiness(business.id);
      const empsWithHours: EmployeeWithHours[] = [];

      for (const emp of emps) {
        const entries = await getTimeEntriesByEmployee(emp.id, 500);
        
        // Filter by date range
        const filteredEntries = entries.filter(entry => {
          const entryDate = new Date(entry.clock_in_time).toISOString().split('T')[0];
          return entryDate >= startDate && entryDate <= endDate;
        });

        // Calculate total hours
        let totalMs = 0;
        for (const entry of filteredEntries) {
          if (entry.clock_out_time) {
            totalMs += new Date(entry.clock_out_time).getTime() - new Date(entry.clock_in_time).getTime();
          }
        }

        empsWithHours.push({
          ...emp,
          timeEntries: filteredEntries,
          totalHours: totalMs / (1000 * 60 * 60),
        });
      }

      // Sort by name
      empsWithHours.sort((a, b) => a.full_name.localeCompare(b.full_name));
      setAllEmployees(empsWithHours);
    } catch (error) {
      console.error('Failed to load employee hours:', error);
    } finally {
      setLoadingHours(false);
    }
  };

  const generateReport = async () => {
    setGeneratingReport(true);
    setReportGenerated(false);
    try {
      const emps = await getEmployeesByBusiness(business.id);
      const empsWithHours: EmployeeWithHours[] = [];

      for (const emp of emps) {
        const entries = await getTimeEntriesByEmployee(emp.id, 1000);
        
        // Filter by date range
        const filteredEntries = entries.filter(entry => {
          const entryDate = new Date(entry.clock_in_time).toISOString().split('T')[0];
          return entryDate >= reportStartDate && entryDate <= reportEndDate;
        });

        // Calculate total hours
        let totalMs = 0;
        for (const entry of filteredEntries) {
          if (entry.clock_out_time) {
            totalMs += new Date(entry.clock_out_time).getTime() - new Date(entry.clock_in_time).getTime();
          }
        }

        empsWithHours.push({
          ...emp,
          timeEntries: filteredEntries,
          totalHours: totalMs / (1000 * 60 * 60),
        });
      }

      // Sort by total hours descending
      empsWithHours.sort((a, b) => b.totalHours - a.totalHours);
      setReportData(empsWithHours);
      setReportGenerated(true);
    } catch (error) {
      console.error('Failed to generate report:', error);
    } finally {
      setGeneratingReport(false);
    }
  };

  const downloadCSV = () => {
    if (reportData.length === 0) return;

    const headers = ['Employee Name', 'Email', 'Phone', 'Total Hours', 'Total Entries'];
    const rows = reportData.map(emp => [
      emp.full_name,
      emp.email || '',
      emp.phone || '',
      emp.totalHours.toFixed(2),
      emp.timeEntries.length.toString(),
    ]);

    const csvContent = [
      `TimeSheet Report - ${business.name}`,
      `Date Range: ${reportStartDate} to ${reportEndDate}`,
      `Generated: ${new Date().toLocaleString()}`,
      '',
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
      '',
      `Total Employees: ${reportData.length}`,
      `Total Hours: ${reportData.reduce((acc, emp) => acc + emp.totalHours, 0).toFixed(2)}`,
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `timesheet-report-${reportStartDate}-to-${reportEndDate}.csv`;
    link.click();
  };

  useEffect(() => {
    loadRequests();
    loadRecentActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  useEffect(() => {
    if (activeTab === 'hours') {
      loadEmployeeHours();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, startDate, endDate]);

  // Refresh activity periodically
  useEffect(() => {
    const interval = setInterval(() => {
      loadRecentActivity();
    }, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  // Filter employees by search
  const filteredEmployees = allEmployees.filter(emp => {
    const search = searchFilter.toLowerCase();
    return (
      emp.full_name.toLowerCase().includes(search) ||
      (emp.email?.toLowerCase().includes(search) ?? false) ||
      (emp.phone?.toLowerCase().includes(search) ?? false)
    );
  });

  const handleApprove = async (request: TimeChangeRequest) => {
    setProcessingId(request.id);
    try {
      await approveTimeChangeRequest(
        request.id,
        request.time_entry_id,
        request.requested_clock_in,
        request.requested_clock_out
      );
      await loadRequests();
    } catch (error) {
      console.error('Failed to approve:', error);
      alert('Failed to approve request.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDecline = async (request: TimeChangeRequest) => {
    setProcessingId(request.id);
    try {
      await declineTimeChangeRequest(request.id);
      await loadRequests();
    } catch (error) {
      console.error('Failed to decline:', error);
      alert('Failed to decline request.');
    } finally {
      setProcessingId(null);
    }
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const displayRequests = activeTab === 'pending' ? pendingRequests : allRequests;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Notification Bell */}
              <div className="relative">
                <button
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors relative"
                >
                  <span className="text-xl">🔔</span>
                  {unseenCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                      {unseenCount > 9 ? '9+' : unseenCount}
                    </span>
                  )}
                </button>

                {/* Notification Popup */}
                {showNotifications && (
                  <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-2xl z-50 overflow-hidden">
                    <div className="bg-slate-800 px-4 py-3">
                      <h3 className="font-semibold text-white">Recent Activity</h3>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {activities.length === 0 ? (
                        <div className="p-6 text-center text-gray-500">
                          <p className="text-3xl mb-2">😴</p>
                          <p>No recent activity</p>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-100">
                          {activities.map((activity) => {
                            const isUnseen = !lastSeenTime || new Date(activity.time) > new Date(lastSeenTime);
                            return (
                              <div
                                key={activity.id}
                                className={`px-4 py-3 ${isUnseen ? 'bg-blue-50' : ''}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">
                                    {activity.action === 'clock_in' ? '🟢' : '🔴'}
                                  </span>
                                  <div className="flex-1">
                                    <p className="font-medium text-gray-900 text-sm">
                                      {activity.employeeName}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      {activity.action === 'clock_in' ? 'Clocked In' : 'Clocked Out'} • {formatDateTime(activity.time)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="border-t border-gray-100 p-3">
                      <button
                        onClick={handleClearNotifications}
                        className="w-full py-2 bg-green-500 hover:bg-green-600 text-white font-medium rounded-lg transition-colors"
                      >
                        ✓ All caught up
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h1 className="text-2xl font-bold">{business.name}</h1>
                <p className="text-slate-400">Admin Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-400 text-sm">ID: {business.business_code}</span>
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

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-gray-500 text-sm">Pending Requests</p>
            <p className="text-3xl font-bold text-orange-500">{pendingRequests.length}</p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-gray-500 text-sm">Approved</p>
            <p className="text-3xl font-bold text-green-600">
              {allRequests.filter(r => r.status === 'approved').length}
            </p>
          </div>
          <div className="bg-white rounded-xl p-6 shadow-sm">
            <p className="text-gray-500 text-sm">Declined</p>
            <p className="text-3xl font-bold text-red-500">
              {allRequests.filter(r => r.status === 'declined').length}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-100">
            <button
              onClick={() => setActiveTab('pending')}
              className={`flex-1 py-4 text-center font-medium transition-colors ${
                activeTab === 'pending'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Pending ({pendingRequests.length})
            </button>
            <button
              onClick={() => setActiveTab('all')}
              className={`flex-1 py-4 text-center font-medium transition-colors ${
                activeTab === 'all'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              All Requests ({allRequests.length})
            </button>
            <button
              onClick={() => setActiveTab('hours')}
              className={`flex-1 py-4 text-center font-medium transition-colors ${
                activeTab === 'hours'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Employee Hours
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`flex-1 py-4 text-center font-medium transition-colors ${
                activeTab === 'reports'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              📊 Reports
            </button>
          </div>

          {/* Requests List */}
          {(activeTab === 'pending' || activeTab === 'all') && (
            isLoading ? (
              <div className="py-12 text-center">
                <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto" />
              </div>
            ) : displayRequests.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <p className="text-4xl mb-2">📭</p>
                <p>{activeTab === 'pending' ? 'No pending requests' : 'No requests yet'}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {displayRequests.map((request) => {
                  const emp = employees.get(request.employee_id);
                  const isProcessing = processingId === request.id;

                  return (
                    <div key={request.id} className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <p className="font-semibold text-gray-900">{emp?.full_name || 'Unknown'}</p>
                          <p className="text-sm text-gray-500">
                            Submitted {formatDate(request.created_at)}
                          </p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                          request.status === 'pending'
                            ? 'bg-orange-100 text-orange-700'
                            : request.status === 'approved'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                        }`}>
                          {request.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="bg-red-50 rounded-lg p-3">
                          <p className="text-xs text-red-600 font-medium mb-1">Original Time</p>
                          <p className="text-sm text-gray-700">
                            {formatDateTime(request.original_clock_in)} - {request.original_clock_out ? formatDateTime(request.original_clock_out) : 'N/A'}
                          </p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3">
                          <p className="text-xs text-green-600 font-medium mb-1">Requested Time</p>
                          <p className="text-sm text-gray-700">
                            {formatDateTime(request.requested_clock_in)} - {request.requested_clock_out ? formatDateTime(request.requested_clock_out) : 'N/A'}
                          </p>
                        </div>
                      </div>

                      <div className="bg-gray-50 rounded-lg p-3 mb-4">
                        <p className="text-xs text-gray-500 font-medium mb-1">Reason</p>
                        <p className="text-sm text-gray-700">{request.reason}</p>
                      </div>

                      {request.status === 'pending' && (
                        <div className="flex gap-3">
                          <button
                            onClick={() => handleDecline(request)}
                            disabled={isProcessing}
                            className="flex-1 py-2 bg-red-100 hover:bg-red-200 disabled:bg-gray-100 text-red-700 font-medium rounded-lg transition-colors"
                          >
                            {isProcessing ? '...' : 'Decline'}
                          </button>
                          <button
                            onClick={() => handleApprove(request)}
                            disabled={isProcessing}
                            className="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
                          >
                            {isProcessing ? '...' : 'Approve'}
                          </button>
                        </div>
                      )}

                      {request.reviewed_at && (
                        <p className="text-xs text-gray-400 mt-2">
                          Reviewed on {formatDate(request.reviewed_at)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* Employee Hours Tab */}
          {activeTab === 'hours' && (
            <div className="p-6">
              {/* Search and Date Filter */}
              <div className="mb-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Search by Name, Email, or Phone
                  </label>
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Search employees..."
                    className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                    />
                  </div>
                </div>
              </div>

              {/* Employee List */}
              {loadingHours ? (
                <div className="py-12 text-center">
                  <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto" />
                  <p className="text-gray-500 mt-2">Loading employee hours...</p>
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  <p className="text-4xl mb-2">👥</p>
                  <p>{searchFilter ? 'No employees match your search' : 'No employees found'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Summary Header */}
                  <div className="bg-indigo-50 rounded-lg p-4 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-indigo-700 font-medium">
                        {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-indigo-700 font-bold">
                        Total: {filteredEmployees.reduce((acc, emp) => acc + emp.totalHours, 0).toFixed(1)} hrs
                      </span>
                    </div>
                  </div>

                  {/* Employee Cards */}
                  {filteredEmployees.map((emp) => (
                    <div
                      key={emp.id}
                      className="bg-gray-50 rounded-xl p-4 hover:bg-gray-100 transition-colors cursor-pointer"
                      onClick={() => setSelectedEmployee(selectedEmployee?.id === emp.id ? null : emp)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-semibold text-gray-900">{emp.full_name}</p>
                          <div className="text-sm text-gray-500 space-x-3">
                            {emp.email && <span>📧 {emp.email}</span>}
                            {emp.phone && <span>📞 {emp.phone}</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-indigo-600">
                            {emp.totalHours.toFixed(1)}
                          </p>
                          <p className="text-xs text-gray-500">hours</p>
                        </div>
                      </div>

                      {/* Expanded Time Entries */}
                      {selectedEmployee?.id === emp.id && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <p className="text-sm font-medium text-gray-700 mb-2">
                            Time Entries ({emp.timeEntries.length})
                          </p>
                          {emp.timeEntries.length === 0 ? (
                            <p className="text-sm text-gray-500">No entries in selected date range</p>
                          ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                              {emp.timeEntries.map((entry) => {
                                const duration = entry.clock_out_time
                                  ? (new Date(entry.clock_out_time).getTime() - new Date(entry.clock_in_time).getTime()) / (1000 * 60 * 60)
                                  : 0;
                                return (
                                  <div key={entry.id} className="bg-white rounded-lg p-3 text-sm">
                                    <div className="flex justify-between items-center">
                                      <span className="text-gray-600">
                                        {formatDate(entry.clock_in_time)}
                                      </span>
                                      <span className="font-medium text-gray-900">
                                        {duration.toFixed(1)} hrs
                                      </span>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">
                                      {formatDateTime(entry.clock_in_time)} → {entry.clock_out_time ? formatDateTime(entry.clock_out_time) : 'Active'}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reports Tab */}
          {activeTab === 'reports' && (
            <div className="p-6">
              {/* Report Configuration */}
              <div className="mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate Hours Report</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      From Date
                    </label>
                    <input
                      type="date"
                      value={reportStartDate}
                      onChange={(e) => {
                        setReportStartDate(e.target.value);
                        setReportGenerated(false);
                      }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      To Date
                    </label>
                    <input
                      type="date"
                      value={reportEndDate}
                      onChange={(e) => {
                        setReportEndDate(e.target.value);
                        setReportGenerated(false);
                      }}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={generateReport}
                      disabled={generatingReport}
                      className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                      {generatingReport ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          <span>Generating...</span>
                        </>
                      ) : (
                        <>
                          <span>📊</span>
                          <span>Generate Report</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Report Results */}
              {reportGenerated && (
                <div>
                  {/* Report Header */}
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-6 mb-6 text-white">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-2xl font-bold">{business.name}</h2>
                        <p className="text-white/80">Hours Report</p>
                      </div>
                      <button
                        onClick={downloadCSV}
                        className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors flex items-center gap-2"
                      >
                        <span>📥</span>
                        <span>Download CSV</span>
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="bg-white/10 rounded-lg p-3">
                        <p className="text-3xl font-bold">{reportData.length}</p>
                        <p className="text-sm text-white/80">Employees</p>
                      </div>
                      <div className="bg-white/10 rounded-lg p-3">
                        <p className="text-3xl font-bold">
                          {reportData.reduce((acc, emp) => acc + emp.totalHours, 0).toFixed(1)}
                        </p>
                        <p className="text-sm text-white/80">Total Hours</p>
                      </div>
                      <div className="bg-white/10 rounded-lg p-3">
                        <p className="text-3xl font-bold">
                          {reportData.reduce((acc, emp) => acc + emp.timeEntries.length, 0)}
                        </p>
                        <p className="text-sm text-white/80">Total Entries</p>
                      </div>
                    </div>
                    <p className="text-sm text-white/60 mt-4 text-center">
                      {reportStartDate} → {reportEndDate}
                    </p>
                  </div>

                  {/* Employee Table */}
                  {reportData.length === 0 ? (
                    <div className="py-12 text-center text-gray-500">
                      <p className="text-4xl mb-2">📭</p>
                      <p>No time entries found for this date range</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200">
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">#</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Employee</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Contact</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Entries</th>
                            <th className="px-4 py-3 text-right text-sm font-semibold text-gray-700">Hours</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {reportData.map((emp, index) => (
                            <tr key={emp.id} className="hover:bg-gray-50">
                              <td className="px-4 py-4 text-sm text-gray-500">{index + 1}</td>
                              <td className="px-4 py-4">
                                <p className="font-medium text-gray-900">{emp.full_name}</p>
                              </td>
                              <td className="px-4 py-4">
                                <p className="text-sm text-gray-600">{emp.email || '-'}</p>
                                <p className="text-xs text-gray-400">{emp.phone || '-'}</p>
                              </td>
                              <td className="px-4 py-4 text-right text-sm text-gray-600">
                                {emp.timeEntries.length}
                              </td>
                              <td className="px-4 py-4 text-right">
                                <span className={`text-lg font-bold ${
                                  emp.totalHours > 0 ? 'text-indigo-600' : 'text-gray-400'
                                }`}>
                                  {emp.totalHours.toFixed(1)}
                                </span>
                                <span className="text-xs text-gray-500 ml-1">hrs</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-indigo-50 font-semibold">
                            <td colSpan={3} className="px-4 py-4 text-indigo-700">
                              Total ({reportData.length} employees)
                            </td>
                            <td className="px-4 py-4 text-right text-indigo-700">
                              {reportData.reduce((acc, emp) => acc + emp.timeEntries.length, 0)}
                            </td>
                            <td className="px-4 py-4 text-right text-indigo-700">
                              {reportData.reduce((acc, emp) => acc + emp.totalHours, 0).toFixed(1)} hrs
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Instructions when no report */}
              {!reportGenerated && !generatingReport && (
                <div className="py-12 text-center text-gray-500">
                  <p className="text-6xl mb-4">📊</p>
                  <p className="text-lg font-medium mb-2">Generate a Hours Report</p>
                  <p>Select a date range and click &quot;Generate Report&quot; to see everyone&apos;s total hours.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
