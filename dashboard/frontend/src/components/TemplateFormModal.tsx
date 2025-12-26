import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { templatesApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { InstanceTemplate } from '../types';
import { toast } from 'sonner';

interface TemplateFormModalProps {
  isOpen: boolean;
  template?: InstanceTemplate | null; // If provided, we're in Edit mode
  onClose: () => void;
  onSuccess: () => void;
}

export default function TemplateFormModal({ isOpen, template, onClose, onSuccess }: TemplateFormModalProps) {
  const { user } = useAuth();
  const isEditMode = !!template;

  const [activeTab, setActiveTab] = useState<'general' | 'deployment' | 'services' | 'env'>('general');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    isPublic: false,
    config: {
      deploymentType: 'localhost',
      basePort: 8000,
      services: [] as string[],
      env: {} as Record<string, string>,
    } as any,
  });

  // Populate form when editing
  useEffect(() => {
    if (template) {
      setFormData({
        name: template.name,
        description: template.description || '',
        isPublic: template.isPublic,
        config: template.config || {
          deploymentType: 'localhost',
          basePort: 8000,
          services: [],
          env: {},
        },
      });
    } else {
      // Reset for create mode
      setFormData({
        name: '',
        description: '',
        isPublic: false,
        config: {
          deploymentType: 'localhost',
          basePort: 8000,
          services: [],
          env: {},
        },
      });
    }
    setActiveTab('general');
  }, [template, isOpen]);

  // Fetch System Template
  const { data: systemTemplate } = useQuery({
    queryKey: ['systemTemplate'],
    queryFn: templatesApi.getSystemTemplate,
    enabled: isOpen,
  });

  const createMutation = useMutation({
    mutationFn: templatesApi.create,
    onSuccess: () => {
      toast.success('Template created successfully');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create template');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => templatesApi.update(id, data),
    onSuccess: () => {
      toast.success('Template updated successfully');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update template');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditMode && template) {
      updateMutation.mutate({ id: template.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const toggleService = (service: string) => {
    const current = formData.config.services || [];
    const updated = current.includes(service) ? current.filter((s: string) => s !== service) : [...current, service];
    setFormData({ ...formData, config: { ...formData.config, services: updated } });
  };

  const updateEnv = (key: string, value: string) => {
    setFormData({
      ...formData,
      config: {
        ...formData.config,
        env: { ...formData.config.env, [key]: value },
      },
    });
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4'>
      <div className='bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl flex flex-col max-h-[90vh]'>
        <div className='flex items-center justify-between p-6 border-b border-border'>
          <h2 className='text-xl font-semibold'>{isEditMode ? 'Edit Template' : 'Create New Template'}</h2>
          <button onClick={onClose} className='p-1 hover:bg-secondary rounded-md transition-colors'>
            <X className='w-5 h-5' />
          </button>
        </div>

        <div className='flex border-b border-border bg-secondary/20'>
          {(['general', 'deployment', 'services', 'env'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary bg-background'
                  : 'border-transparent text-muted-foreground hover:bg-secondary/50'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className='p-6 overflow-y-auto flex-1'>
          <form id='template-form' onSubmit={handleSubmit} className='space-y-6'>
            {activeTab === 'general' && (
              <div className='space-y-4'>
                <div>
                  <label className='block text-sm font-medium mb-1'>Name</label>
                  <input
                    type='text'
                    required
                    className='w-full px-3 py-2 rounded-md border border-input bg-background/50'
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className='block text-sm font-medium mb-1'>Description</label>
                  <textarea
                    className='w-full px-3 py-2 rounded-md border border-input bg-background/50'
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
                {user?.role === 'admin' && (
                  <div className='flex items-center gap-2'>
                    <input
                      type='checkbox'
                      id='isPublic'
                      checked={formData.isPublic}
                      onChange={(e) => setFormData({ ...formData, isPublic: e.target.checked })}
                    />
                    <label htmlFor='isPublic' className='text-sm'>
                      Make Public
                    </label>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'deployment' && (
              <div className='space-y-4'>
                <div>
                  <label className='block text-sm font-medium mb-1'>Deployment Type</label>
                  <select
                    className='w-full px-3 py-2 rounded-md border border-input bg-background/50'
                    value={formData.config.deploymentType}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: { ...formData.config, deploymentType: e.target.value },
                      })
                    }
                  >
                    <option value='localhost'>Localhost</option>
                    <option value='cloud'>Cloud / Domain</option>
                  </select>
                </div>
                <div>
                  <label className='block text-sm font-medium mb-1'>Default Base Port</label>
                  <input
                    type='number'
                    className='w-full px-3 py-2 rounded-md border border-input bg-background/50'
                    value={formData.config.basePort}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        config: { ...formData.config, basePort: parseInt(e.target.value) },
                      })
                    }
                  />
                  <p className='text-xs text-muted-foreground mt-1'>Suggested starting port for new instances.</p>
                </div>
              </div>
            )}

            {activeTab === 'services' && (
              <div className='space-y-4'>
                <p className='text-sm text-muted-foreground'>
                  Select services to include in instances created from this template.
                </p>
                <div className='grid grid-cols-2 gap-3'>
                  {systemTemplate?.services.map((service) => (
                    <label
                      key={service.name}
                      className='flex items-center gap-3 p-3 border border-border rounded-md hover:bg-secondary/10 cursor-pointer'
                    >
                      <input
                        type='checkbox'
                        checked={
                          (formData.config.services || []).includes(service.name) ||
                          (formData.config.services || []).length === 0
                        }
                        onChange={() => toggleService(service.name)}
                      />
                      <div>
                        <div className='font-medium'>{service.name}</div>
                        <div className='text-xs text-muted-foreground truncate max-w-[150px]'>
                          {service.image?.split(':')[0]}
                        </div>
                      </div>
                    </label>
                  ))}
                  {!systemTemplate && <div className='col-span-2 text-center py-4'>Loading system services...</div>}
                </div>
              </div>
            )}

            {activeTab === 'env' && (
              <div className='space-y-4'>
                <p className='text-sm text-muted-foreground'>
                  Override default environment variables. Leave empty to use system defaults.
                </p>
                <div className='space-y-2 max-h-[300px] overflow-y-auto pr-2'>
                  {systemTemplate?.envVars.map((envVar) => (
                    <div key={envVar} className='grid grid-cols-3 gap-2 items-center'>
                      <label className='text-xs font-mono truncate' title={envVar}>
                        {envVar}
                      </label>
                      <input
                        type='text'
                        placeholder='Default'
                        className='col-span-2 px-2 py-1 text-sm rounded-md border border-input bg-background/50'
                        value={formData.config.env?.[envVar] || ''}
                        onChange={(e) => updateEnv(envVar, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        </div>

        <div className='p-6 border-t border-border flex justify-end gap-3 bg-secondary/10 rounded-b-lg'>
          <button
            type='button'
            onClick={onClose}
            className='px-4 py-2 text-sm font-medium hover:bg-secondary rounded-md transition-colors'
          >
            Cancel
          </button>
          <button
            type='submit'
            form='template-form'
            disabled={isPending}
            className='px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors'
          >
            {isPending ? 'Saving...' : isEditMode ? 'Save Changes' : 'Create Template'}
          </button>
        </div>
      </div>
    </div>
  );
}
