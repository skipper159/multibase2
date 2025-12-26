import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Plus, AlertCircle, Check } from 'lucide-react';
import { useCreateInstance } from '../hooks/useInstances';
import { CreateInstanceRequest, InstanceTemplate } from '../types';
import { toast } from 'sonner';
import { templatesApi } from '../lib/api';
import { useQuery } from '@tanstack/react-query';

interface CreateInstanceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTemplate?: InstanceTemplate | null;
}

interface FormData extends CreateInstanceRequest {
  corsOriginsList: string; // Comma-separated list for UI
  templateId?: number;
}

const initialFormData: FormData = {
  name: '',
  deploymentType: 'localhost',
  basePort: undefined,
  domain: '',
  protocol: 'http',
  corsOriginsList: '',
  templateId: undefined,
};

export default function CreateInstanceModal({ open, onOpenChange, initialTemplate }: CreateInstanceModalProps) {
  const navigate = useNavigate();
  const createInstance = useCreateInstance();
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: templatesData } = useQuery({
    queryKey: ['templates'],
    queryFn: templatesApi.list,
  });
  const templates = templatesData?.templates || [];

  // Pre-fill form when initialTemplate is provided
  useEffect(() => {
    if (open && initialTemplate) {
      // config is typed as any in InstanceTemplate, but let's be safe
      const config =
        typeof initialTemplate.config === 'string' ? JSON.parse(initialTemplate.config) : initialTemplate.config;

      setFormData((prev) => ({
        ...prev,
        templateId: initialTemplate.id,
        // Pre-fill fields if they exist in config
        deploymentType: config.deploymentType || prev.deploymentType,
        basePort: config.basePort || prev.basePort,
        domain: config.domain || prev.domain,
        protocol: config.protocol || prev.protocol,
        corsOriginsList: config.corsOrigins ? config.corsOrigins.join(', ') : prev.corsOriginsList,
      }));
      toast.info(`Loaded template: ${initialTemplate.name}`);
    } else if (!open) {
      // Reset form when closed (optional, but good for cleanup)
      // Actually handleModalClose in parent might reset initialTemplate
    }
  }, [open, initialTemplate]);

  // Effect to update form when initialTemplate changes or modal opens
  // We use a simple effect here: if initialTemplate is provided and we are opening, fill it.
  // Note: Since this component might be mounted but hidden, we should check 'open'
  // But usually we want to react to 'initialTemplate' changing.

  // This is a bit tricky with "initial" vs "state".
  // Let's use an effect that runs when initialTemplate changes.
  // We need to import useEffect first.

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Validate name (required, alphanumeric + hyphens, Docker-compatible)
    if (!formData.name.trim()) {
      newErrors.name = 'Instance name is required';
    } else if (!/^[a-zA-Z0-9-_]+$/.test(formData.name)) {
      newErrors.name = 'Name can only contain letters, numbers, hyphens, and underscores';
    } else if (formData.name.length < 3) {
      newErrors.name = 'Name must be at least 3 characters';
    } else if (formData.name.length > 50) {
      newErrors.name = 'Name must be less than 50 characters';
    }

    // Validate base port (optional, but must be valid if provided)
    if (formData.basePort) {
      const port = Number(formData.basePort);
      if (isNaN(port) || port < 1024 || port > 65535) {
        newErrors.basePort = 'Port must be between 1024 and 65535';
      }
    }

    // Validate domain for cloud deployment
    if (formData.deploymentType === 'cloud') {
      if (!formData.domain || !formData.domain.trim()) {
        newErrors.domain = 'Domain is required for cloud deployment';
      } else if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(formData.domain)) {
        newErrors.domain = 'Invalid domain format';
      }
    }

    // Validate CORS origins (optional, but must be valid URLs if provided)
    if (formData.corsOriginsList.trim()) {
      const origins = formData.corsOriginsList.split(',').map((o) => o.trim());
      for (const origin of origins) {
        if (origin && !isValidUrl(origin)) {
          newErrors.corsOriginsList = `Invalid URL: ${origin}`;
          break;
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Prepare request data
    const requestData: CreateInstanceRequest = {
      name: formData.name.trim(),
      deploymentType: formData.deploymentType,
      ...(formData.basePort && { basePort: Number(formData.basePort) }),
      ...(formData.domain && { domain: formData.domain.trim() }),
      ...(formData.protocol && { protocol: formData.protocol }),
      ...(formData.templateId && { templateId: Number(formData.templateId) }),
    };

    // Parse CORS origins if provided
    if (formData.corsOriginsList.trim()) {
      requestData.corsOrigins = formData.corsOriginsList
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
    }

    try {
      await createInstance.mutateAsync(requestData);

      // Show success toast with credentials info
      toast.success('Instance created successfully!', {
        description: `${formData.name} is being initialized. Credentials have been auto-generated.`,
        duration: 5000,
      });

      // Reset form and close modal
      setFormData(initialFormData);
      setErrors({});
      onOpenChange(false);

      // Navigate to instance detail page
      navigate(`/instances/${formData.name}`);
    } catch (error: any) {
      toast.error('Failed to create instance', {
        description: error.message || 'An unexpected error occurred',
      });
    }
  };

  const handleTemplateChange = (templateIdVal: string) => {
    const tId = Number(templateIdVal);
    if (!tId) {
      setFormData((prev) => ({ ...prev, templateId: undefined }));
      return;
    }

    const template = templates.find((t) => t.id === tId);
    if (template) {
      // config is typed as any in InstanceTemplate, but let's be safe
      const config = typeof template.config === 'string' ? JSON.parse(template.config) : template.config;

      setFormData((prev) => ({
        ...prev,
        templateId: tId,
        // Pre-fill fields if they exist in config
        deploymentType: config.deploymentType || prev.deploymentType,
        basePort: config.basePort || prev.basePort,
        domain: config.domain || prev.domain,
        protocol: config.protocol || prev.protocol,
        corsOriginsList: config.corsOrigins ? config.corsOrigins.join(', ') : prev.corsOriginsList,
      }));
      toast.info(`Loaded template: ${template.name}`);
    }
  };

  const handleInputChange = (field: keyof FormData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 bg-black/70 backdrop-blur-sm z-50' />
        <Dialog.Content className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto z-50'>
          <div className='flex items-center justify-between mb-6'>
            <Dialog.Title className='text-2xl font-bold text-foreground flex items-center gap-2'>
              <Plus className='w-6 h-6' />
              Create New Instance
            </Dialog.Title>
            <Dialog.Close className='text-muted-foreground hover:text-foreground'>
              <X className='w-5 h-5' />
            </Dialog.Close>
          </div>

          <Dialog.Description className='text-sm text-muted-foreground mb-6'>
            Create a new Supabase instance. All credentials will be auto-generated securely.
          </Dialog.Description>

          <form onSubmit={handleSubmit} className='space-y-6'>
            {/* Basic Information Section */}
            <div className='space-y-4'>
              <h3 className='text-lg font-semibold text-foreground border-b border-border pb-2'>Basic Information</h3>

              {/* Template Selection */}
              {templates.length > 0 && (
                <div>
                  <label htmlFor='template' className='block text-sm font-medium text-foreground mb-1'>
                    Use Template (Optional)
                  </label>
                  <select
                    id='template'
                    value={formData.templateId || ''}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                  >
                    <option value=''>-- Select a Template --</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Instance Name */}
              <div>
                <label htmlFor='name' className='block text-sm font-medium text-foreground mb-1'>
                  Instance Name <span className='text-destructive'>*</span>
                </label>
                <input
                  type='text'
                  id='name'
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder='my-supabase-instance'
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground placeholder:text-muted-foreground ${
                    errors.name ? 'border-destructive' : 'border-border'
                  }`}
                />
                {errors.name && (
                  <p className='mt-1 text-sm text-destructive flex items-center gap-1'>
                    <AlertCircle className='w-4 h-4' />
                    {errors.name}
                  </p>
                )}
                <p className='mt-1 text-xs text-muted-foreground'>
                  Alphanumeric characters, hyphens, and underscores only (3-50 chars)
                </p>
              </div>

              {/* Deployment Type */}
              <div>
                <label htmlFor='deploymentType' className='block text-sm font-medium text-foreground mb-1'>
                  Deployment Type <span className='text-destructive'>*</span>
                </label>
                <select
                  id='deploymentType'
                  value={formData.deploymentType}
                  onChange={(e) => handleInputChange('deploymentType', e.target.value as 'localhost' | 'cloud')}
                  className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                >
                  <option value='localhost'>Localhost (Development)</option>
                  <option value='cloud'>Cloud (Production)</option>
                </select>
                <p className='mt-1 text-xs text-muted-foreground'>
                  {formData.deploymentType === 'localhost'
                    ? 'Instance will be accessible on localhost'
                    : 'Instance will be configured for cloud deployment with custom domain'}
                </p>
              </div>
            </div>

            {/* Port Configuration Section */}
            <div className='space-y-4'>
              <h3 className='text-lg font-semibold text-foreground border-b border-border pb-2'>Port Configuration</h3>

              {/* Base Port */}
              <div>
                <label htmlFor='basePort' className='block text-sm font-medium text-foreground mb-1'>
                  Base Port (Optional)
                </label>
                <input
                  type='number'
                  id='basePort'
                  value={formData.basePort || ''}
                  onChange={(e) => handleInputChange('basePort', e.target.value)}
                  placeholder='Auto-assigned (recommended)'
                  min='1024'
                  max='65535'
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground placeholder:text-muted-foreground ${
                    errors.basePort ? 'border-destructive' : 'border-border'
                  }`}
                />
                {errors.basePort && (
                  <p className='mt-1 text-sm text-destructive flex items-center gap-1'>
                    <AlertCircle className='w-4 h-4' />
                    {errors.basePort}
                  </p>
                )}
                <p className='mt-1 text-xs text-muted-foreground'>
                  Leave empty for automatic port allocation. Services will use consecutive ports from base.
                </p>
              </div>
            </div>

            {/* Cloud Configuration Section */}
            {formData.deploymentType === 'cloud' && (
              <div className='space-y-4'>
                <h3 className='text-lg font-semibold text-foreground border-b border-border pb-2'>
                  Cloud Configuration
                </h3>

                {/* Domain */}
                <div>
                  <label htmlFor='domain' className='block text-sm font-medium text-foreground mb-1'>
                    Domain <span className='text-destructive'>*</span>
                  </label>
                  <input
                    type='text'
                    id='domain'
                    value={formData.domain}
                    onChange={(e) => handleInputChange('domain', e.target.value)}
                    placeholder='api.example.com'
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground placeholder:text-muted-foreground ${
                      errors.domain ? 'border-destructive' : 'border-border'
                    }`}
                  />
                  {errors.domain && (
                    <p className='mt-1 text-sm text-destructive flex items-center gap-1'>
                      <AlertCircle className='w-4 h-4' />
                      {errors.domain}
                    </p>
                  )}
                </div>

                {/* Protocol */}
                <div>
                  <label htmlFor='protocol' className='block text-sm font-medium text-foreground mb-1'>
                    Protocol
                  </label>
                  <select
                    id='protocol'
                    value={formData.protocol}
                    onChange={(e) => handleInputChange('protocol', e.target.value as 'http' | 'https')}
                    className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                  >
                    <option value='http'>HTTP</option>
                    <option value='https'>HTTPS (Recommended)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Advanced Options Section */}
            <div className='space-y-4'>
              <h3 className='text-lg font-semibold text-foreground border-b border-border pb-2'>Advanced Options</h3>

              {/* CORS Origins */}
              <div>
                <label htmlFor='corsOrigins' className='block text-sm font-medium text-foreground mb-1'>
                  CORS Origins (Optional)
                </label>
                <input
                  type='text'
                  id='corsOrigins'
                  value={formData.corsOriginsList}
                  onChange={(e) => handleInputChange('corsOriginsList', e.target.value)}
                  placeholder='https://app.example.com, https://admin.example.com'
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground placeholder:text-muted-foreground ${
                    errors.corsOriginsList ? 'border-destructive' : 'border-border'
                  }`}
                />
                {errors.corsOriginsList && (
                  <p className='mt-1 text-sm text-destructive flex items-center gap-1'>
                    <AlertCircle className='w-4 h-4' />
                    {errors.corsOriginsList}
                  </p>
                )}
                <p className='mt-1 text-xs text-muted-foreground'>
                  Comma-separated list of allowed origins. Leave empty to allow all origins.
                </p>
              </div>
            </div>

            {/* Security Notice */}
            <div className='bg-primary/10 border border-primary/20 rounded-md p-4'>
              <div className='flex gap-2'>
                <Check className='w-5 h-5 text-primary flex-shrink-0 mt-0.5' />
                <div className='text-sm text-foreground'>
                  <p className='font-semibold mb-1'>Auto-Generated Credentials</p>
                  <p className='text-muted-foreground'>
                    All credentials (JWT secret, database password, API keys, etc.) will be automatically generated
                    using cryptographically secure methods. You can view them on the instance detail page after
                    creation.
                  </p>
                </div>
              </div>
            </div>

            {/* Form Actions */}
            <div className='flex gap-3 pt-4 border-t border-border'>
              <button
                type='button'
                onClick={() => onOpenChange(false)}
                disabled={createInstance.isPending}
                className='flex-1 px-4 py-2 border border-border rounded-md text-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed'
              >
                Cancel
              </button>
              <button
                type='submit'
                disabled={createInstance.isPending}
                className='flex-1 px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2'
              >
                {createInstance.isPending ? (
                  <>
                    <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin' />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className='w-4 h-4' />
                    Create Instance
                  </>
                )}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
