import { X, Check, Server, Box, Globe, Shield } from 'lucide-react';
import { InstanceTemplate } from '../types';
import { useNavigate } from 'react-router-dom';

interface TemplatePreviewModalProps {
  isOpen: boolean;
  template: InstanceTemplate | null;
  onClose: () => void;
}

export default function TemplatePreviewModal({ isOpen, template, onClose }: TemplatePreviewModalProps) {
  const navigate = useNavigate();

  if (!isOpen || !template) return null;

  const config = template.config || {};
  const services = config.services || [];
  const envVars = config.env || {};

  const handleUseTemplate = () => {
    // Navigate to dashboard and open create modal with template
    navigate('/', { state: { openCreateModal: true, template } });
    onClose();
  };

  return (
    <div className='fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50'>
      <div className='bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col'>
        <div className='flex items-center justify-between p-6 border-b border-border'>
          <div>
            <h2 className='text-2xl font-bold text-foreground'>{template.name}</h2>
            <p className='text-muted-foreground mt-1'>{template.description || 'No description provided'}</p>
          </div>
          <button onClick={onClose} className='p-2 hover:bg-muted rounded-full transition-colors'>
            <X className='w-5 h-5 text-muted-foreground' />
          </button>
        </div>

        <div className='flex-1 overflow-y-auto p-6 space-y-6'>
          {/* Main Info */}
          <div className='grid grid-cols-2 gap-4'>
            <div className='bg-secondary/30 p-4 rounded-lg border border-border'>
              <div className='flex items-center gap-2 mb-2 text-primary'>
                <Server className='w-4 h-4' />
                <span className='font-medium'>Deployment</span>
              </div>
              <p className='text-foreground capitalize'>{config.deploymentType || 'Localhost'}</p>
            </div>

            <div className='bg-secondary/30 p-4 rounded-lg border border-border'>
              <div className='flex items-center gap-2 mb-2 text-primary'>
                <Globe className='w-4 h-4' />
                <span className='font-medium'>Base Port</span>
              </div>
              <p className='text-foreground'>{config.basePort || 'Auto-assigned'}</p>
            </div>
          </div>

          {/* Services */}
          <div>
            <h3 className='text-lg font-semibold mb-3 flex items-center gap-2'>
              <Box className='w-5 h-5' />
              Included Services
            </h3>
            {services.length > 0 ? (
              <div className='grid grid-cols-2 md:grid-cols-3 gap-3'>
                {services.map((service: string) => (
                  <div
                    key={service}
                    className='flex items-center gap-2 bg-muted/50 px-3 py-2 rounded-md border border-border'
                  >
                    <div className='w-2 h-2 rounded-full bg-green-500' />
                    <span className='text-sm font-medium capitalize'>{service}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className='text-muted-foreground italic'>No specific services configured (defaults will be used)</p>
            )}
          </div>

          {/* Env Vars */}
          {Object.keys(envVars).length > 0 && (
            <div>
              <h3 className='text-lg font-semibold mb-3 flex items-center gap-2'>
                <Shield className='w-5 h-5' />
                Environment Variables
              </h3>
              <div className='bg-muted rounded-lg p-4 font-mono text-sm overflow-x-auto'>
                {Object.entries(envVars).map(([key, value]) => (
                  <div key={key} className='flex gap-2 border-b border-border/50 last:border-0 py-1'>
                    <span className='text-blue-400'>{key}</span>
                    <span className='text-muted-foreground'>=</span>
                    <span className='text-green-400'>{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta Info */}
          <div className='text-sm text-muted-foreground pt-4 border-t border-border'>
            Created by <span className='font-medium text-foreground'>{template.creator?.username || 'Unknown'}</span> on{' '}
            {new Date(template.createdAt).toLocaleDateString()}
          </div>
        </div>

        <div className='p-6 border-t border-border flex justify-end gap-3 bg-secondary/10'>
          <button
            onClick={onClose}
            className='px-4 py-2 border border-border rounded-md text-foreground hover:bg-muted transition-colors'
          >
            Cancel
          </button>
          <button
            onClick={handleUseTemplate}
            className='flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium shadow-sm'
          >
            <Check className='w-4 h-4' />
            Use Template
          </button>
        </div>
      </div>
    </div>
  );
}
