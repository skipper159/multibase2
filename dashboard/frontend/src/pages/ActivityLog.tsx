import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  LayoutList,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ChevronsUpDown,
  SlidersHorizontal,
  Users,
  Shield,
  Eye,
  RefreshCw,
  ArrowRight,
  Database,
} from 'lucide-react';
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
  ipAddress?: string | null;
  userAgent?: string | null;
  user: { id: string; username: string; email: string } | null;
}

interface AuditStats {
  total: number;
  last24h: number;
  last7d: number;
  failedLast24h: number;
  failedLast7d?: number;
  uniqueUsers24h?: number;
  successRate7d?: number;
  topActions: { action: string; count: number }[];
}

interface FilterState {
  action: string;
  resource: string;
  userId: string;
  success: 'all' | 'true' | 'false';
  startDate: string;
  endDate: string;
}

interface SortState {
  field: 'createdAt' | 'action' | 'resource' | 'success';
  order: 'asc' | 'desc';
}

function getActionColor(action: string): string {
  if (action.startsWith('INSTANCE_')) return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  if (action.startsWith('BACKUP_')) return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
  if (action.startsWith('VAULT_')) return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
  if (action.startsWith('SECURITY_')) return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
  if (action.startsWith('DOMAIN_')) return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
  if (action.startsWith('WEBHOOK_')) return 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30';
  if (action.startsWith('QUEUE_')) return 'bg-teal-500/15 text-teal-400 border-teal-500/30';
  if (action.startsWith('REPLICA_')) return 'bg-pink-500/15 text-pink-400 border-pink-500/30';
  if (action.startsWith('STORAGE_')) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (action.startsWith('LOGIN') || action.startsWith('AUTH')) return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  return 'bg-muted text-muted-foreground border-transparent';
}

function formatKeyName(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function SortHeader({
  label,
  field,
  sort,
  onSort,
}: {
  label: string;
  field: SortState['field'];
  sort: SortState;
  onSort: (field: SortState['field']) => void;
}) {
  const active = sort.field === field;
  return (
    <th
      className='px-6 py-3 text-left text-sm font-medium cursor-pointer select-none hover:bg-muted/70 transition-colors'
      onClick={() => onSort(field)}
    >
      <span className='inline-flex items-center gap-1'>
        {label}
        {active ? (
          sort.order === 'desc' ? (
            <ChevronDown className='w-3 h-3' />
          ) : (
            <ChevronUp className='w-3 h-3' />
          )
        ) : (
          <ChevronsUpDown className='w-3 h-3 text-muted-foreground/50' />
        )}
      </span>
    </th>
  );
}

function CollapsibleSection({
  label,
  children,
  depth,
}: {
  label: string;
  children: React.ReactNode;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 1);
  return (
    <div className={depth > 0 ? 'ml-3 border-l border-border pl-2 min-w-0' : 'min-w-0'}>
      <button
        onClick={() => setOpen((o) => !o)}
        className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
      >
        {open ? <ChevronDown className='w-3 h-3' /> : <ChevronRight className='w-3 h-3' />}
        <span>{label}</span>
      </button>
      {open && <div className='mt-1 space-y-1 min-w-0'>{children}</div>}
    </div>
  );
}

function renderDetailsValue(key: string, value: any, depth = 0): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className='text-muted-foreground italic text-xs'>null</span>;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return (
      <span className='text-xs' title={value}>
        {format(new Date(value), 'PPpp')}
      </span>
    );
  }
  if (typeof value === 'boolean') {
    return value ? (
      <span className='text-green-400 flex items-center gap-1 text-xs'>
        <CheckCircle className='w-3 h-3' /> true
      </span>
    ) : (
      <span className='text-red-400 flex items-center gap-1 text-xs'>
        <XCircle className='w-3 h-3' /> false
      </span>
    );
  }
  if (typeof value === 'number') {
    if (key === 'duration') return <span className='text-xs'>{value}ms</span>;
    return <span className='text-xs'>{value.toLocaleString()}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className='text-muted-foreground italic text-xs'>[]</span>;
    return (
      <CollapsibleSection label={`Array (${value.length})`} depth={depth}>
        {value.map((item, i) => (
          <div key={i} className='flex gap-2'>
            <span className='text-muted-foreground w-5 text-right shrink-0 text-xs'>{i}</span>
            <span>{renderDetailsValue(String(i), item, depth + 1)}</span>
          </div>
        ))}
      </CollapsibleSection>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return (
      <CollapsibleSection label={`Object (${entries.length} keys)`} depth={depth}>
        {entries.map(([k, v]) => (
          <KeyValueRow key={k} keyName={k} value={v} depth={depth + 1} />
        ))}
      </CollapsibleSection>
    );
  }
  const lk = key.toLowerCase();
  if (lk.includes('password') || lk.includes('secret') || lk.includes('token') || lk.includes('key')) {
    return <span className='font-mono text-xs text-muted-foreground'>{'*'.repeat(8)}</span>;
  }
  return <span className='font-mono text-xs break-all overflow-wrap-anywhere min-w-0'>{String(value)}</span>;
}

