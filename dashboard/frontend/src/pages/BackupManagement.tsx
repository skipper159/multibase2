import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Database,
  Plus,
  Trash2,
  RotateCcw,
  ArrowLeft,
  HardDrive,
  Server,
  Calendar,
  Eye,
  Clock,
  Power,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useInstances } from '../hooks/useInstances';
import { toast } from 'sonner';
import { format } from 'date-fns';
import PageHeader from '../components/PageHeader';

interface Backup {
  id: string;
  name: string;
  type: 'full' | 'instance' | 'database';
  instanceId?: string;
  size: number;
  createdAt: string;
  user: {
    username: string;
    email: string;
  };
}

interface BackupSchedule {
  id: number;
  instanceId: string;
  cronSchedule: string;
  type: string;
  retention: number;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  lastStatus?: string;
}

interface RestorePreview {
  id: string;
  name: string;
  type: string;
  instanceId?: string;
  size: number;
  createdAt: string;
  path?: string;
  contents: {
    database: boolean;
    volumes: boolean;
    config: boolean;
  };
  warnings: string[];
}

type Tab = 'backups' | 'schedules';

export default function BackupManagement() {
  const { token, user } = useAuth();
  const { data: instances } = useInstances();
  const [activeTab, setActiveTab] = useState<Tab>('backups');
  const [backups, setBackups] = useState<Backup[]>([]);
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [previewData, setPreviewData] = useState<RestorePreview | null>(null);
  const [formData, setFormData] = useState({
    type: 'full' as 'full' | 'instance' | 'database',
    instanceId: '',
    name: '',
  });
  const [scheduleFormData, setScheduleFormData] = useState({
    instanceId: '',
    cronSchedule: '0 2 * * *',
    type: 'full',
    retention: 7,
  });

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const fetchBackups = async () => {
    try {
      const response = await fetch(`${API_URL}/api/backups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setBackups(data);
      }
    } catch (error) {
      console.error('Error fetching backups:', error);
      toast.error('Failed to load backups');
    }
  };

  const fetchSchedules = async () => {
    try {
      const response = await fetch(`${API_URL}/api/schedules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setSchedules(data.schedules || []);
      }
    } catch (error) {
      console.error('Error fetching schedules:', error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchBackups(), fetchSchedules()]);
      setLoading(false);
    };
    loadData();
  }, []);

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/backups`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create backup');
      }

      toast.success('Backup created successfully');
      setIsCreating(false);
      setFormData({ type: 'full', instanceId: '', name: '' });
      fetchBackups();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create backup';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/schedules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(scheduleFormData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create schedule');
      }

      toast.success('Schedule created successfully');
      setIsCreatingSchedule(false);
      setScheduleFormData({ instanceId: '', cronSchedule: '0 2 * * *', type: 'full', retention: 7 });
      fetchSchedules();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create schedule';
      toast.error(message);
    }
  };

  const handlePreviewRestore = async (backupId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/backups/${backupId}/preview`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setPreviewData(data);
      } else {
        toast.error('Failed to load preview');
      }
    } catch (error) {
      toast.error('Failed to load preview');
    }
  };

  const handleRestore = async (backupId: string, instanceId?: string) => {
    if (!window.confirm('Are you sure you want to restore this backup? This will overwrite existing data.')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/backups/${backupId}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ instanceId }),
      });

      if (!response.ok) {
        throw new Error('Failed to restore backup');
      }

      toast.success('Backup restored successfully');
      setPreviewData(null);
    } catch (error) {
      toast.error('Failed to restore backup');
    }
  };

  const handleDelete = async (backupId: string) => {
    if (!window.confirm('Are you sure you want to delete this backup?')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/backups/${backupId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to delete backup');
      }

      toast.success('Backup deleted successfully');
      fetchBackups();
    } catch (error) {
      toast.error('Failed to delete backup');
    }
  };

  const handleToggleSchedule = async (scheduleId: number, enabled: boolean) => {
    try {
      const response = await fetch(`${API_URL}/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled: !enabled }),
      });

      if (response.ok) {
        toast.success(`Schedule ${!enabled ? 'enabled' : 'disabled'}`);
        fetchSchedules();
      }
    } catch (error) {
      toast.error('Failed to update schedule');
    }
  };

  const handleDeleteSchedule = async (scheduleId: number) => {
    if (!window.confirm('Are you sure you want to delete this schedule?')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/schedules/${scheduleId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        toast.success('Schedule deleted');
        fetchSchedules();
      }
    } catch (error) {
      toast.error('Failed to delete schedule');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'full':
        return <HardDrive className='w-4 h-4' />;
      case 'instance':
        return <Server className='w-4 h-4' />;
      case 'database':
        return <Database className='w-4 h-4' />;
      default:
        return null;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'full':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'instance':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'database':
        return 'bg-green-100 text-green-700 border-green-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const parseCronToReadable = (cron: string): string => {
    const parts = cron.split(' ');
    if (parts.length < 5) return cron;
    const [min, hour] = parts;
    return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  };

  if (loading) {
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
              <Database className='w-6 h-6' />
              Backup & Restore
            </h2>
            <p className='text-muted-foreground mt-1'>Create and manage backups of your instances</p>
          </div>
          <div className='flex gap-3'>
            {activeTab === 'backups' && (
              <button
                onClick={() => setIsCreating(!isCreating)}
                className='flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors'
              >
                <Plus className='w-4 h-4' />
                {isCreating ? 'Cancel' : 'Create Backup'}
              </button>
            )}
            {activeTab === 'schedules' && (
              <button
                onClick={() => setIsCreatingSchedule(!isCreatingSchedule)}
                className='flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors'
              >
                <Plus className='w-4 h-4' />
                {isCreatingSchedule ? 'Cancel' : 'Create Schedule'}
              </button>
            )}
          </div>
        </div>
      </PageHeader>

      <main className='container mx-auto px-6 py-8'>
        {/* Tabs */}
        <div className='flex gap-4 mb-6'>
          <button
            onClick={() => setActiveTab('backups')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
              activeTab === 'backups'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:bg-muted'
            }`}
          >
            <Database className='w-4 h-4' />
            Backups ({backups.length})
          </button>
          <button
            onClick={() => setActiveTab('schedules')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md transition-colors ${
              activeTab === 'schedules'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:bg-muted'
            }`}
          >
            <Calendar className='w-4 h-4' />
            Schedules ({schedules.length})
          </button>
        </div>

        {/* Backups Tab */}
        {activeTab === 'backups' && (
          <>
            {/* Create Form */}
            {isCreating && (
              <div className='bg-card border rounded-lg p-6 mb-6'>
                <h2 className='text-xl font-semibold mb-4'>Create New Backup</h2>
                <form onSubmit={handleCreateBackup} className='space-y-4'>
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <div>
                      <label className='block text-sm font-medium text-foreground mb-1'>
                        Backup Type <span className='text-destructive'>*</span>
                      </label>
                      <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value as any, instanceId: '' })}
                        className='w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary bg-input text-foreground'
                      >
                        <option value='full'>Full Backup (All Data)</option>
                        <option value='instance'>Instance Backup</option>
                        <option value='database'>Database Only</option>
                      </select>
                    </div>
                    {formData.type === 'instance' && (
                      <div>
                        <label className='block text-sm font-medium text-foreground mb-1'>
                          Instance <span className='text-destructive'>*</span>
                        </label>
                        <select
                          value={formData.instanceId}
                          onChange={(e) => setFormData({ ...formData, instanceId: e.target.value })}
                          required
                          className='w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary bg-input text-foreground'
                        >
                          <option value=''>Select instance...</option>
                          {instances?.map((instance) => (
                            <option key={instance.id} value={instance.id}>
                              {instance.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className='block text-sm font-medium text-foreground mb-1'>Backup Name (Optional)</label>
                      <input
                        type='text'
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder='Leave empty for auto-generated name'
                        className='w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary bg-input text-foreground placeholder:text-muted-foreground'
                      />
                    </div>
                  </div>
                  <div className='flex gap-3 pt-4'>
                    <button
                      type='button'
                      onClick={() => setIsCreating(false)}
                      className='flex-1 px-4 py-2 border rounded-md hover:bg-muted'
                    >
                      Cancel
                    </button>
                    <button
                      type='submit'
                      className='flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90'
                    >
                      Create Backup
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Backups List */}
            <div className='bg-card border rounded-lg overflow-hidden'>
              <table className='w-full'>
                <thead className='bg-muted'>
                  <tr>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Name</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Type</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Size</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Created</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Created By</th>
                    <th className='px-6 py-3 text-right text-sm font-medium'>Actions</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan={6} className='px-6 py-8 text-center text-muted-foreground'>
                        No backups found. Create your first backup to get started.
                      </td>
                    </tr>
                  ) : (
                    backups.map((backup) => (
                      <tr key={backup.id} className='hover:bg-muted/50'>
                        <td className='px-6 py-4 font-medium'>{backup.name}</td>
                        <td className='px-6 py-4'>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getTypeColor(
                              backup.type
                            )}`}
                          >
                            {getTypeIcon(backup.type)}
                            {backup.type}
                          </span>
                        </td>
                        <td className='px-6 py-4 text-sm'>{formatBytes(backup.size)}</td>
                        <td className='px-6 py-4 text-sm text-muted-foreground'>
                          {format(new Date(backup.createdAt), 'MMM d, yyyy HH:mm')}
                        </td>
                        <td className='px-6 py-4 text-sm text-muted-foreground'>{backup.user.username}</td>
                        <td className='px-6 py-4'>
                          <div className='flex items-center justify-end gap-2'>
                            <button
                              onClick={() => handlePreviewRestore(backup.id)}
                              className='text-primary hover:text-primary/80'
                              title='Preview restore'
                            >
                              <Eye className='w-4 h-4' />
                            </button>
                            {user?.role === 'admin' && (
                              <button
                                onClick={() => handleRestore(backup.id, backup.instanceId)}
                                className='text-blue-600 hover:text-blue-800'
                                title='Restore backup'
                              >
                                <RotateCcw className='w-4 h-4' />
                              </button>
                            )}
                            {user?.role === 'admin' && (
                              <button
                                onClick={() => handleDelete(backup.id)}
                                className='text-red-600 hover:text-red-800'
                                title='Delete backup'
                              >
                                <Trash2 className='w-4 h-4' />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Schedules Tab */}
        {activeTab === 'schedules' && (
          <>
            {/* Create Schedule Form */}
            {isCreatingSchedule && (
              <div className='bg-card border rounded-lg p-6 mb-6'>
                <h2 className='text-xl font-semibold mb-4'>Create Backup Schedule</h2>
                <form onSubmit={handleCreateSchedule} className='space-y-4'>
                  <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                    <div>
                      <label className='block text-sm font-medium text-foreground mb-1'>
                        Instance <span className='text-destructive'>*</span>
                      </label>
                      <select
                        value={scheduleFormData.instanceId}
                        onChange={(e) => setScheduleFormData({ ...scheduleFormData, instanceId: e.target.value })}
                        required
                        className='w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary bg-input text-foreground'
                      >
                        <option value=''>Select instance...</option>
                        {instances?.map((instance) => (
                          <option key={instance.id} value={instance.id}>
                            {instance.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className='block text-sm font-medium text-foreground mb-1'>Schedule (Cron)</label>
                      <select
                        value={scheduleFormData.cronSchedule}
                        onChange={(e) => setScheduleFormData({ ...scheduleFormData, cronSchedule: e.target.value })}
                        className='w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary bg-input text-foreground'
                      >
                        <option value='0 2 * * *'>Daily at 02:00</option>
                        <option value='0 3 * * 0'>Weekly on Sunday at 03:00</option>
                        <option value='0 4 1 * *'>Monthly on 1st at 04:00</option>
                      </select>
                    </div>
                    <div>
                      <label className='block text-sm font-medium text-foreground mb-1'>Retention (days)</label>
                      <input
                        type='number'
                        value={scheduleFormData.retention}
                        onChange={(e) =>
                          setScheduleFormData({ ...scheduleFormData, retention: parseInt(e.target.value) })
                        }
                        min='1'
                        max='365'
                        className='w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary bg-input text-foreground'
                      />
                    </div>
                    <div>
                      <label className='block text-sm font-medium text-foreground mb-1'>Backup Type</label>
                      <select
                        value={scheduleFormData.type}
                        onChange={(e) => setScheduleFormData({ ...scheduleFormData, type: e.target.value })}
                        className='w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary bg-input text-foreground'
                      >
                        <option value='full'>Full Backup</option>
                        <option value='database'>Database Only</option>
                      </select>
                    </div>
                  </div>
                  <div className='flex gap-3 pt-4'>
                    <button
                      type='button'
                      onClick={() => setIsCreatingSchedule(false)}
                      className='flex-1 px-4 py-2 border rounded-md hover:bg-muted'
                    >
                      Cancel
                    </button>
                    <button
                      type='submit'
                      className='flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90'
                    >
                      Create Schedule
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Schedules List */}
            <div className='bg-card border rounded-lg overflow-hidden'>
              <table className='w-full'>
                <thead className='bg-muted'>
                  <tr>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Instance</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Schedule</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Type</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Retention</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Last Run</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Status</th>
                    <th className='px-6 py-3 text-right text-sm font-medium'>Actions</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {schedules.length === 0 ? (
                    <tr>
                      <td colSpan={7} className='px-6 py-8 text-center text-muted-foreground'>
                        No backup schedules configured. Create a schedule for automatic backups.
                      </td>
                    </tr>
                  ) : (
                    schedules.map((schedule) => (
                      <tr key={schedule.id} className='hover:bg-muted/50'>
                        <td className='px-6 py-4 font-medium'>{schedule.instanceId}</td>
                        <td className='px-6 py-4'>
                          <div className='flex items-center gap-2'>
                            <Clock className='w-4 h-4 text-muted-foreground' />
                            {parseCronToReadable(schedule.cronSchedule)}
                          </div>
                        </td>
                        <td className='px-6 py-4'>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getTypeColor(
                              schedule.type
                            )}`}
                          >
                            {getTypeIcon(schedule.type)}
                            {schedule.type}
                          </span>
                        </td>
                        <td className='px-6 py-4 text-sm'>{schedule.retention} days</td>
                        <td className='px-6 py-4 text-sm text-muted-foreground'>
                          {schedule.lastRun ? format(new Date(schedule.lastRun), 'MMM d, HH:mm') : 'Never'}
                        </td>
                        <td className='px-6 py-4'>
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                              schedule.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            <Power className='w-3 h-3' />
                            {schedule.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className='px-6 py-4'>
                          <div className='flex items-center justify-end gap-2'>
                            <button
                              onClick={() => handleToggleSchedule(schedule.id, schedule.enabled)}
                              className='text-primary hover:text-primary/80'
                              title={schedule.enabled ? 'Disable' : 'Enable'}
                            >
                              <Power className='w-4 h-4' />
                            </button>
                            <button
                              onClick={() => handleDeleteSchedule(schedule.id)}
                              className='text-red-600 hover:text-red-800'
                              title='Delete schedule'
                            >
                              <Trash2 className='w-4 h-4' />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* Restore Preview Modal */}
      {previewData && (
        <div className='fixed inset-0 bg-black/50 flex items-center justify-center z-50'>
          <div className='bg-card border rounded-lg p-6 w-full max-w-lg'>
            <h2 className='text-xl font-semibold mb-4 flex items-center gap-2'>
              <Eye className='w-5 h-5' />
              Restore Preview
            </h2>
            <div className='space-y-4'>
              <div>
                <label className='text-sm text-muted-foreground'>Backup</label>
                <p className='font-medium'>{previewData.name}</p>
              </div>
              <div>
                <label className='text-sm text-muted-foreground'>Size</label>
                <p className='font-medium'>{formatBytes(previewData.size)}</p>
              </div>
              <div>
                <label className='text-sm text-muted-foreground'>Contents</label>
                <ul className='list-disc list-inside text-sm'>
                  {previewData.contents.database && <li>Database</li>}
                  {previewData.contents.volumes && <li>Volumes</li>}
                  {previewData.contents.config && <li>Configuration</li>}
                </ul>
              </div>
              {previewData.warnings.length > 0 && (
                <div className='bg-yellow-50 border border-yellow-200 rounded-lg p-3'>
                  <p className='text-sm text-yellow-800 font-medium'>Warnings:</p>
                  <ul className='list-disc list-inside text-sm text-yellow-700'>
                    {previewData.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className='flex gap-3 pt-6'>
              <button
                onClick={() => setPreviewData(null)}
                className='flex-1 px-4 py-2 border border-border rounded-md hover:bg-muted'
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(previewData.id, previewData.instanceId)}
                className='flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90'
              >
                Restore Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
