import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Database, Plus, Trash2, RotateCcw, ArrowLeft, HardDrive, Server } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useInstances } from '../hooks/useInstances';
import { toast } from 'sonner';
import { format } from 'date-fns';

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

export default function BackupManagement() {
  const { token, user } = useAuth();
  const { data: instances } = useInstances();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    type: 'full' as 'full' | 'instance' | 'database',
    instanceId: '',
    name: '',
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
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

  if (loading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-primary'></div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-background'>
      {/* Header */}
      <header className='border-b bg-card'>
        <div className='container mx-auto px-6 py-4'>
          <div className='flex items-center justify-between'>
            <div>
              <Link to='/' className='inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-2'>
                <ArrowLeft className='w-4 h-4' />
                Back to Dashboard
              </Link>
              <h1 className='text-3xl font-bold text-foreground flex items-center gap-2'>
                <Database className='w-8 h-8' />
                Backup & Restore
              </h1>
              <p className='text-muted-foreground mt-1'>Create and manage backups of your instances</p>
            </div>
            <button
              onClick={() => setIsCreating(!isCreating)}
              className='flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors'
            >
              <Plus className='w-4 h-4' />
              {isCreating ? 'Cancel' : 'Create Backup'}
            </button>
          </div>
        </div>
      </header>

      <main className='container mx-auto px-6 py-8'>
        {/* Create Form */}
        {isCreating && (
          <div className='bg-card border rounded-lg p-6 mb-6'>
            <h2 className='text-xl font-semibold mb-4'>Create New Backup</h2>
            <form onSubmit={handleCreateBackup} className='space-y-4'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium mb-1'>
                    Backup Type <span className='text-red-500'>*</span>
                  </label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any, instanceId: '' })}
                    className='w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-primary'
                  >
                    <option value='full'>Full Backup (All Data)</option>
                    <option value='instance'>Instance Backup</option>
                    <option value='database'>Database Only</option>
                  </select>
                </div>
                {formData.type === 'instance' && (
                  <div>
                    <label className='block text-sm font-medium mb-1'>
                      Instance <span className='text-red-500'>*</span>
                    </label>
                    <select
                      value={formData.instanceId}
                      onChange={(e) => setFormData({ ...formData, instanceId: e.target.value })}
                      required
                      className='w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-primary'
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
                  <label className='block text-sm font-medium mb-1'>Backup Name (Optional)</label>
                  <input
                    type='text'
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder='Leave empty for auto-generated name'
                    className='w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-primary'
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
                <button type='submit' className='flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90'>
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
      </main>
    </div>
  );
}
