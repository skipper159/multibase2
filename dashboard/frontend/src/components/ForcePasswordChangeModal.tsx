import { FormEvent, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function ForcePasswordChangeModal() {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!user?.mustChangePassword) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (newPassword !== confirmation) {
      setError('The new passwords do not match.');
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Failed to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm'>
      <div className='w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl'>
        <div className='mb-6 flex items-start gap-3'>
          <div className='rounded-xl bg-primary/15 p-3 text-primary'>
            <ShieldCheck className='h-6 w-6' />
          </div>
          <div>
            <h2 className='text-xl font-semibold'>Password change required</h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              For your security, replace the initial administrator password before continuing.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className='space-y-4'>
          <label className='block text-sm font-medium'>
            Current password
            <div className='relative mt-1'>
              <KeyRound className='pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground' />
              <input
                type='password'
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className='w-full rounded-md border border-input bg-background py-2 pl-9 pr-3'
                autoComplete='current-password'
                required
              />
            </div>
          </label>

          <label className='block text-sm font-medium'>
            New password
            <input
              type='password'
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className='mt-1 w-full rounded-md border border-input bg-background px-3 py-2'
              autoComplete='new-password'
              minLength={8}
              required
            />
          </label>

          <label className='block text-sm font-medium'>
            Confirm new password
            <input
              type='password'
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className='mt-1 w-full rounded-md border border-input bg-background px-3 py-2'
              autoComplete='new-password'
              minLength={8}
              required
            />
          </label>

          {error && <p className='text-sm text-destructive'>{error}</p>}

          <button
            type='submit'
            disabled={saving}
            className='flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60'
          >
            {saving && <Loader2 className='h-4 w-4 animate-spin' />}
            Change password
          </button>
        </form>
      </div>
    </div>
  );
}
