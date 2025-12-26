import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Webhook, Send, ArrowLeft, CheckCircle, XCircle, Settings } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { toast } from 'sonner';
import PageHeader from '../components/PageHeader';

export default function NotificationSettings() {
  const { token } = useAuth();
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [testTitle, setTestTitle] = useState('Test Alert');
  const [testBody, setTestBody] = useState('This is a test notification from Multibase Dashboard');
  const [sending, setSending] = useState(false);
  const [lastTestResult, setLastTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  // Send test notification
  const handleSendTest = async (channel: 'console' | 'webhook') => {
    setSending(true);
    setLastTestResult(null);

    try {
      const config = channel === 'webhook' ? { url: webhookUrl, secret: webhookSecret } : {};

      const response = await fetch(`${API_URL}/api/notifications/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          channel,
          config,
          message: {
            title: testTitle,
            body: testBody,
            type: 'info',
          },
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        toast.success(`Test notification sent via ${channel}`);
        setLastTestResult({ success: true, message: `Notification sent successfully via ${channel}` });
      } else {
        toast.error(data.error || 'Failed to send notification');
        setLastTestResult({ success: false, message: data.error || 'Failed to send notification' });
      }
    } catch (error) {
      toast.error('Network error');
      setLastTestResult({ success: false, message: 'Network error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className='min-h-screen bg-background'>
      <PageHeader>
        <div className='flex items-center justify-between'>
          <div>
            <Link
              to='/alerts'
              className='inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-2'
            >
              <ArrowLeft className='w-4 h-4' />
              Back to Alerts
            </Link>
            <h2 className='text-2xl font-bold text-foreground flex items-center gap-2'>
              <Settings className='w-6 h-6' />
              Notification Settings
            </h2>
            <p className='text-muted-foreground mt-1'>Configure alert notification channels</p>
          </div>
        </div>
      </PageHeader>

      <main className='container mx-auto px-6 py-8'>
        <div className='max-w-5xl space-y-6'>
          {/* Available Channels */}
          <div className='bg-card border border-border rounded-lg p-6'>
            <h3 className='text-lg font-semibold text-foreground mb-4 flex items-center gap-2'>
              <Bell className='w-5 h-5 text-primary' />
              Available Channels
            </h3>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
              <div className='bg-secondary/50 border border-border rounded-lg p-4'>
                <div className='flex items-center gap-3'>
                  <div className='w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center'>
                    <CheckCircle className='w-5 h-5 text-green-500' />
                  </div>
                  <div>
                    <p className='font-medium text-foreground'>Console</p>
                    <p className='text-sm text-muted-foreground'>Log to server console</p>
                  </div>
                </div>
              </div>
              <div className='bg-secondary/50 border border-border rounded-lg p-4'>
                <div className='flex items-center gap-3'>
                  <div className='w-10 h-10 bg-blue-500/10 rounded-full flex items-center justify-center'>
                    <Webhook className='w-5 h-5 text-blue-500' />
                  </div>
                  <div>
                    <p className='font-medium text-foreground'>Webhook</p>
                    <p className='text-sm text-muted-foreground'>Send to external URL</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Webhook Configuration */}
          <div className='bg-card border border-border rounded-lg p-6'>
            <h3 className='text-lg font-semibold text-foreground mb-6 flex items-center gap-2'>
              <Webhook className='w-5 h-5 text-blue-500' />
              Webhook Configuration
            </h3>

            <div className='grid grid-cols-1 lg:grid-cols-2 gap-8'>
              {/* Settings Column */}
              <div className='space-y-4'>
                <div>
                  <label className='block text-sm text-muted-foreground mb-1'>Webhook URL</label>
                  <input
                    type='url'
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder='https://your-webhook-endpoint.com/alerts'
                    className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                  />
                </div>
                <div>
                  <label className='block text-sm text-muted-foreground mb-1'>Webhook Secret (optional)</label>
                  <input
                    type='password'
                    value={webhookSecret}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                    placeholder='••••••••'
                    className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                  />
                  <p className='text-xs text-muted-foreground mt-1'>Will be sent as X-Webhook-Secret header</p>
                </div>
              </div>

              {/* Explanation Column */}
              <div className='bg-secondary/20 border border-border rounded-lg p-5'>
                <h4 className='text-base font-medium text-foreground mb-3'>What is a Webhook URL?</h4>
                <div className='space-y-3 text-sm text-muted-foreground'>
                  <p>The Webhook URL is the address of the external service where alert data should be sent.</p>
                  <p>
                    <strong>Provider Examples:</strong>
                  </p>
                  <ul className='list-disc pl-4 space-y-1'>
                    <li>
                      <span className='font-medium text-foreground'>Discord:</span> 'Settings' &rarr; 'Integrations'
                      &rarr; 'Webhooks'
                    </li>
                    <li>
                      <span className='font-medium text-foreground'>Slack:</span> 'Apps' &rarr; 'Incoming Webhooks'
                    </li>
                    <li>
                      <span className='font-medium text-foreground'>MS Teams:</span> Channel Settings &rarr;
                      'Connectors'
                    </li>
                    <li>
                      <span className='font-medium text-foreground'>Automation:</span> Zapier, n8n, Make
                    </li>
                  </ul>
                  <p className='pt-2 italic border-t border-border mt-3'>
                    In short: If you want to see the alert in your chat app, paste the URL provided by that service
                    here.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Test Notification */}
          <div className='bg-card border border-border rounded-lg p-6'>
            <h3 className='text-lg font-semibold text-foreground mb-4 flex items-center gap-2'>
              <Send className='w-5 h-5 text-yellow-500' />
              Send Test Notification
            </h3>
            <div className='space-y-4'>
              <div>
                <label className='block text-sm text-muted-foreground mb-1'>Title</label>
                <input
                  type='text'
                  value={testTitle}
                  onChange={(e) => setTestTitle(e.target.value)}
                  className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary'
                />
              </div>
              <div>
                <label className='block text-sm text-muted-foreground mb-1'>Message</label>
                <textarea
                  value={testBody}
                  onChange={(e) => setTestBody(e.target.value)}
                  rows={3}
                  className='w-full bg-secondary border border-border rounded-md px-4 py-2 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none'
                />
              </div>

              {/* Test Result */}
              {lastTestResult && (
                <div
                  className={`flex items-center gap-2 p-3 rounded-lg ${
                    lastTestResult.success
                      ? 'bg-green-500/10 border border-green-500/30 text-green-500'
                      : 'bg-red-500/10 border border-red-500/30 text-red-500'
                  }`}
                >
                  {lastTestResult.success ? <CheckCircle className='w-4 h-4' /> : <XCircle className='w-4 h-4' />}
                  <span className='text-sm'>{lastTestResult.message}</span>
                </div>
              )}

              <div className='flex gap-3'>
                <button
                  onClick={() => handleSendTest('console')}
                  disabled={sending}
                  className='flex-1 px-4 py-2 bg-secondary border border-border rounded-md hover:bg-muted disabled:opacity-50 transition-colors flex items-center justify-center gap-2'
                >
                  <Send className='w-4 h-4' />
                  Test Console
                </button>
                <button
                  onClick={() => handleSendTest('webhook')}
                  disabled={sending || !webhookUrl}
                  className='flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-2'
                >
                  <Webhook className='w-4 h-4' />
                  Test Webhook
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
