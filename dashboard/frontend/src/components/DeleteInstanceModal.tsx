import { useState } from 'react';
import { Trash2, AlertTriangle, X } from 'lucide-react';
import type { SupabaseInstance } from '../types';

interface DeleteInstanceModalProps {
  instance: SupabaseInstance;
  open: boolean;
  onClose: () => void;
  onConfirm: (removeVolumes: boolean) => void;
}

export default function DeleteInstanceModal({
  instance,
  open,
  onClose,
  onConfirm,
}: DeleteInstanceModalProps) {
  const [serviceRoleKey, setServiceRoleKey] = useState('');
  const [removeVolumes, setRemoveVolumes] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleConfirm = () => {
    // Validate Service Role Key
    if (serviceRoleKey !== instance.credentials.service_role_key) {
      setError('Incorrect Service Role Key. Please check your input.');
      return;
    }

    onConfirm(removeVolumes);
    handleClose();
  };

  const handleClose = () => {
    setServiceRoleKey('');
    setRemoveVolumes(false);
    setError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-lg max-w-lg w-full shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-destructive/10 rounded-lg">
              <Trash2 className="w-6 h-6 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold">Delete Instance</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-muted rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Warning */}
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <div className="flex gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-destructive">Warning</h3>
                <p className="mt-1 text-sm text-destructive/90">
                  This action cannot be undone. The instance <strong>{instance.name}</strong> will be
                  permanently deleted.
                </p>
              </div>
            </div>
          </div>

          {/* Service Role Key Input */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Service Role Key for Confirmation <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={serviceRoleKey}
              onChange={(e) => {
                setServiceRoleKey(e.target.value);
                setError('');
              }}
              placeholder="Enter Service Role Key..."
              className="w-full px-3 py-2 bg-input border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-foreground font-mono text-sm"
            />
            {error && (
              <p className="mt-2 text-sm text-destructive">{error}</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Enter the instance's Service Role Key to confirm deletion.
            </p>
          </div>

          {/* Remove Volumes Checkbox */}
          <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
            <input
              type="checkbox"
              id="removeVolumes"
              checked={removeVolumes}
              onChange={(e) => setRemoveVolumes(e.target.checked)}
              className="mt-1 w-4 h-4 text-primary bg-input border-border rounded focus:ring-2 focus:ring-primary"
            />
            <div className="flex-1">
              <label htmlFor="removeVolumes" className="text-sm font-medium text-foreground cursor-pointer">
                Also delete data volumes
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                If enabled, all data (database, storage, etc.) will be permanently deleted.
                Otherwise, the volumes will be preserved.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-border">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-border rounded-md hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!serviceRoleKey}
            className="flex items-center gap-2 px-4 py-2 bg-destructive text-white rounded-md hover:bg-destructive/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            Delete Instance
          </button>
        </div>
      </div>
    </div>
  );
}
