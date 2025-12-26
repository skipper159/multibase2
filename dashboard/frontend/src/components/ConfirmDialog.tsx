import { X, AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const variantStyles = {
    danger: {
      icon: 'text-destructive',
      button: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    },
    warning: {
      icon: 'text-yellow-500',
      button: 'bg-yellow-500 text-white hover:bg-yellow-600',
    },
    default: {
      icon: 'text-primary',
      button: 'bg-primary text-primary-foreground hover:bg-primary/90',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div className='fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4'>
      <div className='bg-card border border-border rounded-lg shadow-lg w-full max-w-md'>
        <div className='flex items-center justify-between p-4 border-b border-border'>
          <div className='flex items-center gap-3'>
            <AlertTriangle className={`w-5 h-5 ${styles.icon}`} />
            <h2 className='text-lg font-semibold'>{title}</h2>
          </div>
          <button onClick={onCancel} className='p-1 hover:bg-secondary rounded-md transition-colors'>
            <X className='w-5 h-5' />
          </button>
        </div>

        <div className='p-6'>
          <p className='text-muted-foreground'>{message}</p>
        </div>

        <div className='flex justify-end gap-3 p-4 border-t border-border bg-secondary/10 rounded-b-lg'>
          <button
            onClick={onCancel}
            className='px-4 py-2 text-sm font-medium hover:bg-secondary rounded-md transition-colors'
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${styles.button}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
