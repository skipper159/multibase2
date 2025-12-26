import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { instancesApi } from '../lib/api';
import { Mail, Save, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';

interface ConfigTabProps {
  instance: any;
}

export default function ConfigTab({ instance }: ConfigTabProps) {
  // We don't have current values easily because we don't expose .env reading directly yet.
  // We present empty fields as override inputs.

  const [formData, setFormData] = useState({
    smtp_host: '',
    smtp_port: 0,
    smtp_user: '',
    smtp_pass: '',
    smtp_sender_name: '',
    smtp_admin_email: '',
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => instancesApi.updateSmtp(instance.name, data),
    onSuccess: () => {
      toast.success('Instance configuration updated. Service restarting...');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update configuration');
    },
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'smtp_port' ? parseInt(value) || 0 : value,
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const payload: any = {};
    if (formData.smtp_host) payload.smtp_host = formData.smtp_host;
    if (formData.smtp_port) payload.smtp_port = formData.smtp_port;
    if (formData.smtp_user) payload.smtp_user = formData.smtp_user;
    if (formData.smtp_pass) payload.smtp_pass = formData.smtp_pass;
    if (formData.smtp_sender_name) payload.smtp_sender_name = formData.smtp_sender_name;
    if (formData.smtp_admin_email) payload.smtp_admin_email = formData.smtp_admin_email;

    if (Object.keys(payload).length === 0) {
      toast.info('No changes to save');
      return;
    }

    updateMutation.mutate(payload);
  };

  return (
    <div className='space-y-6'>
      <div className='bg-card p-6 rounded-lg border border-border shadow-sm'>
        <h3 className='text-lg font-semibold text-foreground mb-4 flex items-center gap-2'>
          <Mail className='w-5 h-5 text-primary' />
          SMTP Overrides
        </h3>
        <div className='bg-secondary/50 border border-border rounded-lg p-4 mb-6 flex gap-3 text-sm text-muted-foreground'>
          <Info className='w-5 h-5 mt-0.5 shrink-0 text-primary' />
          <p>
            Set specific SMTP settings for this instance. Leave fields blank to use Global Settings or existing values
            from the environment.
            <br />
            <span className='text-foreground font-medium mt-1 inline-block'>Saving will restart the Auth service.</span>
          </p>
        </div>

        <form onSubmit={handleSave} className='space-y-4'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
            <div>
              <label className='block text-sm font-medium mb-1'>SMTP Host</label>
              <input
                type='text'
                name='smtp_host'
                value={formData.smtp_host}
                onChange={handleChange}
                placeholder='Override Global Host'
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-1'>Port</label>
              <input
                type='number'
                name='smtp_port'
                value={formData.smtp_port || ''}
                onChange={handleChange}
                placeholder='Override Port'
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-1'>Username</label>
              <input
                type='text'
                name='smtp_user'
                value={formData.smtp_user}
                onChange={handleChange}
                placeholder='Override Username'
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-1'>Password</label>
              <input
                type='password'
                name='smtp_pass'
                value={formData.smtp_pass}
                onChange={handleChange}
                placeholder='Override Password'
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-1'>Sender Name</label>
              <input
                type='text'
                name='smtp_sender_name'
                value={formData.smtp_sender_name}
                onChange={handleChange}
                placeholder='Override Sender Name'
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-1'>Admin Email</label>
              <input
                type='email'
                name='smtp_admin_email'
                value={formData.smtp_admin_email}
                onChange={handleChange}
                placeholder='Override Admin Email'
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground/50'
              />
            </div>
          </div>

          <div className='pt-4 flex justify-end'>
            <button
              type='submit'
              disabled={updateMutation.isPending}
              className='flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-lg transition-colors disabled:opacity-50'
            >
              {updateMutation.isPending ? <Loader2 className='w-4 h-4 animate-spin' /> : <Save className='w-4 h-4' />}
              Save Overrides
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