function KeyValueRow({ keyName, value, depth }: { keyName: string; value: any; depth: number }) {
  const highlighted = ['statusCode', 'success', 'error', 'message', 'method', 'duration'].includes(keyName);
  return (
    <div className='flex gap-3 text-sm min-w-0 overflow-hidden'>
      <span className={`shrink-0 w-28 truncate text-xs ${highlighted ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
        {formatKeyName(keyName)}
      </span>
      <span className='min-w-0 flex-1 overflow-hidden'>{renderDetailsValue(keyName, value, depth)}</span>
    </div>
  );
}

function ActionSummary({ action, details }: { action: string; details: any }) {
  if (
    action.includes('IMAGE_UPDATE') ||
    action.includes('DOCKER_UPDATE') ||
    action.includes('MULTIBASE_UPDATE')
  ) {
    const servicesList: Array<{ service: string; previousTag?: string; newTag?: string; targetTag?: string }> =
      details?.services ||
      details?.body?.services?.map((s: string) => ({ service: s })) ||
      [];

    const instanceName = details?.instanceName || details?.body?.instanceName;

    return (
      <div className='bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-4 text-sm space-y-3'>
        <div className='flex items-center justify-between border-b border-blue-500/20 pb-2'>
          <p className='font-semibold text-blue-400 flex items-center gap-2'>
            <RefreshCw className='w-4 h-4' />
            {action.includes('MULTIBASE') ? 'Multibase System Update' : 'Instance / Service Image Update'}
          </p>
          {instanceName && (
            <span className='px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono text-xs'>
              Instance: {instanceName}
            </span>
          )}
        </div>

        {servicesList.length > 0 ? (
          <div className='space-y-1.5'>
            <p className='text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2'>
              Updated Services & Versions ({servicesList.length})
            </p>
            <div className='grid grid-cols-1 gap-2'>
              {servicesList.map((item, idx) => {
                const prev = item.previousTag;
                const next = item.newTag || item.targetTag;
                return (
                  <div
                    key={idx}
                    className='flex items-center justify-between bg-card/60 border border-border/50 rounded px-3 py-2 text-xs'
                  >
                    <span className='font-mono font-medium text-foreground'>{item.service}</span>
                    <div className='flex items-center gap-2 font-mono'>
                      {prev && <span className='text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded'>{prev}</span>}
                      {prev && (next || prev) && <ArrowRight className='w-3 h-3 text-blue-400' />}
                      {next ? (
                        <span className='text-blue-400 bg-blue-500/15 border border-blue-500/30 px-1.5 py-0.5 rounded font-semibold'>
                          {next}
                        </span>
                      ) : (
                        <span className='text-muted-foreground italic'>Updated to target version</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : details?.body?.services ? (
          <p className='text-xs text-muted-foreground'>
            Services requested:{' '}
            <strong className='text-foreground'>
              {Array.isArray(details.body.services) ? details.body.services.join(', ') : String(details.body.services)}
            </strong>
          </p>
        ) : (
          <p className='text-xs text-muted-foreground'>System component update triggered.</p>
        )}
      </div>
    );
  }

  if (action.startsWith('BACKUP_')) {
    const backupName = details?.backupName || details?.name;
    const backupType = details?.backupType || details?.type || details?.body?.type;
    const instanceId = details?.instanceId || details?.body?.instanceId;

    return (
      <div className='bg-purple-500/10 border border-purple-500/20 rounded-lg p-4 mb-4 text-sm space-y-2'>
        <div className='flex items-center justify-between border-b border-purple-500/20 pb-2'>
          <p className='font-semibold text-purple-400 flex items-center gap-2'>
            <Database className='w-4 h-4' />
            {action === 'BACKUP_CREATE'
              ? 'Backup Created'
              : action === 'BACKUP_RESTORE'
              ? 'Backup Restored'
              : action === 'BACKUP_DELETE'
              ? 'Backup Deleted'
              : 'Backup Action'}
          </p>
          {backupType && (
            <span className='px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono text-xs uppercase'>
              Type: {backupType}
            </span>
          )}
        </div>
        <div className='grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1'>
          <div>
            <span className='text-muted-foreground'>Backup Name: </span>
            <strong className='font-mono text-foreground'>{backupName || '—'}</strong>
          </div>
          {instanceId && (
            <div>
              <span className='text-muted-foreground'>Instance: </span>
              <strong className='text-foreground'>{instanceId}</strong>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (action.includes('DELETE') || action.includes('_STOP') || action.includes('_REMOVE')) {
    return (
      <div className='bg-red-500/10 border border-red-500/20 rounded p-3 mb-4 text-sm'>
        <p className='text-red-400 flex items-center gap-2'>
          <AlertCircle className='w-4 h-4' /> Destructive action – this cannot be undone
        </p>
      </div>
    );
  }
  if (action === 'VAULT_SECRET_REVEAL') {
    return (
      <div className='bg-yellow-500/10 border border-yellow-500/20 rounded p-3 mb-4 text-sm'>
        <p className='text-yellow-400 flex items-center gap-2'>
          <Eye className='w-4 h-4' /> A secret value was decrypted and revealed
        </p>
      </div>
    );
  }
  if (action === 'SECURITY_SETTING_UPDATE' && details?.body) {
    return (
      <div className='bg-orange-500/10 border border-orange-500/20 rounded p-3 mb-4 text-sm space-y-1'>
        <p className='font-medium text-orange-400 flex items-center gap-2'>
          <Shield className='w-4 h-4' /> Security Settings Changed
        </p>
        {details.body.sslOnly !== undefined && (
          <p className='text-sm'>
            SSL Only: <strong>{details.body.sslOnly ? 'Enabled' : 'Disabled'}</strong>
          </p>
        )}
        {details.body.rateLimitEnabled !== undefined && (
          <p className='text-sm'>
            Rate Limit:{' '}
            <strong>
              {details.body.rateLimitEnabled ? `${details.body.rateLimitRpm} RPM` : 'Disabled'}
            </strong>
          </p>
        )}
      </div>
    );
  }
  return null;
}

export default function ActivityLog() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    action: '',
    resource: '',
    userId: '',
    success: 'all',
    startDate: '',
    endDate: '',
  });
  const [sort, setSort] = useState<SortState>({ field: 'createdAt', order: 'desc' });
  const [pagination, setPagination] = useState({ limit: 50, offset: 0, total: 0 });
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [availableActions, setAvailableActions] = useState<{ action: string; count: number }[]>([]);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const activeFilterCount = [
    filters.action,
    filters.resource,
    filters.userId,
    filters.success !== 'all' ? filters.success : '',
    filters.startDate,
    filters.endDate,
  ].filter(Boolean).length;

  const fetchData = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        limit: pagination.limit.toString(),
        offset: pagination.offset.toString(),
        sortBy: sort.field,
        sortOrder: sort.order,
      });

      if (filters.action) queryParams.append('action', filters.action);
      if (filters.resource) queryParams.append('resource', filters.resource);
      if (filters.userId) queryParams.append('userId', filters.userId);
      if (filters.success !== 'all') queryParams.append('success', filters.success);
      if (filters.startDate) queryParams.append('startDate', filters.startDate);
      if (filters.endDate) queryParams.append('endDate', filters.endDate);

      const [logsRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/audit?${queryParams}`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        }),
        fetch(`${API_URL}/api/audit/stats`, {
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include',
        }),
      ]);

      if (logsRes.ok) {
        const data = await logsRes.json();
        setLogs(data.data);
        setPagination((prev) => ({ ...prev, total: data.pagination.total }));
      }

      if (statsRes.ok) {
        setStats(await statsRes.json());
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
  }, [pagination.offset, filters, sort]);

  useEffect(() => {
    fetch(`${API_URL}/api/audit/actions`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => setAvailableActions(d.actions || []))
      .catch(() => {});
  }, []);

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, offset: 0 }));
  };

  const handleSort = (field: SortState['field']) => {
    setSort((prev) =>
      prev.field === field ? { field, order: prev.order === 'desc' ? 'asc' : 'desc' } : { field, order: 'desc' }
    );
    setPagination((prev) => ({ ...prev, offset: 0 }));
  };

  const clearFilters = () => {
    setFilters({ action: '', resource: '', userId: '', success: 'all', startDate: '', endDate: '' });
    setPagination((prev) => ({ ...prev, offset: 0 }));
  };

  const parsedDetails = useMemo(() => {
    if (!selectedLog?.details) return null;
    if (typeof selectedLog.details === 'object') return selectedLog.details;
    try {
      return JSON.parse(selectedLog.details);
    } catch {
      return { raw: selectedLog.details };
    }
  }, [selectedLog]);

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
          <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8'>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <LayoutList className='w-4 h-4' />
                <span className='text-xs font-medium'>Total Events</span>
              </div>
              <div className='text-2xl font-bold text-foreground'>{stats.total.toLocaleString()}</div>
              <div className='text-xs text-muted-foreground mt-1'>All recorded</div>
            </div>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <Clock className='w-4 h-4' />
                <span className='text-xs font-medium'>Last 24h</span>
              </div>
              <div className='text-2xl font-bold text-foreground'>{stats.last24h.toLocaleString()}</div>
              <div className='text-xs text-muted-foreground mt-1'>Recent activity</div>
            </div>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <Activity className='w-4 h-4' />
                <span className='text-xs font-medium'>Last 7 Days</span>
              </div>
              <div className='text-2xl font-bold text-foreground'>{stats.last7d.toLocaleString()}</div>
              <div className='text-xs text-muted-foreground mt-1'>Weekly activity</div>
            </div>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <XCircle className='w-4 h-4 text-destructive' />
                <span className='text-xs font-medium'>Failures (24h)</span>
              </div>
              <div className='text-2xl font-bold text-destructive'>{stats.failedLast24h.toLocaleString()}</div>
              <div className='text-xs text-muted-foreground mt-1'>Errors in last 24h</div>
            </div>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <Users className='w-4 h-4' />
                <span className='text-xs font-medium'>Active Users</span>
              </div>
              <div className='text-2xl font-bold text-foreground'>
                {(stats.uniqueUsers24h ?? 0).toLocaleString()}
              </div>
              <div className='text-xs text-muted-foreground mt-1'>Distinct users (24h)</div>
            </div>
            <div className='bg-card border border-border rounded-lg p-4'>
              <div className='flex items-center gap-2 text-muted-foreground mb-2'>
                <CheckCircle className='w-4 h-4 text-green-400' />
                <span className='text-xs font-medium'>Success Rate</span>
              </div>
              <div className='text-2xl font-bold text-green-400'>{stats.successRate7d ?? 100}%</div>
              <div className='text-xs text-muted-foreground mt-1'>Based on last 7 days</div>
            </div>
          </div>
        )}

        {/* Filter Panel Toggle */}
        <div className='flex items-center gap-3 mb-3'>
          <button
            onClick={() => setFilterPanelOpen((o) => !o)}
            className='inline-flex items-center gap-2 px-3 py-2 border border-border rounded-md bg-card hover:bg-muted transition-colors text-sm font-medium'
          >
            <SlidersHorizontal className='w-4 h-4' />
            Filters
            {activeFilterCount > 0 && (
              <span className='ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold'>
                {activeFilterCount}
              </span>
            )}
            {filterPanelOpen ? <ChevronUp className='w-4 h-4' /> : <ChevronDown className='w-4 h-4' />}
          </button>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className='text-sm text-muted-foreground hover:text-foreground transition-colors'>
              Clear all
            </button>
          )}
          <span className='text-sm text-muted-foreground ml-auto'>
            {pagination.total.toLocaleString()} results
          </span>
        </div>

        {/* Filter Panel */}
        {filterPanelOpen && (
          <div className='bg-card border border-border rounded-lg p-4 mb-6 space-y-4'>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
              <div>
                <label className='block text-xs font-medium text-foreground mb-1'>Action Type</label>
                <select
                  value={filters.action}
                  onChange={(e) => handleFilterChange('action', e.target.value)}
                  className='w-full px-3 py-2 border border-border rounded-md bg-input text-foreground text-sm focus:ring-2 focus:ring-primary'
                >
                  <option value=''>All Actions</option>
                  {availableActions.map(({ action, count }) => (
                    <option key={action} value={action}>
                      {action} ({count})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className='block text-xs font-medium text-foreground mb-1'>Status</label>
                <select
                  value={filters.success}
                  onChange={(e) => handleFilterChange('success', e.target.value as FilterState['success'])}
                  className='w-full px-3 py-2 border border-border rounded-md bg-input text-foreground text-sm focus:ring-2 focus:ring-primary'
                >
                  <option value='all'>All Status</option>
                  <option value='true'>Success</option>
                  <option value='false'>Failure</option>
                </select>
              </div>
              <div>
                <label className='block text-xs font-medium text-foreground mb-1'>User</label>
                <input
                  type='text'
                  placeholder='Filter by user ID or name'
                  value={filters.userId}
                  onChange={(e) => handleFilterChange('userId', e.target.value)}
                  className='w-full px-3 py-2 border border-border rounded-md bg-input text-foreground text-sm focus:ring-2 focus:ring-primary'
                />
              </div>
            </div>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
              <div>
                <label className='block text-xs font-medium text-foreground mb-1'>Resource</label>
                <input
                  type='text'
                  placeholder='e.g., instance-name'
                  value={filters.resource}
                  onChange={(e) => handleFilterChange('resource', e.target.value)}
                  className='w-full px-3 py-2 border border-border rounded-md bg-input text-foreground text-sm focus:ring-2 focus:ring-primary'
                />
              </div>
              <div>
                <label className='block text-xs font-medium text-foreground mb-1'>From</label>
                <input
                  type='datetime-local'
                  value={filters.startDate}
                  onChange={(e) => handleFilterChange('startDate', e.target.value)}
                  className='w-full px-3 py-2 border border-border rounded-md bg-input text-foreground text-sm focus:ring-2 focus:ring-primary'
                />
              </div>
              <div>
                <label className='block text-xs font-medium text-foreground mb-1'>To</label>
                <input
                  type='datetime-local'
                  value={filters.endDate}
                  onChange={(e) => handleFilterChange('endDate', e.target.value)}
                  className='w-full px-3 py-2 border border-border rounded-md bg-input text-foreground text-sm focus:ring-2 focus:ring-primary'
                />
              </div>
            </div>
          </div>
        )}

        {/* Logs Table */}
        <div className='bg-card border rounded-lg overflow-hidden'>
          <div className='overflow-x-auto'>
            <table className='w-full'>
              <thead className='bg-muted'>
                <tr>
                  <SortHeader label='Status' field='success' sort={sort} onSort={handleSort} />
                  <SortHeader label='Time' field='createdAt' sort={sort} onSort={handleSort} />
                  <th className='px-6 py-3 text-left text-sm font-medium'>User</th>
                  <SortHeader label='Action' field='action' sort={sort} onSort={handleSort} />
                  <SortHeader label='Resource' field='resource' sort={sort} onSort={handleSort} />
                  <th className='px-6 py-3 text-left text-sm font-medium'></th>
                </tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className='px-6 py-12 text-center text-muted-foreground'>
                      No activity logs found matching your filters.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className='hover:bg-muted/40 transition-colors'>
                      <td className='px-6 py-3'>
                        {log.success ? (
                          <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30'>
                            <CheckCircle className='w-3 h-3' />
                            Success
                          </span>
                        ) : (
                          <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30'>
                            <XCircle className='w-3 h-3' />
                            Failed
                          </span>
                        )}
                      </td>
                      <td className='px-6 py-3 text-sm text-muted-foreground whitespace-nowrap'>
                        {format(new Date(log.createdAt), 'MMM d, HH:mm:ss')}
                      </td>
                      <td className='px-6 py-3 text-sm font-medium'>{log.user?.username || 'System'}</td>
                      <td className='px-6 py-3 text-sm'>
                        <span className={`font-mono text-xs px-2 py-0.5 rounded border ${getActionColor(log.action)}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className='px-6 py-3 text-sm text-muted-foreground max-w-[200px] truncate' title={log.resource || undefined}>
                        {log.resource || '-'}
                      </td>
                      <td className='px-6 py-3'>
                        <button
                          onClick={() => setSelectedLog(log)}
                          className='text-xs text-primary hover:underline whitespace-nowrap'
                        >
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
              Showing {logs.length === 0 ? 0 : pagination.offset + 1}–{Math.min(pagination.offset + logs.length, pagination.total)} of{' '}
              {pagination.total.toLocaleString()} entries
            </div>
            <div className='flex gap-2'>
              <button
                disabled={pagination.offset === 0}
                onClick={() => setPagination((prev) => ({ ...prev, offset: Math.max(0, prev.offset - prev.limit) }))}
                className='px-3 py-1 border rounded hover:bg-muted disabled:opacity-50 text-sm transition-colors'
              >
                Previous
              </button>
              <button
                disabled={pagination.offset + logs.length >= pagination.total}
                onClick={() => setPagination((prev) => ({ ...prev, offset: prev.offset + prev.limit }))}
                className='px-3 py-1 border rounded hover:bg-muted disabled:opacity-50 text-sm transition-colors'
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Details Modal */}
      {selectedLog && (
        <div
          className='fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4'
          onClick={(e) => e.target === e.currentTarget && setSelectedLog(null)}
        >
          <div className='bg-card border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto flex flex-col'>
            {/* Modal Header */}
            <div className='flex items-start justify-between p-6 pb-4 border-b border-border'>
              <div className='space-y-1'>
                <div className='flex items-center gap-2 flex-wrap'>
                  <span className={`font-mono text-xs px-2 py-0.5 rounded border ${getActionColor(selectedLog.action)}`}>
                    {selectedLog.action}
                  </span>
                  {selectedLog.success ? (
                    <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30'>
                      <CheckCircle className='w-3 h-3' /> Success
                    </span>
                  ) : (
                    <span className='inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30'>
                      <XCircle className='w-3 h-3' /> Failed
                    </span>
                  )}
                </div>
                {selectedLog.resource && (
                  <p className='text-xs text-muted-foreground font-mono truncate max-w-md' title={selectedLog.resource}>
                    {selectedLog.resource}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className='text-muted-foreground hover:text-foreground transition-colors ml-4 shrink-0'
              >
                <XCircle className='w-5 h-5' />
              </button>
            </div>

            <div className='p-6 space-y-5'>
              {/* Metadata Grid */}
              <div className='grid grid-cols-2 gap-x-6 gap-y-3'>
                <div>
                  <p className='text-xs text-muted-foreground mb-0.5'>User</p>
                  <p className='text-sm font-medium'>{selectedLog.user?.username || 'System'}</p>
                  {selectedLog.user?.email && (
                    <p className='text-xs text-muted-foreground'>{selectedLog.user.email}</p>
                  )}
                </div>
                <div>
                  <p className='text-xs text-muted-foreground mb-0.5'>Time</p>
                  <p className='text-sm font-medium'>{format(new Date(selectedLog.createdAt), 'PPpp')}</p>
                </div>
                {selectedLog.ipAddress && (
                  <div>
                    <p className='text-xs text-muted-foreground mb-0.5'>IP Address</p>
                    <p className='text-sm font-mono'>{selectedLog.ipAddress}</p>
                  </div>
                )}
                {selectedLog.userAgent && (
                  <div>
                    <p className='text-xs text-muted-foreground mb-0.5'>User Agent</p>
                    <p className='text-xs text-muted-foreground truncate' title={selectedLog.userAgent}>
                      {selectedLog.userAgent}
                    </p>
                  </div>
                )}
              </div>

              {/* Context-aware summary */}
              <ActionSummary action={selectedLog.action} details={parsedDetails} />

              {/* Structured Details */}
              {parsedDetails && Object.keys(parsedDetails).length > 0 && (
                <div>
                  <p className='text-xs font-medium text-foreground mb-2 uppercase tracking-wider'>Details</p>
                  <div className='bg-muted/50 rounded-lg p-4 space-y-2 overflow-x-auto'>
                    {Object.entries(parsedDetails).map(([key, value]) => (
                      <KeyValueRow key={key} keyName={key} value={value} depth={0} />
                    ))}
                  </div>
                </div>
              )}

              {!parsedDetails && (
                <p className='text-sm text-muted-foreground italic'>No additional details recorded.</p>
              )}
            </div>

            <div className='flex justify-end px-6 pb-6 pt-2'>
              <button
                onClick={() => setSelectedLog(null)}
                className='px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm transition-colors'
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
