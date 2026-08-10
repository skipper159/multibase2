import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  User,
  Key,
  Monitor,
  LogOut,
  Clock,
  Globe,
  ArrowLeft,
  Camera,
  X,
  Shield,
  ShieldCheck,
  ShieldOff,
  Edit2,
  Save,
  Loader2,
  AlertCircle,
  Bot,
  Settings,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import PageHeader from '../components/PageHeader';
import AiKeySection from '../components/AiKeySection';

type ProfileTab = 'profile' | 'security' | 'ai' | 'account' | 'admin';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

interface TwoFASetupData {
  secret: string;
  qrCodeDataUrl: string;
  otpauthUrl: string;
}

export default function UserProfile() {
  const { user, token, refreshUser, isAdmin } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>('profile');

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Avatar state
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFASetupData, setTwoFASetupData] = useState<TwoFASetupData | null>(null);
  const [twoFACode, setTwoFACode] = useState('');
  const [twoFALoading, setTwoFALoading] = useState(false);
  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  // Delete Account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Admin feature settings
  const [feedbackEnabled, setFeedbackEnabled] = useState(true);
  const [savingFeatures, setSavingFeatures] = useState(false);

  const { deleteAccount } = useAuth();

  // Fetch sessions and 2FA status
  useEffect(() => {
    if (user && token) {
      fetchSessions();
      fetch2FAStatus();
      setEditUsername(user.username || '');
      setEditEmail(user.email || '');
    }
    if (isAdmin) {
      fetch(`${API_URL}/api/settings/public`)
        .then((r) => r.json())
        .then((d) => setFeedbackEnabled(d.feedbackEnabled ?? true))
        .catch(() => {});
    }
  }, [user, token, isAdmin]);

  const fetchSessions = async () => {
    if (!user || !token) return;
    try {
      const response = await fetch(`${API_URL}/api/auth/users/${user.id}/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setSessions(data.sessions || []);
      }
    } catch (error) {
      console.error('Error fetching sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetch2FAStatus = async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}/api/auth/2fa/status`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setTwoFactorEnabled(data.enabled);
      }
    } catch (error) {
      console.error('Error fetching 2FA status:', error);
    }
  };

  // Terminate session
  const handleTerminateSession = async (sessionId: string) => {
    if (!user || !token) return;
    try {
      const response = await fetch(`${API_URL}/api/auth/users/${user.id}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (response.ok) {
        toast.success('Session terminated');
        setSessions(sessions.filter((s) => s.id !== sessionId));
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to terminate session');
      }
    } catch (error) {
      toast.error('Network error');
    }
  };

  // Change password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setChangingPassword(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (response.ok) {
        toast.success('Password changed successfully');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to change password');
      }
    } catch (error) {
      toast.error('Network error');
    } finally {
      setChangingPassword(false);
    }
  };

  // Update profile
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUsername.trim()) {
      toast.error('Username is required');
      return;
    }
    setSavingProfile(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          username: editUsername.trim(),
          email: editEmail.trim() || undefined,
        }),
      });
      if (response.ok) {
        toast.success('Profile updated');
        setEditingProfile(false);
        refreshUser?.();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to update profile');
      }
    } catch (error) {
      toast.error('Network error');
    } finally {
      setSavingProfile(false);
    }
  };

  // Avatar upload
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    setAvatarUploading(true);
    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const response = await fetch(`${API_URL}/api/auth/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: formData,
      });
      if (response.ok) {
        toast.success('Avatar updated');
        refreshUser?.();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to upload avatar');
      }
    } catch (error) {
      toast.error('Network error');
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Remove avatar
  const handleRemoveAvatar = async () => {
    setAvatarUploading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/avatar`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (response.ok) {
        toast.success('Avatar removed');
        refreshUser?.();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to remove avatar');
      }
    } catch (error) {
      toast.error('Network error');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Enable 2FA
  const handleEnable2FA = async () => {
    setTwoFALoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/2fa/enable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setTwoFASetupData(data);
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to enable 2FA');
      }
    } catch (error) {
      toast.error('Network error');
    } finally {
      setTwoFALoading(false);
    }
  };

  // Verify 2FA
  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (twoFACode.length !== 6) {
      toast.error('Please enter a 6-digit code');
      return;
    }
    setTwoFALoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/2fa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ code: twoFACode }),
      });
      if (response.ok) {
        toast.success('2FA enabled successfully!');
        setTwoFactorEnabled(true);
        setTwoFASetupData(null);
        setTwoFACode('');
      } else {
        const data = await response.json();
        toast.error(data.error || 'Invalid code');
      }
    } catch (error) {
      toast.error('Network error');
    } finally {
      setTwoFALoading(false);
    }
  };

  // Delete Account
  const handleDeleteAccount = async () => {
    if (!deletePassword) return;
    setIsDeleting(true);
    try {
      await deleteAccount(deletePassword);
      toast.success('Account deleted successfully');
      // Auth context handles logout
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete account';
      toast.error(message);
      setIsDeleting(false); // Only stop loading on error, success redirects
    }
  };

  // Turn off 2FA state loading (fix for unmounted component issue potentially, but mostly cleanup)

  // Disable 2FA
  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disableCode.length !== 6) {
      toast.error('Please enter a 6-digit code');
      return;
    }
    setTwoFALoading(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/2fa/disable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        body: JSON.stringify({ code: disableCode }),
      });
      if (response.ok) {
        toast.success('2FA disabled');
        setTwoFactorEnabled(false);
        setShowDisable2FA(false);
        setDisableCode('');
      } else {
        const data = await response.json();
        toast.error(data.error || 'Invalid code');
      }
    } catch (error) {
      toast.error('Network error');
    } finally {
      setTwoFALoading(false);
    }
  };

  // Save admin feature settings
  const handleSaveFeatures = async () => {
    setSavingFeatures(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/features`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ feedbackEnabled }),
      });
      if (res.ok) {
        toast.success('Feature settings saved');
      } else {
        toast.error('Failed to save settings');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSavingFeatures(false);
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Parse user agent
  const parseUserAgent = (ua: string | null | undefined) => {
    const value = ua ?? '';

    if (value.includes('Edg')) return 'Edge';
    if (value.includes('Chrome')) return 'Chrome';
    if (value.includes('Firefox')) return 'Firefox';
    if (value.includes('Safari')) return 'Safari';
    return 'Unknown Browser';
  };

  // Get initials for avatar placeholder
  const getInitials = () => {
    const name = user?.username || user?.email || 'U';
    return name.charAt(0).toUpperCase();
  };

  // Get full avatar URL
  const getAvatarUrl = (avatar: string | undefined) => {
    if (!avatar) return null;
    // If already absolute URL, return as-is
    if (avatar.startsWith('http://') || avatar.startsWith('https://')) {
      return avatar;
    }
    // Prepend API URL for relative paths
    return `${API_URL}${avatar}`;
  };

  return (
    <div className='min-h-screen bg-background'>
      <PageHeader>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-4'>
            <Link
              to='/'
              className='flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors'
            >
              <ArrowLeft className='w-5 h-5' />
              Back to Dashboard
            </Link>
          </div>
        </div>
      </PageHeader>

      <main className='container mx-auto px-6 py-8'>
        <div className='max-w-4xl mx-auto'>
          {/* Page Title */}
          <div className='flex items-center gap-3 mb-6'>
            <div className='w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center'>
              <User className='w-6 h-6 text-primary' />
            </div>
            <div>
              <h1 className='text-2xl font-bold text-foreground'>My Profile</h1>
              <p className='text-muted-foreground'>Manage your account settings and security</p>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className='flex gap-1 mb-6 bg-card/50 border border-border rounded-xl p-1'>
            {[
              { id: 'profile' as ProfileTab, label: 'Profile', icon: User },
              { id: 'security' as ProfileTab, label: 'Security', icon: Shield },
              { id: 'ai' as ProfileTab, label: 'AI Assistant', icon: Bot },
              { id: 'account' as ProfileTab, label: 'Account', icon: AlertCircle },
              ...(isAdmin ? [{ id: 'admin' as ProfileTab, label: 'Admin Settings', icon: Settings }] : []),
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-1 justify-center ${
                  activeTab === tab.id
                    ? 'bg-primary/10 text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card'
                }`}
              >
                <tab.icon className='w-4 h-4' />
                <span className='hidden sm:inline'>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className='space-y-6'>
            {/* ===== PROFILE TAB ===== */}
            {activeTab === 'profile' && (
              <>
                {/* Avatar & Profile Card */}
                <div className='bg-card border border-border rounded-lg p-6'>
                  <div className='flex items-start gap-6'>
                    {/* Avatar */}
                    <div className='relative group'>
                      {user?.avatar ? (
                        <img
                          src={getAvatarUrl(user.avatar) || ''}
                          alt='Avatar'
                          className='w-24 h-24 rounded-full object-cover border-2 border-border'
                        />
                      ) : (
                        <div className='w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center text-3xl font-bold text-primary border-2 border-border'>
                          {getInitials()}
                        </div>
                      )}
                      <div className='absolute inset-0 bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2'>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={avatarUploading}
                          className='p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors'
                          title='Upload avatar'
                        >
                          {avatarUploading ? (
                            <Loader2 className='w-4 h-4 text-white animate-spin' />
                          ) : (
                            <Camera className='w-4 h-4 text-white' />
                          )}
                        </button>
                        {user?.avatar && (
                          <button
                            onClick={handleRemoveAvatar}
                            disabled={avatarUploading}
                            className='p-2 bg-white/20 rounded-full hover:bg-white/30 transition-colors'
                            title='Remove avatar'
                          >
                            <X className='w-4 h-4 text-white' />
                          </button>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type='file'
                        accept='image/*'
                        onChange={handleAvatarUpload}
                        className='hidden'
                      />
                    </div>

                    {/* Profile Info */}
                    <div className='flex-1'>
                      <div className='flex items-center justify-between mb-4'>
                        <h2 className='text-lg font-semibold text-foreground flex items-center gap-2'>
                          <User className='w-5 h-5 text-primary' />
                          User Information
                        </h2>
                        {!editingProfile && (
                          <button
                            onClick={() => setEditingProfile(true)}
                            className='flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors'
                          >
                            <Edit2 className='w-4 h-4' />
                            Edit
                          </button>
                        )}
                      </div>

                      {editingProfile ? (
                        <form onSubmit={handleUpdateProfile} className='space-y-4'>
                          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                            <div>
                              <label className='block text-sm text-muted-foreground mb-1'>Username</label>
                              <input
                                type='text'
                                value={editUsername}
                                onChange={(e) => setEditUsername(e.target.value)}
                                className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                                required
                              />
                            </div>
                            <div>
                              <label className='block text-sm text-muted-foreground mb-1'>Email</label>
                              <input
                                type='email'
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                              />
                            </div>
                          </div>
                          <div className='flex gap-2'>
                            <button
                              type='submit'
                              disabled={savingProfile}
                              className='px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2'
                            >
                              {savingProfile ? (
                                <Loader2 className='w-4 h-4 animate-spin' />
                              ) : (
                                <Save className='w-4 h-4' />
                              )}
                              Save
                            </button>
                            <button
                              type='button'
                              onClick={() => {
                                setEditingProfile(false);
                                setEditUsername(user?.username || '');
                                setEditEmail(user?.email || '');
                              }}
                              className='px-4 py-2 bg-secondary text-foreground rounded-md hover:bg-secondary/80'
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
                          <div>
                            <label className='text-sm text-muted-foreground'>Username</label>
                            <p className='text-foreground font-medium'>{user?.username}</p>
                          </div>
                          <div>
                            <label className='text-sm text-muted-foreground'>Email</label>
                            <p className='text-foreground font-medium'>{user?.email}</p>
                          </div>
                          <div>
                            <label className='text-sm text-muted-foreground'>Role</label>
                            <p className='text-foreground font-medium capitalize'>{user?.role}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ===== SECURITY TAB ===== */}
            {activeTab === 'security' && (
              <>
                {/* Two-Factor Authentication Card */}
                <div className='bg-card border border-border rounded-lg p-6'>
                  <h2 className='text-lg font-semibold text-foreground mb-4 flex items-center gap-2'>
                    <Shield className='w-5 h-5 text-purple-500' />
                    Two-Factor Authentication
                    {twoFactorEnabled && (
                      <span className='ml-2 px-2 py-0.5 bg-green-500/20 text-green-500 text-xs rounded-full'>
                        Enabled
                      </span>
                    )}
                  </h2>

                  {!twoFactorEnabled && !twoFASetupData && (
                    <div className='text-muted-foreground mb-4'>
                      <p>Add an extra layer of security to your account by enabling 2FA.</p>
                      <p className='text-sm mt-1'>
                        You'll need an authenticator app like Google Authenticator or Authy.
                      </p>
                    </div>
                  )}

                  {twoFASetupData ? (
                    <div className='space-y-4'>
                      <div className='bg-secondary/50 rounded-lg p-4'>
                        <p className='text-sm text-muted-foreground mb-4'>
                          Scan the QR code with your authenticator app, then enter the 6-digit code below.
                        </p>
                        <div className='flex flex-col md:flex-row items-center gap-6'>
                          <img
                            src={twoFASetupData.qrCodeDataUrl}
                            alt='2FA QR Code'
                            className='w-48 h-48 bg-white rounded-lg p-2'
                          />
                          <div className='flex-1'>
                            <p className='text-sm text-muted-foreground mb-2'>Or enter this secret manually:</p>
                            <code className='block bg-background p-2 rounded text-sm font-mono break-all'>
                              {twoFASetupData.secret}
                            </code>
                          </div>
                        </div>
                      </div>
                      <form onSubmit={handleVerify2FA} className='flex gap-2'>
                        <input
                          type='text'
                          value={twoFACode}
                          onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder='Enter 6-digit code'
                          className='flex-1 bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-center text-lg tracking-widest'
                          maxLength={6}
                        />
                        <button
                          type='submit'
                          disabled={twoFALoading || twoFACode.length !== 6}
                          className='px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center gap-2'
                        >
                          {twoFALoading ? (
                            <Loader2 className='w-4 h-4 animate-spin' />
                          ) : (
                            <ShieldCheck className='w-4 h-4' />
                          )}
                          Verify
                        </button>
                        <button
                          type='button'
                          onClick={() => {
                            setTwoFASetupData(null);
                            setTwoFACode('');
                          }}
                          className='px-4 py-2 bg-secondary text-foreground rounded-md hover:bg-secondary/80'
                        >
                          Cancel
                        </button>
                      </form>
                    </div>
                  ) : twoFactorEnabled ? (
                    <div>
                      {showDisable2FA ? (
                        <form onSubmit={handleDisable2FA} className='space-y-4'>
                          <p className='text-sm text-muted-foreground'>
                            Enter your 2FA code to disable two-factor authentication.
                          </p>
                          <div className='flex gap-2'>
                            <input
                              type='text'
                              value={disableCode}
                              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              placeholder='Enter 6-digit code'
                              className='flex-1 bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono text-center text-lg tracking-widest'
                              maxLength={6}
                            />
                            <button
                              type='submit'
                              disabled={twoFALoading || disableCode.length !== 6}
                              className='px-6 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50 flex items-center gap-2'
                            >
                              {twoFALoading ? (
                                <Loader2 className='w-4 h-4 animate-spin' />
                              ) : (
                                <ShieldOff className='w-4 h-4' />
                              )}
                              Disable
                            </button>
                            <button
                              type='button'
                              onClick={() => {
                                setShowDisable2FA(false);
                                setDisableCode('');
                              }}
                              className='px-4 py-2 bg-secondary text-foreground rounded-md hover:bg-secondary/80'
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className='flex items-center justify-between'>
                          <p className='text-green-500 flex items-center gap-2'>
                            <ShieldCheck className='w-5 h-5' />
                            Two-factor authentication is enabled
                          </p>
                          <button
                            onClick={() => setShowDisable2FA(true)}
                            className='px-4 py-2 text-destructive hover:bg-destructive/10 rounded-md transition-colors'
                          >
                            Disable 2FA
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={handleEnable2FA}
                      disabled={twoFALoading}
                      className='px-6 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2'
                    >
                      {twoFALoading ? <Loader2 className='w-4 h-4 animate-spin' /> : <Shield className='w-4 h-4' />}
                      Enable Two-Factor Authentication
                    </button>
                  )}
                </div>

                {/* Password Change Card */}
                <div className='bg-card border border-border rounded-lg p-6'>
                  <h2 className='text-lg font-semibold text-foreground mb-4 flex items-center gap-2'>
                    <Key className='w-5 h-5 text-yellow-500' />
                    Change Password
                  </h2>
                  <form onSubmit={handleChangePassword} className='space-y-4'>
                    <div>
                      <label className='block text-sm text-muted-foreground mb-1'>Current Password</label>
                      <input
                        type='password'
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                        placeholder='••••••••'
                        required
                      />
                    </div>
                    <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                      <div>
                        <label className='block text-sm text-muted-foreground mb-1'>New Password</label>
                        <input
                          type='password'
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                          placeholder='••••••••'
                          required
                        />
                      </div>
                      <div>
                        <label className='block text-sm text-muted-foreground mb-1'>Confirm Password</label>
                        <input
                          type='password'
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                          placeholder='••••••••'
                          required
                        />
                      </div>
                    </div>
                    <button
                      type='submit'
                      disabled={changingPassword}
                      className='px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors'
                    >
                      {changingPassword ? 'Saving...' : 'Change Password'}
                    </button>
                  </form>
                </div>

                {/* Active Sessions Card */}
                <div className='bg-card border border-border rounded-lg p-6'>
                  <h2 className='text-lg font-semibold text-foreground mb-4 flex items-center gap-2'>
                    <Monitor className='w-5 h-5 text-green-500' />
                    Active Sessions ({sessions.length})
                  </h2>

                  {loading ? (
                    <div className='text-muted-foreground'>Loading...</div>
                  ) : sessions.length === 0 ? (
                    <div className='text-muted-foreground'>No active sessions found</div>
                  ) : (
                    <div className='space-y-3'>
                      {sessions.map((session) => (
                        <div
                          key={session.id}
                          className='flex items-center justify-between bg-secondary/50 border border-border rounded-lg p-4'
                        >
                          <div className='flex items-center gap-4'>
                            <div className='w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center'>
                              <Globe className='w-5 h-5 text-primary' />
                            </div>
                            <div>
                              <p className='text-foreground font-medium'>{parseUserAgent(session.userAgent)}</p>
                              <div className='flex items-center gap-3 text-sm text-muted-foreground'>
                                <span className='flex items-center gap-1'>
                                  <Globe className='w-3 h-3' />
                                  {session.ipAddress || 'Unknown IP'}
                                </span>
                                <span className='flex items-center gap-1'>
                                  <Clock className='w-3 h-3' />
                                  {formatDate(session.createdAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => handleTerminateSession(session.id)}
                            className='flex items-center gap-2 text-destructive hover:text-destructive/80 hover:bg-destructive/10 px-3 py-2 rounded-md transition-colors'
                            title='Terminate session'
                          >
                            <LogOut className='w-4 h-4' />
                            <span className='hidden sm:inline'>End</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ===== AI ASSISTANT TAB ===== */}
            {activeTab === 'ai' && (
              <div className='bg-card border border-border rounded-lg p-6'>
                <div className='flex items-center gap-3 mb-6'>
                  <div className='w-10 h-10 bg-purple-500/10 rounded-full flex items-center justify-center'>
                    <Bot className='w-5 h-5 text-purple-400' />
                  </div>
                  <div>
                    <h2 className='text-lg font-semibold text-foreground'>AI Assistant Configuration</h2>
                    <p className='text-sm text-muted-foreground'>
                      Configure your AI provider and model to use the chat assistant
                    </p>
                  </div>
                </div>
                <AiKeySection />
              </div>
            )}

            {/* ===== ACCOUNT TAB ===== */}
            {activeTab === 'account' && (
              <div className='bg-destructive/5 border border-destructive/20 rounded-lg p-6'>
                <h2 className='text-lg font-semibold text-destructive mb-4 flex items-center gap-2'>
                  <AlertCircle className='w-5 h-5' />
                  Danger Zone
                </h2>
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-foreground font-medium'>Delete Account</p>
                    <p className='text-sm text-muted-foreground'>
                      Permanently delete your account and all associated data. This action cannot be undone.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className='px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors'
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            )}
            {/* ===== ADMIN SETTINGS TAB ===== */}
            {activeTab === 'admin' && isAdmin && (
              <div className='bg-card border border-border rounded-lg p-6'>
                <div className='flex items-center gap-3 mb-6'>
                  <div className='w-10 h-10 bg-orange-500/10 rounded-full flex items-center justify-center'>
                    <Settings className='w-5 h-5 text-orange-400' />
                  </div>
                  <div>
                    <h2 className='text-lg font-semibold text-foreground'>Admin Settings</h2>
                    <p className='text-sm text-muted-foreground'>Global feature flags for all users</p>
                  </div>
                </div>

                <div className='space-y-4'>
                  {/* Feedback toggle */}
                  <div className='flex items-center justify-between p-4 bg-secondary/40 border border-border rounded-lg'>
                    <div className='flex items-center gap-3'>
                      <MessageSquare className='w-5 h-5 text-violet-400 flex-shrink-0' />
                      <div>
                        <p className='text-sm font-medium text-foreground'>Feedback / Feature Requests</p>
                        <p className='text-xs text-muted-foreground'>
                          Shows the Feedback button on the landing page and enables the /feedback route.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setFeedbackEnabled((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-violet-500 ${
                        feedbackEnabled ? 'bg-violet-500' : 'bg-secondary border border-border'
                      }`}
                      role='switch'
                      aria-checked={feedbackEnabled}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          feedbackEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <div className='mt-6 flex justify-end'>
                  <button
                    onClick={handleSaveFeatures}
                    disabled={savingFeatures}
                    className='px-5 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 transition-colors'
                  >
                    {savingFeatures ? <Loader2 className='w-4 h-4 animate-spin' /> : <Save className='w-4 h-4' />}
                    Save Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Delete Account Modal */}
      {showDeleteModal && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
          <div className='bg-card border border-border rounded-lg max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200'>
            <div className='flex items-start gap-4'>
              <div className='w-10 h-10 bg-destructive/10 rounded-full flex items-center justify-center flex-shrink-0'>
                <AlertCircle className='w-5 h-5 text-destructive' />
              </div>
              <div>
                <h3 className='text-lg font-semibold text-foreground'>Delete Account</h3>
                <p className='text-muted-foreground'>
                  Are you sure you want to delete your account? This action is permanent and will remove all your data.
                </p>
              </div>
            </div>

            <div className='pt-4'>
              <label className='block text-sm font-medium text-foreground mb-2'>Enter your password to confirm</label>
              <input
                type='password'
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-destructive text-foreground placeholder:text-muted-foreground'
                placeholder='Enter password'
              />
            </div>

            <div className='flex justify-end gap-2 pt-4'>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeletePassword('');
                }}
                className='px-4 py-2 bg-secondary text-foreground rounded-md hover:bg-secondary/80'
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={!deletePassword || isDeleting}
                className='px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 disabled:opacity-50 flex items-center gap-2'
              >
                {isDeleting ? <Loader2 className='w-4 h-4 animate-spin' /> : null}
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
