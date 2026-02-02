'use client';

import { useState, useEffect } from 'react';
import {
  Business,
  Employee,
  TimeChangeRequest,
  getBusinessByCode,
  getPendingTimeChangeRequests,
  getTimeChangeRequestsByBusiness,
  getEmployeeById,
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessCode.trim()) return;

    setIsLoading(true);
    setError('');

    try {
      const business = await getBusinessByCode(businessCode);
      if (business) {
        onLogin(business);
      } else {
        setError('Business ID not found.');
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
          <p className="text-slate-400">Enter your Business ID to manage time change requests</p>
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

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 text-center">
              <p className="text-red-200 text-sm">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={!businessCode.trim() || isLoading}
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

// Admin Dashboard Component
function AdminDashboard({ business, onLogout }: { business: Business; onLogout: () => void }) {
  const [pendingRequests, setPendingRequests] = useState<TimeChangeRequest[]>([]);
  const [allRequests, setAllRequests] = useState<TimeChangeRequest[]>([]);
  const [employees, setEmployees] = useState<Map<string, Employee>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending');
  const [processingId, setProcessingId] = useState<string | null>(null);

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

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

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
            <div>
              <h1 className="text-2xl font-bold">{business.name}</h1>
              <p className="text-slate-400">Admin Dashboard</p>
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
          </div>

          {/* Requests List */}
          {isLoading ? (
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
          )}
        </div>
      </div>
    </div>
  );
}
