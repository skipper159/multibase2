import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const { login, loginWith2FA, requires2FA } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Get redirect URL and reason from query params
  const redirectUrl = searchParams.get('redirect');
  const reason = searchParams.get('reason');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (requires2FA) {
        await loginWith2FA(email, password, twoFactorCode);
        toast.success('Login successful!');

        // Redirect to the original URL if provided
        if (redirectUrl) {
          window.location.href = redirectUrl;
        } else {
          navigate('/Workspace'); // Default post-login page
        }
      } else {
        await login(email, password);
        // If 2FA is required, requires2FA will become true via context, causing re-render
        if (!requires2FA) {
          // If still false (no 2FA needed), redirect
          if (redirectUrl) {
            window.location.href = redirectUrl;
          } else {
            navigate('/workspace');
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Redirect if logged in (except when just switched to 2FA mode)
  /* useEffect(() => {
     // ...
  }, [isAuthenticated, requires2FA]); */
  // NOTE: AuthContext handles user state. We just react to requires2FA.

  return (
    <div className='min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden'>
      {/* Animated Background */}
      <div className='absolute inset-0 -z-10 overflow-hidden'>
        <div className='absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-gradient-to-br from-primary/20 to-transparent rounded-full blur-3xl animate-pulse' />
        <div className='absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-gradient-to-tl from-accent/20 to-transparent rounded-full blur-3xl animate-pulse delay-1000' />
      </div>
      <div className='max-w-md w-full'>
        {/* Logo/Header */}
        <div className='text-center mb-8'>
          <div className='flex justify-center mb-4'>
            <img src='/logo.png' alt='Multibase Logo' className='h-16 w-auto' />
          </div>
          <h1 className='text-3xl font-bold text-foreground'>Multibase Dashboard</h1>
          <p className='text-muted-foreground mt-2'>
            {requires2FA ? 'Enter your 2FA code' : 'Sign in to manage your Supabase instances'}
          </p>
        </div>

        {/* Login Form */}
        <div className='glass-card p-8'>
          <form onSubmit={handleSubmit} className='space-y-6'>
            {error && (
              <div className='bg-destructive/10 border border-destructive/20 rounded-md p-4 flex items-start gap-3'>
                <AlertCircle className='w-5 h-5 text-destructive flex-shrink-0 mt-0.5' />
                <p className='text-sm text-destructive'>{error}</p>
              </div>
            )}

            {reason === 'auth_required' && (
              <div className='mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md'>
                <p className='text-sm text-yellow-800'>Please log in to access this Supabase instance.</p>
              </div>
            )}

            {reason === 'access_denied' && (
              <div className='mb-4 p-3 bg-red-50 border border-red-200 rounded-md'>
                <p className='text-sm text-red-800'>Access denied. Please log in with appropriate permissions.</p>
              </div>
            )}

            {requires2FA ? (
              <div>
                <label htmlFor='2fa' className='block text-sm font-medium text-foreground mb-2'>
                  Two-Factor Authentication Code
                </label>
                <input
                  id='2fa'
                  type='text'
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  required
                  className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground text-center tracking-widest text-lg'
                  placeholder='000 000'
                  disabled={isLoading}
                  autoFocus
                  maxLength={6}
                />
                <p className='text-xs text-muted-foreground mt-2 text-center'>
                  Open your authenticator app to view your code.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor='email' className='block text-sm font-medium text-foreground mb-2'>
                    Email
                  </label>
                  <input
                    id='email'
                    type='email'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground'
                    placeholder='admin@multibase.local'
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label htmlFor='password' className='block text-sm font-medium text-foreground mb-2'>
                    Password
                  </label>
                  <input
                    id='password'
                    type='password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground'
                    placeholder='Enter your password'
                    disabled={isLoading}
                  />
                </div>

                <div className='flex items-center justify-between text-sm'>
                  <Link to='/forgot-password' className='text-primary hover:underline font-medium'>
                    Forgot password?
                  </Link>
                </div>
              </>
            )}

            <button
              type='submit'
              disabled={isLoading}
              className='w-full btn-primary flex items-center justify-center gap-2 px-4 py-3 font-medium'
            >
              {isLoading ? (
                <>
                  <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-white'></div>
                  {requires2FA ? 'Verifying...' : 'Signing in...'}
                </>
              ) : (
                <>
                  <LogIn className='w-5 h-5' />
                  {requires2FA ? 'Verify Code' : 'Sign In'}
                </>
              )}
            </button>
          </form>

          <div className='mt-6 pt-6 border-t border-border text-center'>
            <p className='text-sm text-muted-foreground'>
              Don't have an account?{' '}
              <Link to='/register' className='text-primary hover:underline font-medium'>
                Sign up
              </Link>
            </p>
          </div>

          {/* Info */}
        </div>

        {/* Footer */}
        <div className='text-center mt-6 text-sm text-muted-foreground'>
          <p>Multibase Dashboard · Manage your Supabase instances</p>
        </div>
      </div>
    </div>
  );
}
