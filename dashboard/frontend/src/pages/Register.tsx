import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { UserPlus, AlertCircle, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface CaptchaData {
  token: string;
  svg: string;
}

export default function Register() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Honeypot — never shown to users, bots fill it
  const [website, setWebsite] = useState('');
  // Captcha state
  const [captcha, setCaptcha] = useState<CaptchaData | null>(null);
  const [captchaSolution, setCaptchaSolution] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);

  const { register } = useAuth();

  const fetchCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaSolution('');
    try {
      const res = await fetch(`${API_URL}/api/auth/captcha`);
      if (!res.ok) throw new Error('Failed to load captcha');
      const data: CaptchaData = await res.json();
      setCaptcha(data);
    } catch {
      toast.error('Could not load the captcha. Please reload the page.');
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  // Load captcha on mount
  useEffect(() => {
    fetchCaptcha();
  }, [fetchCaptcha]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Password complexity validation
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError('Password must contain at least one uppercase letter');
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError('Password must contain at least one lowercase letter');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setError('Password must contain at least one number');
      return;
    }
    if (!/[^a-zA-Z0-9]/.test(password)) {
      setError('Password must contain at least one special character');
      return;
    }

    if (!captcha) {
      setError('Please wait until the captcha has loaded.');
      return;
    }
    if (!captchaSolution.trim()) {
      setError('Please solve the captcha.');
      return;
    }

    setIsLoading(true);

    try {
      await register(email, username, password, captcha.token, captchaSolution);
      setIsSuccess(true);
      toast.success('Registration successful! Please verify your email.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      toast.error(message);
      // Always refresh captcha after a failed attempt
      fetchCaptcha();
    } finally {
      setIsLoading(false);
    }
  };

  if (isSuccess) {
    return (
      <div className='min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden'>
        {/* Animated Background */}
        <div className='absolute inset-0 -z-10 overflow-hidden'>
          <div className='absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-gradient-to-br from-primary/20 to-transparent rounded-full blur-3xl animate-pulse' />
          <div className='absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-gradient-to-tl from-accent/20 to-transparent rounded-full blur-3xl animate-pulse delay-1000' />
        </div>
        <div className='max-w-md w-full glass-card p-8 text-center'>
          <div className='w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6'>
            <UserPlus className='w-8 h-8 text-green-500' />
          </div>
          <h2 className='text-2xl font-bold text-foreground mb-4'>Registration Successful!</h2>
          <p className='text-muted-foreground mb-8'>
            We've sent a verification email to <strong>{email}</strong>. Please check your inbox and click the
            verification link to activate your account.
          </p>
          <Link
            to='/login'
            className='inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-white font-medium rounded-md hover:bg-primary/90 transition-colors'
          >
            Return to Login
            <ArrowRight className='w-4 h-4' />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden'>
      {/* Animated Background */}
      <div className='absolute inset-0 -z-10 overflow-hidden'>
        <div className='absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-gradient-to-br from-primary/20 to-transparent rounded-full blur-3xl animate-pulse' />
        <div className='absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-gradient-to-tl from-accent/20 to-transparent rounded-full blur-3xl animate-pulse delay-1000' />
      </div>
      <div className='max-w-md w-full'>
        {/* Header */}
        <div className='text-center mb-8'>
          <h1 className='text-3xl font-bold text-foreground'>Create an Account</h1>
          <p className='text-muted-foreground mt-2'>Join Multibase to manage your instances</p>
        </div>

        {/* Register Form */}
        <div className='glass-card p-8'>
          <form onSubmit={handleSubmit} className='space-y-6'>
            {error && (
              <div className='bg-destructive/10 border border-destructive/20 rounded-md p-4 flex items-start gap-3'>
                <AlertCircle className='w-5 h-5 text-destructive flex-shrink-0 mt-0.5' />
                <p className='text-sm text-destructive'>{error}</p>
              </div>
            )}

            {/* Honeypot field — visually hidden, never filled by real users */}
            <div
              aria-hidden='true'
              style={{
                position: 'absolute',
                left: '-9999px',
                width: '1px',
                height: '1px',
                overflow: 'hidden',
                opacity: 0,
                pointerEvents: 'none',
              }}
            >
              <label htmlFor='website'>Website</label>
              <input
                id='website'
                name='website'
                type='text'
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete='off'
              />
            </div>

            <div>
              <label htmlFor='username' className='block text-sm font-medium text-foreground mb-2'>
                Username
              </label>
              <input
                id='username'
                type='text'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground'
                placeholder='jdoe'
                disabled={isLoading}
              />
            </div>

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
                placeholder='john@example.com'
                disabled={isLoading}
              />
            </div>

            <div className='grid grid-cols-2 gap-4'>
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
                  placeholder='••••••••'
                  disabled={isLoading}
                />
              </div>
              <div>
                <label htmlFor='confirmPassword' className='block text-sm font-medium text-foreground mb-2'>
                  Confirm
                </label>
                <input
                  id='confirmPassword'
                  type='password'
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground'
                  placeholder='••••••••'
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* Password Requirements */}
            <div className='text-xs text-muted-foreground space-y-1 bg-muted/50 rounded-md p-3'>
              <p className='font-medium text-foreground mb-1'>Password requirements:</p>
              <ul className='list-disc list-inside space-y-0.5'>
                <li className={password.length >= 8 ? 'text-green-500' : ''}>At least 8 characters</li>
                <li className={/[A-Z]/.test(password) ? 'text-green-500' : ''}>One uppercase letter (A-Z)</li>
                <li className={/[a-z]/.test(password) ? 'text-green-500' : ''}>One lowercase letter (a-z)</li>
                <li className={/[0-9]/.test(password) ? 'text-green-500' : ''}>One number (0-9)</li>
                <li className={/[^a-zA-Z0-9]/.test(password) ? 'text-green-500' : ''}>
                  One special character (!@#$...)
                </li>
              </ul>
            </div>

            {/* ── Math Captcha ── */}
            <div className='space-y-3'>
              <label className='block text-sm font-medium text-foreground'>
                Sicherheitsfrage
                <span className='ml-1 text-xs text-muted-foreground'>(Please calculate)</span>
              </label>

              <div className='flex items-center gap-3'>
                {/* SVG challenge */}
                <div className='flex-1 rounded-lg overflow-hidden border border-border bg-[#1e1e2e] flex items-center justify-center h-[60px]'>
                  {captchaLoading ? (
                    <Loader2 className='w-5 h-5 animate-spin text-muted-foreground' />
                  ) : captcha ? (
                    <span
                      dangerouslySetInnerHTML={{ __html: captcha.svg }}
                      aria-label='Captcha challenge'
                    />
                  ) : (
                    <span className='text-xs text-muted-foreground'>Captcha unavailable</span>
                  )}
                </div>

                {/* Refresh button */}
                <button
                  type='button'
                  onClick={fetchCaptcha}
                  disabled={captchaLoading || isLoading}
                  title='Load new challenge'
                  className='p-2 rounded-md border border-border bg-muted hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50'
                >
                  <RefreshCw className={`w-4 h-4 ${captchaLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <input
                id='captchaSolution'
                type='text'
                inputMode='numeric'
                value={captchaSolution}
                onChange={(e) => setCaptchaSolution(e.target.value)}
                required
                placeholder='Ergebnis eingeben…'
                autoComplete='off'
                disabled={isLoading || captchaLoading}
                className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground placeholder:text-muted-foreground'
              />
            </div>

            <button
              type='submit'
              disabled={isLoading || captchaLoading || !captcha}
              className='w-full btn-primary flex items-center justify-center gap-2 px-4 py-3 font-medium'
            >
              {isLoading ? (
                <>
                  <Loader2 className='w-5 h-5 animate-spin' />
                  Creating Account...
                </>
              ) : (
                <>
                  <UserPlus className='w-5 h-5' />
                  Sign Up
                </>
              )}
            </button>
          </form>

          <div className='mt-6 pt-6 border-t border-border text-center'>
            <p className='text-sm text-muted-foreground'>
              Already have an account?{' '}
              <Link to='/login' className='text-primary hover:underline font-medium'>
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
