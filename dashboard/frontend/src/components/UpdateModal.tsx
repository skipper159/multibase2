import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Loader2,
  X,
} from 'lucide-react';
import type { UpdateLiveState } from '../hooks/useUpdates';

interface UpdateConfirmationModalProps {
  open: boolean;
  title: string;
  description: string;
  targets: string[];
  warning?: string;
  requiresText?: string;
  onCancel: () => void;
  onConfirm: () => void;
  isSubmitting?: boolean;
}

export function UpdateConfirmationModal({
  open,
  title,
  description,
  targets,
  warning,
  requiresText,
  onCancel,
  onConfirm,
  isSubmitting = false,
}: UpdateConfirmationModalProps) {
  const [confirmationText, setConfirmationText] = useState('');

  useEffect(() => {
    if (open) setConfirmationText('');
  }, [open]);

  if (!open) return null;

  const canConfirm = !requiresText || confirmationText.trim() === requiresText;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'>
      <div className='w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl'>
        <div className='flex items-start justify-between gap-4 border-b border-border p-6'>
          <div>
            <h2 className='text-xl font-semibold'>{title}</h2>
            <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
          </div>
          <button type='button' onClick={onCancel} className='rounded-md p-1 hover:bg-muted' aria-label='Close'>
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='space-y-4 p-6'>
          <div>
            <p className='mb-2 text-sm font-medium'>Target services</p>
            <div className='flex flex-wrap gap-2'>
              {targets.map((target) => (
                <span key={target} className='rounded bg-muted px-2 py-1 font-mono text-xs'>
                  {target}
                </span>
              ))}
            </div>
          </div>

          <div className='flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200'>
            <AlertTriangle className='mt-0.5 h-4 w-4 flex-shrink-0' />
            <div>
              {warning || 'A full backup will be created before the update. Short downtime may occur.'}
            </div>
          </div>

          {requiresText && (
            <label className='block text-sm'>
              <span className='mb-1 block text-muted-foreground'>Type <strong>{requiresText}</strong> to continue</span>
              <input
                value={confirmationText}
                onChange={(event) => setConfirmationText(event.target.value)}
                className='w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm'
                autoFocus
              />
            </label>
          )}
        </div>

        <div className='flex justify-end gap-3 border-t border-border p-6'>
          <button type='button' onClick={onCancel} disabled={isSubmitting} className='rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50'>
            Cancel
          </button>
          <button
            type='button'
            onClick={onConfirm}
            disabled={!canConfirm || isSubmitting}
            className='inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isSubmitting && <Loader2 className='h-4 w-4 animate-spin' />}
            {isSubmitting ? 'Starting...' : 'Start Update'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface UpdateProgressModalProps {
  open: boolean;
  state: UpdateLiveState;
  onClose: () => void;
}

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

export function UpdateProgressModal({ open, state, onClose }: UpdateProgressModalProps) {
  if (!open) return null;

  const progress = state.completed
    ? 100
    : state.steps.length > 0
      ? Math.round((state.currentStep / state.steps.length) * 100)
      : 0;
  const overallLabel = state.isRunning
    ? 'Running...'
    : state.error
      ? 'Stopped with an error'
      : state.outcome === 'partial'
        ? 'Completed with errors'
        : state.outcome === 'failed'
          ? 'Failed'
          : 'Completed';

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4'>
      <div className='flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-2xl'>
        <div className='flex items-center justify-between border-b border-border p-6'>
          <div>
            <h2 className='text-xl font-semibold'>Update progress</h2>
            <p className='mt-1 text-sm text-muted-foreground'>The update is being executed manually.</p>
          </div>
          <button type='button' onClick={onClose} disabled={state.isRunning} className='rounded-md p-1 hover:bg-muted disabled:opacity-30' aria-label='Close'>
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='space-y-5 overflow-y-auto p-6'>
          <div>
            <div className='mb-2 flex justify-between text-sm'>
              <span>{overallLabel}</span>
              <span>{progress}%</span>
            </div>
            <div className='h-2 overflow-hidden rounded-full bg-muted'>
              <div className={`h-full transition-all ${state.error ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${progress}%` }} />
            </div>
          </div>

          {state.steps.length > 0 && (
            <div className='grid gap-2 sm:grid-cols-2'>
              {state.steps.map((step, index) => {
                const result = state.serviceResults[step] ?? Object.values(state.serviceResults)
                  .find((entry) => step.endsWith(`/${entry.service}`));
                const finished = Boolean(result) || state.completed || index < state.currentStep;
                const active = !result && state.isRunning && index === state.currentStep;
                const failed = result?.status === 'rollback_failed';
                const reverted = result?.status === 'rolled_back';
                const rollbackSucceeded = reverted && state.mode === 'rollback';
                const skipped = result?.status === 'skipped';
                const resultLabel = result
                  ? result.status === 'updated'
                    ? 'Updated'
                    : result.status === 'rolled_back'
                      ? 'Rolled back'
                      : result.status === 'rollback_failed'
                        ? 'Rollback failed'
                        : 'Skipped'
                  : null;
                return (
                  <div key={`${step}-${index}`} className='flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm'>
                    {failed || (reverted && !rollbackSucceeded) || skipped
                      ? <AlertTriangle className={`h-4 w-4 ${failed ? 'text-red-500' : 'text-amber-500'}`} />
                      : finished
                        ? <CheckCircle2 className='h-4 w-4 text-green-500' />
                        : active
                          ? <Loader2 className='h-4 w-4 animate-spin text-primary' />
                          : <span className='h-4 w-4 rounded-full border text-center text-[10px]'>{index + 1}</span>}
                    <span className={active ? 'font-medium' : 'text-muted-foreground'}>
                      {step}{resultLabel ? ` — ${resultLabel}` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {state.backup && (
            <div className='rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm'>
              <p className='font-medium text-blue-200'>Backup created before the update</p>
              <dl className='mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr] sm:gap-x-3'>
                <dt>Backup</dt><dd className='font-mono text-foreground'>{state.backup.name}</dd>
                <dt>Size</dt><dd>{formatBytes(state.backup.size)}</dd>
                <dt>Location</dt><dd className='break-all font-mono text-foreground'>{state.backup.path}</dd>
                <dt>ID</dt><dd className='font-mono'>{state.backup.id}</dd>
              </dl>
              <p className='mt-3 text-xs text-muted-foreground'>
                To restore it later, open Backup &amp; Restore, select this backup, choose Preview, then Restore Now. Restore requires an administrator and overwrites current data.
              </p>
              <Link to='/backups' className='mt-2 inline-block text-xs text-primary hover:underline'>
                Open Backup &amp; Restore
              </Link>
              <button type='button' onClick={() => navigator.clipboard?.writeText(state.backup?.path || '')} className='mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline'>
                <Clipboard className='h-3 w-3' /> Copy backup path
              </button>
            </div>
          )}

          <div className='max-h-48 overflow-y-auto rounded-lg bg-black/50 p-4 font-mono text-xs'>
            {state.logs.map((entry, index) => <div key={`${entry.ts}-${index}`} className='leading-relaxed text-green-300/90'>{entry.line}</div>)}
            {state.error && <div className='mt-2 text-red-400'>{state.error}</div>}
          </div>
        </div>

        <div className='flex justify-end border-t border-border p-6'>
          <button type='button' onClick={onClose} disabled={state.isRunning} className='rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'>
            {state.isRunning ? 'Update running...' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
