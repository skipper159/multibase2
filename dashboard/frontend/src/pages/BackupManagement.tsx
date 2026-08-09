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
  Cloud,
  CheckCircle,
  XCircle,
  Loader2,
  Upload,
  Download,
  FileCode,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useInstancesAll } from '../hooks/useInstances';
import { toast } from 'sonner';
import { format } from 'date-fns';
import PageHeader from '../components/PageHeader';
import ConfirmationModal from '../components/ConfirmationModal';

interface BackupDestination {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

interface BackupUploadStatus {
  id: string;
  destinationId: string;
  status: 'pending' | 'uploading' | 'success' | 'failed';
  error?: string;
  destination: { id: string; name: string; type: string };
}

interface Backup {
  id: string;
  name: string;
  type: 'full' | 'instance' | 'database';
  instanceId?: string;
  size: number;
  path?: string;
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
  const { data: instances } = useInstancesAll();
  const [activeTab, setActiveTab] = useState<Tab>('backups');
  const [backups, setBackups] = useState<Backup[]>([]);
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [destinations, setDestinations] = useState<BackupDestination[]>([]);
  const [uploadStatuses, setUploadStatuses] = useState<Record<string, BackupUploadStatus[]>>({});
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingSchedule, setIsCreatingSchedule] = useState(false);
  const [previewData, setPreviewData] = useState<RestorePreview | null>(null);
  const [selectedDestinations, setSelectedDestinations] = useState<string[]>([]);
  const [selectedBackupIds, setSelectedBackupIds] = useState<string[]>([]);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    variant?: 'danger' | 'warning' | 'info';
    isLoading?: boolean;
    onConfirm: () => Promise<void> | void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
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

