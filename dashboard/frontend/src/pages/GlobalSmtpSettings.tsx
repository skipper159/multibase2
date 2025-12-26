import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../lib/api';
import PageHeader from '../components/PageHeader';
import { Mail, Save, Send, Loader2, CheckCircle, AlertTriangle, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function GlobalSmtpSettings() {
  const queryClient = useQueryClient();
  const [testEmail, setTestEmail] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    smtp_host: '',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: '',
    smtp_sender_name: 'Multibase Admin',
    smtp_admin_email: '',
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['smtpSettings'],
    queryFn: settingsApi.getSmtp,
    placeholderData: {},
  });

  useEffect(() => {
    if (settings && Object.keys(settings).length > 0) {
      setFormData({
        smtp_host: settings.smtp_host || '',
        smtp_port: settings.smtp_port || 587,
        smtp_user: settings.smtp_user || '',
        smtp_pass: settings.smtp_pass || '', // Will be '********' or null
        smtp_sender_name: settings.smtp_sender_name || 'Multibase Admin',
        smtp_admin_email: settings.smtp_admin_email || '',
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: settingsApi.updateSmtp,
    onSuccess: () => {
      toast.success('SMTP settings saved successfully');
      queryClient.invalidateQueries({ queryKey: ['smtpSettings'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to save settings');
    },
  });

  const testMutation = useMutation({
    mutationFn: settingsApi.testSmtp,
    onSuccess: () => {
      toast.success(`Test email sent to ${testEmail || formData.smtp_admin_email || formData.smtp_user}`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to send test email');
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
    updateMutation.mutate(formData);
  };

  const handleTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.smtp_host) {
      toast.error('Please save SMTP settings first');
      return;
    }
    testMutation.mutate(testEmail);
  };

  if (isLoading) {
    return (
      <div className='flex items-center justify-center h-full'>
        <Loader2 className='w-8 h-8 animate-spin text-primary' />
      </div>
    );
  }

  return (
    <div className='space-y-6 container mx-auto px-6 py-6'>
      <PageHeader>
        <div className='flex items-center justify-between'>
          <div>
            <Link to='/' className='inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-2'>
              <ArrowLeft className='w-4 h-4' />
              Back to Dashboard
            </Link>
            <div className='flex items-center gap-3'>
              <div className='p-3 bg-primary/10 rounded-lg'>
                <Mail className='w-6 h-6 text-primary' />
              </div>
              <div>
                <h1 className='text-2xl font-bold text-foreground'>Global SMTP Settings</h1>
                <p className='text-sm text-muted-foreground'>
                  Configure email settings for system notifications and alerts.
                </p>
              </div>
            </div>
          </div>
        </div>
      </PageHeader>

      <div className='grid grid-cols-1 lg:grid-cols-2 gap-6'>
        {/* Configuration Form */}
        <div className='bg-card border rounded-lg p-6 shadow-sm'>
          <h3 className='text-lg font-semibold text-foreground mb-4 flex items-center gap-2'>
            <Mail className='w-5 h-5 text-primary' />
            Server Configuration
          </h3>

          <form onSubmit={handleSave} className='space-y-4'>
            <div>
              <label className='block text-sm font-medium mb-1'>SMTP Host</label>
              <input
                type='text'
                name='smtp_host'
                value={formData.smtp_host}
                onChange={handleChange}
                placeholder='smtp.example.com'
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50'
              />
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div>
                <label className='block text-sm font-medium mb-1'>Port</label>
                <input
                  type='number'
                  name='smtp_port'
                  value={formData.smtp_port}
                  onChange={handleChange}
                  placeholder='587'
                  className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50'
                />
              </div>
            </div>

            <div>
              <label className='block text-sm font-medium mb-1'>Username / Email</label>
              <input
                type='text'
                name='smtp_user'
                value={formData.smtp_user}
                onChange={handleChange}
                placeholder='admin@example.com'
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50'
              />
            </div>

            <div>
              <label className='block text-sm font-medium mb-1'>Password</label>
              <input
                type='password'
                name='smtp_pass'
                value={formData.smtp_pass}
                onChange={handleChange}
                placeholder={settings?.smtp_pass ? '••••••••' : 'Enter password'}
                className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50'
              />
              <p className='text-xs text-muted-foreground mt-1'>Leave empty to keep existing password.</p>
            </div>

            <div className='border-t pt-4 mt-4'>
              <h4 className='text-sm font-medium text-muted-foreground mb-3'>Sender Details</h4>

              <div className='space-y-4'>
                <div>
                  <label className='block text-sm font-medium mb-1'>Sender Name</label>
                  <input
                    type='text'
                    name='smtp_sender_name'
                    value={formData.smtp_sender_name}
                    onChange={handleChange}
                    placeholder='Multibase Admin'
                    className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50'
                  />
                </div>

                <div>
                  <label className='block text-sm font-medium mb-1'>Admin Email (Receiver)</label>
                  <input
                    type='email'
                    name='smtp_admin_email'
                    value={formData.smtp_admin_email}
                    onChange={handleChange}
                    placeholder='alerts@example.com'
                    className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50'
                  />
                  <p className='text-xs text-muted-foreground mt-1'>Default recipient for system alerts.</p>
                </div>
              </div>
            </div>

            <div className='pt-4 flex justify-end'>
              <button
                type='submit'
                disabled={updateMutation.isPending}
                className='flex items-center gap-2 bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-lg transition-colors disabled:opacity-50'
              >
                {updateMutation.isPending ? <Loader2 className='w-4 h-4 animate-spin' /> : <Save className='w-4 h-4' />}
                Save Configuration
              </button>
            </div>
          </form>
        </div>

        {/* Test Connection */}
        <div className='space-y-6'>
          <div className='bg-card border rounded-lg p-6 shadow-sm'>
            <h3 className='text-lg font-semibold text-foreground mb-4 flex items-center gap-2'>
              <Send className='w-5 h-5 text-primary' />
              Test Connection
            </h3>
            <p className='text-muted-foreground text-sm mb-4'>
              Send a test email to verify your SMTP configuration is working correctly.
            </p>

            <form onSubmit={handleTest} className='space-y-4'>
              <div>
                <label className='block text-sm font-medium mb-1'>Recipient Email</label>
                <input
                  type='email'
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder='test@example.com'
                  className='w-full px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50'
                />
              </div>

              <button
                type='submit'
                disabled={testMutation.isPending || !formData.smtp_host}
                className='w-full flex items-center justify-center gap-2 bg-secondary hover:bg-muted text-foreground px-4 py-2 rounded-lg transition-colors border disabled:opacity-50'
              >
                {testMutation.isPending ? <Loader2 className='w-4 h-4 animate-spin' /> : <Send className='w-4 h-4' />}
                Send Test Email
              </button>

              {testMutation.isSuccess && (
                <div className='flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-lg text-sm border border-green-200'>
                  <CheckCircle className='w-4 h-4' />
                  Email sent successfully!
                </div>
              )}
              {testMutation.isError && (
                <div className='flex items-start gap-2 text-destructive bg-destructive/10 p-3 rounded-lg text-sm border border-destructive/20'>
                  <AlertTriangle className='w-4 h-4 mt-0.5 shrink-0' />
                  <div>
                    <p className='font-semibold'>Failed to send email</p>
                    <p className='opacity-90'>{testMutation.error?.message || 'Check your settings and try again.'}</p>
                  </div>
                </div>
              )}
            </form>
          </div>

          <div className='bg-card border rounded-lg p-6 shadow-sm'>
            <h3 className='text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3'>Information</h3>
            <ul className='text-sm text-muted-foreground space-y-2 list-disc pl-4'>
              <li>Global settings apply to all instances by default.</li>
              <li>When creating a new instance, these credentials will be injected into its environment.</li>
              <li>Password changes are encrypted securely.</li>
              <li>You can override these settings per-instance in the Instance Details modal.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
