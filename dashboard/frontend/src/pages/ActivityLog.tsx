import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Search, AlertCircle, CheckCircle, XCircle, Clock, LayoutList } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import PageHeader from '../components/PageHeader';

interface AuditLog {
  id: number;
  userId: string;
  action: string;
  resource: string;
  details: any;
  success: boolean;
  createdAt: string;
  user: {
    id: string;
    username: string;
    email: string;
  };
}

interface AuditStats {
  total: number;
  last24h: number;
  last7d: number;
  failedLast24h: number;
  topActions: { action: string; count: number }[];
}

export default function ActivityLog() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    action: '',
    userId: '',
    success: 'all', // 'all', 'true', 'false'
  });
  const [pagination, setPagination] = useState({
    limit: 50,
    offset: 0,
    total: 0,
  });
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const fetchData = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        limit: pagination.limit.toString(),
        offset: pagination.offset.toString(),
      });

      if (filters.action) queryParams.append('action', filters.action);
      if (filters.userId) queryParams.append('userId', filters.userId);
      if (filters.success !== 'all') queryParams.append('success', filters.success);

      const [logsRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/audit?${queryParams}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/audit/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.data);
        setPagination((prev) => ({ ...prev, total: data.pagination.total }));
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (error) {
      console.error('Error fetching activity logs:', error);
      toast.error('Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [pagination.offset, filters]); // Re-fetch when page or filters change

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, offset: 0 })); // Reset to first page
  };

  if (loading && logs.length === 0) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-primary'></div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-background'>
      <PageHeader>
        <div className='flex items-center justify-between'>
          <div>
            <Link to='/' className='inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-2'>
              <ArrowLeft className='w-4 h-4' />
              Back to Dashboard
            </Link>
            <h2 className='text-2xl font-bold text-foreground flex items-center gap-2'>
              <Activity className='w-6 h-6' />
              Activity Log
            </h2>
            <p className='text-muted-foreground mt-1'>Monitor system actions and security events</p>
          </div>
        </div>
      </PageHeader>

      <main className='container mx-auto px-6 py-8'>
        {/* Stats Cards */}
        {stats && (
          <div className='grid grid-cols-1 md:grid-cols-4 gap-4 mb-8'>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <LayoutList className='w-4 h-4' />
                <span className='text-sm font-medium'>Total Actions</span>
              </div>
              <div className='text-2xl font-bold text-foreground'>{stats.total.toLocaleString()}</div>
              <div className='text-xs text-muted-foreground mt-1'>All recorded events</div>
            </div>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <Clock className='w-4 h-4' />
                <span className='text-sm font-medium'>Last 24 Hours</span>
              </div>
              <div className='text-2xl font-bold text-foreground'>{stats.last24h.toLocaleString()}</div>
              <div className='text-xs text-muted-foreground mt-1'>Recent activity</div>
            </div>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <AlertCircle className='w-4 h-4 text-destructive' />
                <span className='text-sm font-medium'>Failed (24h)</span>
              </div>
              <div className='text-2xl font-bold text-destructive'>{stats.failedLast24h.toLocaleString()}</div>
              <div className='text-xs text-muted-foreground mt-1'>Errors in last 24h</div>
            </div>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <Activity className='w-4 h-4' />
                <span className='text-sm font-medium'>Top Action</span>
              </div>
              <div className='text-xl font-bold text-foreground truncate'>{stats.topActions[0]?.action || 'None'}</div>
              <div className='text-xs text-muted-foreground mt-1'>{stats.topActions[0]?.count || 0} occurrences</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className='bg-card border rounded-lg p-4 mb-6 flex gap-4 items-end'>
          <div className='flex-1'>
            <label className='block text-sm font-medium text-foreground mb-1'>Action Type</label>
            <div className='relative'>
              <Search className='absolute left-3 top-2.5 w-4 h-4 text-muted-foreground' />
              <input
                type='text'
                placeholder='e.g., INSTANCE_START'
                value={filters.action}
                onChange={(e) => handleFilterChange('action', e.target.value)}
                className='w-full pl-9 pr-3 py-2 border border-border rounded-md bg-input text-foreground focus:ring-2 focus:ring-primary'
              />
            </div>
          </div>
          <div className='w-48'>
            <label className='block text-sm font-medium text-foreground mb-1'>Status</label>
            <select
              value={filters.success}
              onChange={(e) => handleFilterChange('success', e.target.value)}
              className='w-full px-3 py-2 border border-border rounded-md bg-input text-foreground focus:ring-2 focus:ring-primary'
            >
              <option value='all'>All Status</option>
              <option value='true'>Success</option>
              <option value='false'>Failure</option>
            </select>
          </div>
        </div>

        {/* Logs Table */}
        <div className='bg-card border rounded-lg overflow-hidden'>
          <div className='overflow-x-auto'>
            <table className='w-full'>
              <thead className='bg-muted'>
                <tr>
                  <th className='px-6 py-3 text-left text-sm font-medium'>Status</th>
                  <th className='px-6 py-3 text-left text-sm font-medium'>Time</th>
                  <th className='px-6 py-3 text-left text-sm font-medium'>User</th>
                  <th className='px-6 py-3 text-left text-sm font-medium'>Action</th>
                  <th className='px-6 py-3 text-left text-sm font-medium'>Resource</th>
                  <th className='px-6 py-3 text-left text-sm font-medium'>Details</th>
                </tr>
              </thead>
              <tbody className='divide-y'>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className='px-6 py-8 text-center text-muted-foreground'>
                      No activity logs found matching your filters.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className='hover:bg-muted/50 transition-colors'>
                      <td className='px-6 py-4'>
                        {log.success ? (
                          <span className='inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700'>
                            <CheckCircle className='w-3 h-3' />
                            Success
                          </span>
                        ) : (
                          <span className='inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700'>
                            <XCircle className='w-3 h-3' />
                            Failed
                          </span>
                        )}
                      </td>
                      <td className='px-6 py-4 text-sm text-muted-foreground whitespace-nowrap'>
                        {format(new Date(log.createdAt), 'MMM d, HH:mm:ss')}
                      </td>
                      <td className='px-6 py-4 text-sm font-medium'>{log.user?.username || 'System'}</td>
                      <td className='px-6 py-4 text-sm'>
                        <span className='font-mono text-xs bg-muted px-2 py-1 rounded'>{log.action}</span>
                      </td>
                      <td className='px-6 py-4 text-sm text-muted-foreground'>{log.resource || '-'}</td>
                      <td className='px-6 py-4'>
                        <button onClick={() => setSelectedLog(log)} className='text-sm text-primary hover:underline'>
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className='border-t p-4 flex items-center justify-between'>
            <div className='text-sm text-muted-foreground'>
              Showing {logs.length} of {pagination.total} entries
            </div>
            <div className='flex gap-2'>
              <button
                disabled={pagination.offset === 0}
                onClick={() => setPagination((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                className='px-3 py-1 border rounded hover:bg-muted disabled:opacity-50'
              >
                Previous
              </button>
              <button
                disabled={pagination.offset + logs.length >= pagination.total}
                onClick={() => setPagination((prev) => ({ ...prev, offset: prev.offset + prev.limit }))}
                className='px-3 py-1 border rounded hover:bg-muted disabled:opacity-50'
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Details Modal */}
      {selectedLog && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4'>
          <div className='bg-card border rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto'>
            <h2 className='text-xl font-semibold mb-4 flex items-center gap-2'>Details: {selectedLog.action}</h2>
            <div className='space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='text-sm text-muted-foreground'>User</label>
                  <p className='font-medium'>{selectedLog.user?.username || 'Unknown'}</p>
                  <p className='text-xs text-muted-foreground'>{selectedLog.user?.email}</p>
                </div>
                <div>
                  <label className='text-sm text-muted-foreground'>Time</label>
                  <p className='font-medium'>{format(new Date(selectedLog.createdAt), 'PPpp')}</p>
                </div>
                <div>
                  <label className='text-sm text-muted-foreground'>Resource</label>
                  <p className='font-medium font-mono'>{selectedLog.resource}</p>
                </div>
                <div>
                  <label className='text-sm text-muted-foreground'>Status</label>
                  <p className={`font-medium ${selectedLog.success ? 'text-green-600' : 'text-red-600'}`}>
                    {selectedLog.success ? 'Success' : 'Failed'}
                  </p>
                </div>
              </div>

              <div>
                <label className='text-sm text-muted-foreground'>Metadata / Payload</label>
                <pre className='bg-muted p-4 rounded-lg text-xs font-mono overflow-x-auto mt-1'>
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            </div>
            <div className='flex justify-end pt-6'>
              <button
                onClick={() => setSelectedLog(null)}
                className='px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90'
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