  const isAllSelected = backups.length > 0 && selectedBackupIds.length === backups.length;
  const isSomeSelected = selectedBackupIds.length > 0 && selectedBackupIds.length < backups.length;

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedBackupIds([]);
    } else {
      setSelectedBackupIds(backups.map((b) => b.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedBackupIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const fetchBackups = async () => {
    try {
      const response = await fetch(`${API_URL}/api/backups`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setBackups(data);
        setSelectedBackupIds((prev) => prev.filter((id) => data.some((b: Backup) => b.id === id)));
        // Fetch upload statuses for all backups
        const statuses: Record<string, BackupUploadStatus[]> = {};
        await Promise.all(
          data.map(async (b: Backup) => {
            try {
              const r = await fetch(`${API_URL}/api/backups/${b.id}/uploads`, {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include',
              });
              if (r.ok) statuses[b.id] = await r.json();
            } catch {
              // upload status fetch failed for this backup — skip silently
            }
          })
        );
        setUploadStatuses(statuses);
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
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setSchedules(data.schedules || []);
      }
    } catch (error) {
      console.error('Error fetching schedules:', error);
    }
  };

  const fetchDestinations = async () => {
    try {
      const response = await fetch(`${API_URL}/api/backup-destinations`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setDestinations(data.filter((d: BackupDestination) => d.enabled));
      }
    } catch {
      // destination fetch failed — silently ignored, destinations stay empty
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchBackups(), fetchSchedules(), fetchDestinations()]);
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
        credentials: 'include',
        body: JSON.stringify({
          ...formData,
          ...(selectedDestinations.length > 0 && { destinationIds: selectedDestinations }),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create backup');
      }

      toast.success('Backup created successfully');
      setIsCreating(false);
      setFormData({ type: 'full', instanceId: '', name: '' });
      setSelectedDestinations([]);
      fetchBackups();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create backup';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractSql = async (backupId: string) => {
    try {
      const response = await fetch(`${API_URL}/api/backups/${backupId}/extract-sql`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        toast.success(data.message || 'SQL dump extracted for Migrations');
      } else {
        const err = await response.json();
        toast.error(err.error || 'Failed to extract SQL dump');
      }
    } catch {
      toast.error('Failed to extract SQL dump');
    }
  };

  const handleDownloadSql = async (backupId: string, backupName: string) => {
    try {
      const response = await fetch(`${API_URL}/api/backups/${backupId}/download-sql`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to download SQL dump');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${backupName}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download SQL dump');
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
        credentials: 'include',
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
        credentials: 'include',
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

  const handleRestore = (backupId: string, instanceId?: string, backupName?: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Restore Backup',
      message: backupName
        ? `Are you sure you want to restore backup "${backupName}"? This will overwrite existing data.`
        : 'Are you sure you want to restore this backup? This will overwrite existing data.',
      confirmText: 'Restore Now',
      variant: 'warning',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }));
        try {
          const response = await fetch(`${API_URL}/api/backups/${backupId}/restore`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            credentials: 'include',
            body: JSON.stringify({ instanceId }),
          });

          if (!response.ok) {
            throw new Error('Failed to restore backup');
          }

          toast.success('Backup restored successfully');
          setPreviewData(null);
        } catch (error) {
          toast.error('Failed to restore backup');
        } finally {
          setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        }
      },
    });
  };

  const handleDelete = (backup: Backup) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Backup',
      message: `Are you sure you want to delete backup "${backup.name}"? This action cannot be undone.`,
      confirmText: 'Delete Backup',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }));
        try {
          const response = await fetch(`${API_URL}/api/backups/${backup.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
          });

          if (!response.ok) {
            throw new Error('Failed to delete backup');
          }

          toast.success(`Backup "${backup.name}" deleted successfully`);
          setSelectedBackupIds((prev) => prev.filter((id) => id !== backup.id));
          await fetchBackups();
        } catch (error) {
          toast.error('Failed to delete backup');
        } finally {
          setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        }
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedBackupIds.length === 0) return;
    const count = selectedBackupIds.length;
    setConfirmModal({
      isOpen: true,
      title: 'Delete Selected Backups',
      message: `Are you sure you want to delete ${count} selected backup${count > 1 ? 's' : ''}? This action cannot be undone.`,
      confirmText: `Delete ${count} Backup${count > 1 ? 's' : ''}`,
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }));
        let successCount = 0;
        let failCount = 0;

        for (const id of selectedBackupIds) {
          try {
            const response = await fetch(`${API_URL}/api/backups/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
              credentials: 'include',
            });
            if (response.ok) {
              successCount++;
            } else {
              failCount++;
            }
          } catch {
            failCount++;
          }
        }

        if (successCount > 0) {
          toast.success(`Successfully deleted ${successCount} backup${successCount > 1 ? 's' : ''}`);
        }
        if (failCount > 0) {
          toast.error(`Failed to delete ${failCount} backup${failCount > 1 ? 's' : ''}`);
        }

        setSelectedBackupIds([]);
        await fetchBackups();
        setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
      },
    });
  };

  const handleToggleSchedule = async (scheduleId: number, enabled: boolean) => {
    try {
      const response = await fetch(`${API_URL}/api/schedules/${scheduleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
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

  const handleDeleteSchedule = (scheduleId: number) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Schedule',
      message: 'Are you sure you want to delete this backup schedule?',
      confirmText: 'Delete Schedule',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isLoading: true }));
        try {
          const response = await fetch(`${API_URL}/api/schedules/${scheduleId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
            credentials: 'include',
          });

          if (response.ok) {
            toast.success('Schedule deleted');
            await fetchSchedules();
          } else {
            toast.error('Failed to delete schedule');
          }
        } catch (error) {
          toast.error('Failed to delete schedule');
        } finally {
          setConfirmModal((prev) => ({ ...prev, isOpen: false, isLoading: false }));
        }
      },
    });
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
                  {destinations.length > 0 && (
                    <div>
                      <label className='block text-sm font-medium text-foreground mb-2'>
                        <span className='inline-flex items-center gap-1'>
                          <Upload className='w-4 h-4' />
                          Upload to External Destinations (Optional)
                        </span>
                      </label>
                      <div className='flex flex-wrap gap-2'>
                        {destinations.map((dest) => (
                          <label
                            key={dest.id}
                            className='flex items-center gap-2 px-3 py-2 border border-border rounded-md cursor-pointer hover:bg-muted'
                          >
                            <input
                              type='checkbox'
                              checked={selectedDestinations.includes(dest.id)}
                              onChange={(e) =>
                                setSelectedDestinations(
                                  e.target.checked
                                    ? [...selectedDestinations, dest.id]
                                    : selectedDestinations.filter((id) => id !== dest.id)
                                )
                              }
                              className='rounded'
                            />
                            <Cloud className='w-3.5 h-3.5 text-muted-foreground' />
                            <span className='text-sm'>{dest.name}</span>
                            <span className='text-xs text-muted-foreground capitalize'>({dest.type})</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
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

            {/* Bulk Selection Bar */}
            {user?.role === 'admin' && selectedBackupIds.length > 0 && (
              <div className='flex items-center justify-between bg-destructive/10 border border-destructive/20 rounded-lg p-3 mb-4 animate-in fade-in duration-150'>
                <div className='flex items-center gap-2 text-sm font-medium text-destructive'>
                  <CheckCircle className='w-4 h-4' />
                  <span>{selectedBackupIds.length} backup(s) selected</span>
                </div>
                <div className='flex items-center gap-2'>
                  <button
                    onClick={() => setSelectedBackupIds([])}
                    className='px-3 py-1.5 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors'
                  >
                    Deselect All
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    className='flex items-center gap-1.5 px-3 py-1.5 bg-destructive text-white text-xs font-medium rounded-md hover:bg-destructive/90 transition-colors'
                  >
                    <Trash2 className='w-3.5 h-3.5' />
                    Delete Selected ({selectedBackupIds.length})
                  </button>
                </div>
              </div>
            )}

            {/* Backups List */}
            <div className='bg-card border rounded-lg overflow-hidden'>
              <table className='w-full'>
                <thead className='bg-muted'>
                  <tr>
                    {user?.role === 'admin' && (
                      <th className='w-10 px-4 py-3 text-left'>
                        <input
                          type='checkbox'
                          checked={isAllSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = isSomeSelected;
                          }}
                          onChange={toggleSelectAll}
                          className='rounded border-border text-primary focus:ring-primary cursor-pointer'
                          title='Select all backups'
                        />
                      </th>
                    )}
                    <th className='px-6 py-3 text-left text-sm font-medium'>Name</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Type</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Size</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Created</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Created By</th>
                    <th className='px-6 py-3 text-left text-sm font-medium'>Uploads</th>
                    <th className='px-6 py-3 text-right text-sm font-medium'>Actions</th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {backups.length === 0 ? (
                    <tr>
                      <td colSpan={user?.role === 'admin' ? 8 : 7} className='px-6 py-8 text-center text-muted-foreground'>
                        No backups found. Create your first backup to get started.
                      </td>
                    </tr>
                  ) : (
                    backups.map((backup) => (
                      <tr
                        key={backup.id}
                        className={`hover:bg-muted/50 transition-colors ${
                          selectedBackupIds.includes(backup.id) ? 'bg-primary/5' : ''
                        }`}
                      >
                        {user?.role === 'admin' && (
                          <td className='w-10 px-4 py-4'>
                            <input
                              type='checkbox'
                              checked={selectedBackupIds.includes(backup.id)}
                              onChange={() => toggleSelectOne(backup.id)}
                              className='rounded border-border text-primary focus:ring-primary cursor-pointer'
                            />
                          </td>
                        )}
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
                          {uploadStatuses[backup.id] && uploadStatuses[backup.id].length > 0 ? (
                            <div className='flex flex-wrap gap-1'>
                              {uploadStatuses[backup.id].map((u) => (
                                <span
                                  key={u.id}
                                  title={`${u.destination.name}${u.error ? ': ' + u.error : ''}`}
                                  className='inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs border'
                                >
                                  {u.status === 'success' ? (
                                    <CheckCircle className='w-3 h-3 text-green-500' />
                                  ) : u.status === 'failed' ? (
                                    <XCircle className='w-3 h-3 text-red-500' />
                                  ) : (
                                    <Loader2 className='w-3 h-3 animate-spin text-muted-foreground' />
                                  )}
                                  <span className='text-muted-foreground'>{u.destination.name}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className='text-xs text-muted-foreground'>—</span>
                          )}
                        </td>
                        <td className='px-6 py-4'>
                          <div className='flex items-center justify-end gap-2'>
                            <button
                              onClick={() => handleExtractSql(backup.id)}
                              className='text-purple-600 hover:text-purple-800'
                              title='Extract SQL dump (for Migrations)'
                            >
                              <FileCode className='w-4 h-4' />
                            </button>
                            <button
                              onClick={() => handleDownloadSql(backup.id, backup.name)}
                              className='text-emerald-600 hover:text-emerald-800'
                              title='Download raw .sql file'
                            >
                              <Download className='w-4 h-4' />
                            </button>
                            <button
                              onClick={() => handlePreviewRestore(backup.id)}
                              className='text-primary hover:text-primary/80'
                              title='Preview restore'
                            >
                              <Eye className='w-4 h-4' />
                            </button>
                            {user?.role === 'admin' && (
                              <button
                                onClick={() => handleRestore(backup.id, backup.instanceId, backup.name)}
                                className='text-blue-600 hover:text-blue-800'
                                title='Restore backup'
                              >
                                <RotateCcw className='w-4 h-4' />
                              </button>
                            )}
                            {user?.role === 'admin' && (
                              <button
                                onClick={() => handleDelete(backup)}
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
              {previewData.path && (
                <div>
                  <label className='text-sm text-muted-foreground'>Server location</label>
                  <p className='break-all font-mono text-xs'>{previewData.path}</p>
                </div>
              )}
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
              <div className='rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800'>
                <p className='font-medium'>Restore procedure</p>
                <p className='mt-1'>Select Restore Now below. Restoration requires an administrator and overwrites the affected current data.</p>
              </div>
            </div>
            <div className='flex gap-3 pt-6'>
              <button
                onClick={() => setPreviewData(null)}
                className='flex-1 px-4 py-2 border border-border rounded-md hover:bg-muted'
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(previewData.id, previewData.instanceId, previewData.name)}
                className='flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90'
              >
                Restore Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        confirmText={confirmModal.confirmText}
        variant={confirmModal.variant}
        isLoading={confirmModal.isLoading}
        onConfirm={confirmModal.onConfirm}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
