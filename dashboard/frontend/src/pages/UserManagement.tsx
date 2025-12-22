import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Trash2, Shield, Eye, User as UserIcon, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';

interface User {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'user' | 'viewer';
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export default function UserManagement() {
  const { token } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    role: 'user' as 'admin' | 'user' | 'viewer',
  });

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  // Fetch users
  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_URL}/api/auth/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create user');
      }

      toast.success('User created successfully');
      setIsCreating(false);
      setFormData({ email: '', username: '', password: '', role: 'user' });
      fetchUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create user';
      toast.error(message);
    }
  };

  const handleDelete = async (userId: string) => {
    if (!window.confirm('Are you sure you want to delete this user?')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error('Failed to delete user');
      }

      toast.success('User deleted successfully');
      fetchUsers();
    } catch (error) {
      toast.error('Failed to delete user');
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <Shield className='w-4 h-4' />;
      case 'user':
        return <UserIcon className='w-4 h-4' />;
      case 'viewer':
        return <Eye className='w-4 h-4' />;
      default:
        return null;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-red-100 text-red-700 border-red-200';
      case 'user':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'viewer':
        return 'bg-gray-100 text-gray-700 border-gray-200';
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
                <Users className='w-8 h-8' />
                User Management
              </h1>
              <p className='text-muted-foreground mt-1'>Manage dashboard users and permissions</p>
            </div>
            <button
              onClick={() => setIsCreating(!isCreating)}
              className='flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors'
            >
              <Plus className='w-4 h-4' />
              {isCreating ? 'Cancel' : 'Add User'}
            </button>
          </div>
        </div>
      </header>

      <main className='container mx-auto px-6 py-8'>
        {/* Create Form */}
        {isCreating && (
          <div className='bg-card border rounded-lg p-6 mb-6'>
            <h2 className='text-xl font-semibold mb-4'>Create New User</h2>
            <form onSubmit={handleSubmit} className='space-y-4'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                <div>
                  <label className='block text-sm font-medium mb-1'>
                    Email <span className='text-red-500'>*</span>
                  </label>
                  <input
                    type='email'
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                    className='w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-primary'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium mb-1'>
                    Username <span className='text-red-500'>*</span>
                  </label>
                  <input
                    type='text'
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    required
                    className='w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-primary'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium mb-1'>
                    Password <span className='text-red-500'>*</span>
                  </label>
                  <input
                    type='password'
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    required
                    className='w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-primary'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium mb-1'>
                    Role <span className='text-red-500'>*</span>
                  </label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                    className='w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-primary'
                  >
                    <option value='viewer'>Viewer</option>
                    <option value='user'>User</option>
                    <option value='admin'>Admin</option>
                  </select>
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
                  Create User
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Users List */}
        <div className='bg-card border rounded-lg overflow-hidden'>
          <table className='w-full'>
            <thead className='bg-muted'>
              <tr>
                <th className='px-6 py-3 text-left text-sm font-medium'>User</th>
                <th className='px-6 py-3 text-left text-sm font-medium'>Role</th>
                <th className='px-6 py-3 text-left text-sm font-medium'>Status</th>
                <th className='px-6 py-3 text-left text-sm font-medium'>Last Login</th>
                <th className='px-6 py-3 text-right text-sm font-medium'>Actions</th>
              </tr>
            </thead>
            <tbody className='divide-y'>
              {users.map((user) => (
                <tr key={user.id} className='hover:bg-muted/50'>
                  <td className='px-6 py-4'>
                    <div>
                      <div className='font-medium'>{user.username}</div>
                      <div className='text-sm text-muted-foreground'>{user.email}</div>
                    </div>
                  </td>
                  <td className='px-6 py-4'>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border ${getRoleColor(
                        user.role
                      )}`}
                    >
                      {getRoleIcon(user.role)}
                      {user.role}
                    </span>
                  </td>
                  <td className='px-6 py-4'>
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className='px-6 py-4 text-sm text-muted-foreground'>
                    {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
                  </td>
                  <td className='px-6 py-4 text-right'>
                    <button
                      onClick={() => handleDelete(user.id)}
                      className='text-red-600 hover:text-red-800'
                      title='Delete user'
                    >
                      <Trash2 className='w-4 h-4' />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
