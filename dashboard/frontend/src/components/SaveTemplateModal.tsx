import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { templatesApi } from '../lib/api';
import { toast } from 'sonner';
import { X, Save } from 'lucide-react';

interface SaveTemplateModalProps {
  onClose: () => void;
  instanceConfig: any; // The config derived from instance
}

export default function SaveTemplateModal({ onClose, instanceConfig }: SaveTemplateModalProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isPublic: false,
  });

  const createMutation = useMutation({
    mutationFn: templatesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template saved successfully');
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to save template');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...formData,
      config: instanceConfig,
    });
  };

  return (
    <div className='fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4'>
      <div className='bg-card border border-border rounded-lg shadow-lg w-full max-w-md'>
        <div className='flex items-center justify-between p-4 border-b border-border'>
          <h2 className='text-lg font-semibold flex items-center gap-2'>
            <Save className='w-5 h-5' />
            Save as Template
          </h2>
          <button onClick={onClose} className='text-muted-foreground hover:text-foreground'>
            <X className='w-5 h-5' />
          </button>
        </div>

        <form onSubmit={handleSubmit} className='p-4 space-y-4'>
          <div>
            <label className='block text-sm font-medium mb-1'>Template Name</label>
            <input
              type='text'
              required
              className='w-full px-3 py-2 rounded-md border border-input bg-background/50'
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder='e.g. Production Stack'
            />
          </div>

          <div>
            <label className='block text-sm font-medium mb-1'>Description</label>
            <textarea
              className='w-full px-3 py-2 rounded-md border border-input bg-background/50'
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder='Optional description...'
              rows={3}
            />
          </div>

          <div className='flex items-center gap-2'>
            <input
              type='checkbox'
              id='save-public'
              checked={formData.isPublic}
              onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
            />
            <label htmlFor='save-public' className='text-sm'>
              Make Public (Admin only)
            </label>
          </div>

          <div className='flex justify-end gap-3 mt-6'>
            <button
              type='button'
              onClick={onClose}
              className='px-4 py-2 text-sm font-medium hover:bg-secondary rounded-md'
            >
              Cancel
            </button>
            <button
              type='submit'
              disabled={createMutation.isPending}
              className='px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50'
            >
              {createMutation.isPending ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
