import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const { verifyEmail } = useAuth();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No verification token provided.');
      return;
    }

    const verify = async () => {
      try {
        await verifyEmail(token);
        setStatus('success');
        setTimeout(() => {
          navigate('/?login=true');
        }, 3000);
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Verification failed');
      }
    };

    verify();
  }, [token, verifyEmail, navigate]);

  return (
    <div className='min-h-screen bg-background flex items-center justify-center p-4'>
      <div className='max-w-md w-full bg-card border border-border rounded-lg p-8 text-center'>
        {status === 'verifying' && (
          <div className='flex flex-col items-center gap-4'>
            <Loader2 className='w-12 h-12 text-primary animate-spin' />
            <h2 className='text-xl font-semibold'>Verifying Email...</h2>
          </div>
        )}
        {status === 'success' && (
          <div className='flex flex-col items-center gap-4'>
            <CheckCircle className='w-12 h-12 text-green-500' />
            <h2 className='text-xl font-semibold'>Email Verified!</h2>
            <p className='text-muted-foreground'>Redirecting to login...</p>
          </div>
        )}
        {status === 'error' && (
          <div className='flex flex-col items-center gap-4'>
            <AlertCircle className='w-12 h-12 text-destructive' />
            <h2 className='text-xl font-semibold'>Verification Failed</h2>
            <p className='text-destructive'>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
