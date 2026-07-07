import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogIn, UserPlus, Key, AlertCircle, X, Loader2, Mail, ArrowLeft, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type AuthView = 'login' | 'register' | 'forgot';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialView?: AuthView;
}

interface CaptchaData {
  token: string;
  svg: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function AuthModal({ isOpen, onClose, initialView = 'login' }: AuthModalProps) {
  const [view, setView] = useState<AuthView>(initialView);

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  // Register state
  const [username, setUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  
  // Captcha state
  const [captcha, setCaptcha] = useState<CaptchaData | null>(null);
  const [captchaSolution, setCaptchaSolution] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);

  const { login, loginWith2FA, requires2FA, pending2FAEmail, register, forgotPassword, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Fetch captcha function
  const fetchCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    setCaptchaSolution('');
    try {
      const res = await fetch(`${API_URL}/api/auth/captcha`);
      if (!res.ok) throw new Error('Failed to load captcha');
      const data: CaptchaData = await res.json();
      setCaptcha(data);
    } catch {
      toast.error('Captcha konnte nicht geladen werden.');
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  // Fetch captcha when modal opens on register view, or when view switches to register
  useEffect(() => {
    if (isOpen && view === 'register') {
      fetchCaptcha();
    }
  }, [isOpen, view, fetchCaptcha]);

  // Handle successful login navigation (when user becomes authenticated without 2FA pending)
  useEffect(() => {
    if (isAuthenticated && isOpen && !requires2FA) {
      toast.success('Login successful!');
      handleClose();
      navigate('/workspace');
    }
  }, [isAuthenticated, isOpen, requires2FA]);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setUsername('');
    setConfirmPassword('');
    setTwoFactorCode('');
    setWebsite('');
    setCaptcha(null);
    setCaptchaSolution('');
    setError('');
    setForgotSuccess(false);
    setRegisterSuccess(false);
  };

  const switchView = (newView: AuthView) => {
    resetForm();
    setView(newView);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Login handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (requires2FA) {
        // Use pending2FAEmail from context if available, otherwise use local state
        const loginEmail = pending2FAEmail || email;
        await loginWith2FA(loginEmail, password, twoFactorCode);
        toast.success('Login successful!');
        handleClose();
        navigate('/workspace');
      } else {
        await login(email, password);
        // After login() call, check if 2FA is now required
        // If requires2FA became true, we don't navigate - the component will re-render showing 2FA input
        // Note: requires2FA state is updated by AuthContext, not returned from login()
        // We need to check the current state after login() completes
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  // Register handler
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

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
      setError('Bitte warte, bis das Captcha geladen ist.');
      return;
    }
    if (!captchaSolution.trim()) {
      setError('Bitte löse das Captcha.');
      return;
    }

    setIsLoading(true);

    try {
      // Pass the captcha details. The website honeypot is passed automatically via state.
      // AuthContext will include it in the POST request body.
      await register(email, username, password, captcha.token, captchaSolution);
      setRegisterSuccess(true);
      toast.success('Registration successful! Please verify your email.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      setError(message);
      // Refresh captcha on failed attempt
      fetchCaptcha();
    } finally {
      setIsLoading(false);
    }
  };

  // Forgot password handler
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await forgotPassword(email);
      setForgotSuccess(true);
      toast.success('Reset email sent if account exists.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send reset email';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto'>
      {/* Backdrop */}
      <div className='fixed inset-0 bg-black/60 backdrop-blur-sm' onClick={handleClose} />

      {/* Modal */}
      <div className='glass-modal w-full max-w-md p-6 sm:p-8 relative animate-in fade-in zoom-in-95 duration-200 my-8'>
        {/* Close button */}
        <button
          onClick={handleClose}
          className='absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 transition-colors'
        >
          <X className='w-5 h-5' />
        </button>

        {/* Logo */}
        <div className='text-center mb-6'>
          <img src='/logo.png' alt='Multibase' className='h-12 w-auto mx-auto mb-3' />
          <h2 className='text-xl font-bold text-foreground'>
            {view === 'login' && (requires2FA ? 'Two-Factor Authentication' : 'Welcome back')}
            {view === 'register' && (registerSuccess ? 'Check your email' : 'Create an account')}
            {view === 'forgot' && (forgotSuccess ? 'Check your email' : 'Reset password')}
          </h2>
        </div>

        {/* Error */}
        {error && (
          <div className='bg-destructive/10 border border-destructive/20 rounded-md p-3 mb-4 flex items-start gap-2'>
            <AlertCircle className='w-4 h-4 text-destructive flex-shrink-0 mt-0.5' />
            <p className='text-sm text-destructive'>{error}</p>
          </div>
        )}

        {/* Register Success */}
        {registerSuccess && (
          <div className='text-center'>
            <div className='w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4'>
              <Mail className='w-8 h-8 text-green-500' />
            </div>
            <p className='text-muted-foreground mb-6'>
              We've sent a verification email to <strong>{email}</strong>. Please check your inbox.
            </p>
            <button onClick={() => switchView('login')} className='btn-primary px-6 py-2'>
              Return to Login
            </button>
          </div>
        )}

        {/* Forgot Success */}
        {forgotSuccess && (
          <div className='text-center'>
            <div className='w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4'>
              <Mail className='w-8 h-8 text-blue-500' />
            </div>
            <p className='text-muted-foreground mb-6'>
              If an account exists for <strong>{email}</strong>, we've sent password reset instructions.
            </p>
            <button
              onClick={() => switchView('login')}
              className='text-primary hover:underline flex items-center justify-center gap-2 mx-auto'
            >
              <ArrowLeft className='w-4 h-4' />
              Back to Login
            </button>
          </div>
        )}

        {/* Login Form */}
        {view === 'login' && !registerSuccess && (
          <form onSubmit={handleLogin} className='space-y-4'>
            {requires2FA ? (
              <div>
                <label className='block text-sm font-medium text-foreground mb-2'>2FA Code</label>
                <input
                  type='text'
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  required
                  className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground text-center tracking-widest text-lg'
                  placeholder='000 000'
                  maxLength={6}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div>
                  <label className='block text-sm font-medium text-foreground mb-2'>Email</label>
                  <input
                    type='email'
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground'
                    placeholder='admin@multibase.local'
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium text-foreground mb-2'>Password</label>
                  <input
                    type='password'
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground'
                    placeholder='••••••••'
                  />
                </div>
                <div className='text-right'>
                  <button
                    type='button'
                    onClick={() => switchView('forgot')}
                    className='text-sm text-primary hover:underline'
                  >
                    Forgot password?
                  </button>
                </div>
              </>
            )}

            <button
              type='submit'
              disabled={isLoading}
              className='w-full btn-primary flex items-center justify-center gap-2 py-3'
            >
              {isLoading ? <Loader2 className='w-5 h-5 animate-spin' /> : <LogIn className='w-5 h-5' />}
              {requires2FA ? 'Verify Code' : 'Sign In'}
            </button>

            <p className='text-center text-sm text-muted-foreground pt-2'>
              Don't have an account?{' '}
              <button
                type='button'
                onClick={() => switchView('register')}
                className='text-primary hover:underline font-medium'
              >
                Sign up
              </button>
            </p>
          </form>
        )}

        {/* Register Form */}
        {view === 'register' && !registerSuccess && (
          <form onSubmit={handleRegister} className='space-y-4'>
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
              <label className='block text-sm font-medium text-foreground mb-2'>Username</label>
              <input
                type='text'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground'
                placeholder='jdoe'
              />
            </div>
            <div>
              <label className='block text-sm font-medium text-foreground mb-2'>Email</label>
              <input
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground'
                placeholder='john@example.com'
              />
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <div>
                <label className='block text-sm font-medium text-foreground mb-2'>Password</label>
                <input
                  type='password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground'
                  placeholder='••••••••'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-foreground mb-2'>Confirm</label>
                <input
                  type='password'
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground'
                  placeholder='••••••••'
                />
              </div>
            </div>
            <div className='text-xs text-muted-foreground bg-secondary/50 rounded-md p-2 space-y-0.5'>
              <p className={password.length >= 8 ? 'text-green-500' : ''}>• 8+ characters</p>
              <p className={/[A-Z]/.test(password) ? 'text-green-500' : ''}>• Uppercase letter</p>
              <p className={/[a-z]/.test(password) ? 'text-green-500' : ''}>• Lowercase letter</p>
              <p className={/[0-9]/.test(password) ? 'text-green-500' : ''}>• Number</p>
              <p className={/[^a-zA-Z0-9]/.test(password) ? 'text-green-500' : ''}>• Special character</p>
            </div>

            {/* ── Math Captcha ── */}
            <div className='space-y-2 pt-1'>
              <label className='block text-sm font-medium text-foreground'>
                Sicherheitsfrage <span className='text-xs text-muted-foreground'>(Bitte berechnen)</span>
              </label>
              
              <div className='flex items-center gap-2'>
                {/* SVG display */}
                <div className='flex-1 rounded-md overflow-hidden border border-border bg-[#1e1e2e] flex items-center justify-center h-[50px]'>
                  {captchaLoading ? (
                    <Loader2 className='w-4 h-4 animate-spin text-muted-foreground' />
                  ) : captcha ? (
                    <span 
                      dangerouslySetInnerHTML={{ __html: captcha.svg }} 
                      className='block' 
                      style={{ transform: 'scale(0.85)', transformOrigin: 'center' }}
                    />
                  ) : (
                    <span className='text-xs text-muted-foreground'>Fehler beim Laden</span>
                  )}
                </div>

                {/* Refresh button */}
                <button
                  type='button'
                  onClick={fetchCaptcha}
                  disabled={captchaLoading || isLoading}
                  title='Neue Aufgabe laden'
                  className='p-2.5 rounded-md border border-border bg-secondary hover:bg-secondary/80 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 h-[50px] w-[50px] flex items-center justify-center'
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
              className='w-full btn-primary flex items-center justify-center gap-2 py-3 mt-2'
            >
              {isLoading ? <Loader2 className='w-5 h-5 animate-spin' /> : <UserPlus className='w-5 h-5' />}
              Sign Up
            </button>

            <p className='text-center text-sm text-muted-foreground pt-2'>
              Already have an account?{' '}
              <button
                type='button'
                onClick={() => switchView('login')}
                className='text-primary hover:underline font-medium'
              >
                Sign in
              </button>
            </p>
          </form>
        )}

        {/* Forgot Password Form */}
        {view === 'forgot' && !forgotSuccess && (
          <form onSubmit={handleForgotPassword} className='space-y-4'>
            <p className='text-sm text-muted-foreground mb-4'>
              Enter your email and we'll send you a link to reset your password.
            </p>
            <div>
              <label className='block text-sm font-medium text-foreground mb-2'>Email</label>
              <input
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className='w-full px-4 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground'
                placeholder='john@example.com'
              />
            </div>

            <button
              type='submit'
              disabled={isLoading}
              className='w-full btn-primary flex items-center justify-center gap-2 py-3'
            >
              {isLoading ? <Loader2 className='w-5 h-5 animate-spin' /> : <Key className='w-5 h-5' />}
              Send Reset Link
            </button>

            <button
              type='button'
              onClick={() => switchView('login')}
              className='w-full text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-2 pt-2'
            >
              <ArrowLeft className='w-4 h-4' />
              Back to Login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
