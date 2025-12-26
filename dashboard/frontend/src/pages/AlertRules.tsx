import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Plus, Trash2, ArrowLeft, ToggleLeft, ToggleRight, Pencil } from 'lucide-react';
import { useAlertRules, useCreateAlertRule, useDeleteAlertRule, useUpdateAlertRule } from '../hooks/useAlerts';
import { useInstances } from '../hooks/useInstances';
import { Alert, CreateAlertRuleRequest } from '../types';
import { format } from 'date-fns';
import PageHeader from '../components/PageHeader';

export default function AlertRules() {
  const { data: rules, isLoading: rulesLoading } = useAlertRules();
  const { data: instances } = useInstances();
  const createRule = useCreateAlertRule();
  const updateRule = useUpdateAlertRule();
  const deleteRule = useDeleteAlertRule();

  const [isCreating, setIsCreating] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  const [formData, setFormData] = useState<Partial<CreateAlertRuleRequest>>({
    instanceId: '',
    name: '',
    rule: 'high_cpu',
    condition: {},
    threshold: 80,
    duration: 300,
    enabled: true,
    notificationChannels: ['browser'],
    webhookUrl: '',
  });

  const resetForm = () => {
    setFormData({
      instanceId: '',
      name: '',
      rule: 'high_cpu',
      condition: {},
      threshold: 80,
      duration: 300,
      enabled: true,
      notificationChannels: ['browser'],
      webhookUrl: '',
    });
    setEditId(null);
    setIsCreating(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.instanceId || !formData.name || !formData.rule) {
      return;
    }

    const ruleData: CreateAlertRuleRequest = {
      instanceId: formData.instanceId,
      name: formData.name,
      rule: formData.rule,
      condition: formData.condition || {},
      threshold: formData.threshold,
      duration: formData.duration,
      enabled: formData.enabled,
      notificationChannels: formData.notificationChannels,
      webhookUrl: formData.webhookUrl,
    };

    if (editId) {
      await updateRule.mutateAsync({
        id: editId,
        updates: ruleData,
      });
    } else {
      await createRule.mutateAsync(ruleData);
    }

    resetForm();
  };

  const handleEdit = (rule: Alert) => {
    setFormData({
      instanceId: rule.instanceId,
      name: rule.name,
      rule: rule.rule,
      condition: {},
      threshold: rule.threshold,
      duration: rule.duration,
      enabled: rule.enabled,
      notificationChannels: rule.notificationChannels ? JSON.parse(rule.notificationChannels) : ['browser'],
      webhookUrl: rule.webhookUrl || '',
    });
    setEditId(rule.id);
    setIsCreating(true);
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleEnabled = async (rule: Alert) => {
    await updateRule.mutateAsync({
      id: rule.id,
      updates: { enabled: !rule.enabled },
    });
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this alert rule?')) {
      await deleteRule.mutateAsync(id);
    }
  };

  const getRuleName = (rule: string) => {
    const ruleMap: Record<string, string> = {
      service_down: 'Service Down',
      high_cpu: 'High CPU Usage',
      high_memory: 'High Memory Usage',
      high_disk: 'High Disk Usage',
      slow_response: 'Slow Response Time',
    };
    return ruleMap[rule] || rule;
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
              Alert Rules
            </h2>
            <p className='text-muted-foreground mt-1'>Configure alert rules and notification settings</p>
          </div>
          <button
            onClick={() => {
              if (isCreating) resetForm();
              else setIsCreating(true);
            }}
            className='flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors'
          >
            <Plus className='w-4 h-4' />
            {isCreating ? 'Cancel' : 'Create Rule'}
          </button>
        </div>
      </PageHeader>

      {/* Main Content */}
      <main className='container mx-auto px-6 py-8'>
        {/* Create/Edit Rule Form */}
        {isCreating && (
          <div className='bg-card border rounded-lg p-6 mb-6'>
            <h2 className='text-xl font-semibold mb-4'>{editId ? 'Edit Alert Rule' : 'Create New Alert Rule'}</h2>
            <form onSubmit={handleSubmit} className='space-y-4'>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                {/* Instance Selection */}
                <div>
                  <label className='block text-sm font-medium mb-1 text-foreground'>
                    Instance <span className='text-destructive'>*</span>
                  </label>
                  <select
                    value={formData.instanceId}
                    onChange={(e) => setFormData({ ...formData, instanceId: e.target.value })}
                    required
                    className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                  >
                    <option value=''>Select instance...</option>
                    {instances?.map((instance) => (
                      <option key={instance.id} value={instance.id}>
                        {instance.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Rule Name */}
                <div>
                  <label className='block text-sm font-medium mb-1 text-foreground'>
                    Rule Name <span className='text-destructive'>*</span>
                  </label>
                  <input
                    type='text'
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder='e.g., High CPU Alert'
                    required
                    className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                  />
                </div>

                {/* Rule Type */}
                <div>
                  <label className='block text-sm font-medium mb-1 text-foreground'>
                    Rule Type <span className='text-destructive'>*</span>
                  </label>
                  <select
                    value={formData.rule}
                    onChange={(e) => setFormData({ ...formData, rule: e.target.value })}
                    required
                    className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                  >
                    <option value='high_cpu'>High CPU Usage</option>
                    <option value='high_memory'>High Memory Usage</option>
                    <option value='high_disk'>High Disk Usage</option>
                    <option value='service_down'>Service Down</option>
                    <option value='slow_response'>Slow Response Time</option>
                  </select>
                </div>

                {/* Threshold */}
                <div>
                  <label className='block text-sm font-medium mb-1 text-foreground'>Threshold (%)</label>
                  <input
                    type='number'
                    value={formData.threshold || ''}
                    onChange={(e) => setFormData({ ...formData, threshold: parseFloat(e.target.value) })}
                    placeholder='80'
                    min='0'
                    max='100'
                    className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                  />
                </div>

                {/* Duration */}
                <div>
                  <label className='block text-sm font-medium mb-1 text-foreground'>Duration (seconds)</label>
                  <input
                    type='number'
                    value={formData.duration || ''}
                    onChange={(e) => setFormData({ ...formData, duration: parseInt(e.target.value, 10) })}
                    placeholder='300'
                    min='0'
                    className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                  />
                  <p className='text-xs text-muted-foreground mt-1'>
                    How long the condition must persist before triggering
                  </p>
                </div>
                {/* Webhook URL */}
                <div className='md:col-span-2'>
                  <label className='block text-sm font-medium mb-1 text-foreground'>Webhook URL</label>
                  <input
                    type='url'
                    value={formData.webhookUrl || ''}
                    onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                    placeholder='https://api.example.com/webhooks/alerts'
                    className='w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary bg-input text-foreground'
                  />
                  <p className='text-xs text-muted-foreground mt-1'>
                    Optional: URL to receive a POST request when this alert triggers
                  </p>
                </div>
              </div>

              {/* Notification Channels */}
              <div className='border-t border-border pt-4 mt-4'>
                <h3 className='text-sm font-medium mb-3 text-foreground'>Notification Channels</h3>
                <div className='flex gap-4'>
                  <label className='flex items-center gap-2 cursor-pointer'>
                    <input
                      type='checkbox'
                      checked={formData.notificationChannels?.includes('browser')}
                      onChange={(e) => {
                        const channels = formData.notificationChannels || [];
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            notificationChannels: [...channels, 'browser'],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            notificationChannels: channels.filter((c) => c !== 'browser'),
                          });
                        }
                      }}
                      className='rounded border-border text-primary focus:ring-primary bg-input'
                    />
                    <span className='text-sm text-foreground'>Browser Alert</span>
                  </label>

                  <label className='flex items-center gap-2 cursor-pointer'>
                    <input
                      type='checkbox'
                      checked={formData.notificationChannels?.includes('email')}
                      onChange={(e) => {
                        const channels = formData.notificationChannels || [];
                        if (e.target.checked) {
                          setFormData({
                            ...formData,
                            notificationChannels: [...channels, 'email'],
                          });
                        } else {
                          setFormData({
                            ...formData,
                            notificationChannels: channels.filter((c) => c !== 'email'),
                          });
                        }
                      }}
                      className='rounded border-border text-primary focus:ring-primary bg-input'
                    />
                    <span className='text-sm text-foreground'>Email Notification</span>
                  </label>
                </div>
                <p className='text-xs text-muted-foreground mt-2'>
                  Email notifications require global SMTP settings to be configured.
                </p>
              </div>

              <div className='flex gap-3 pt-4'>
                <button
                  type='button'
                  onClick={resetForm}
                  className='flex-1 px-4 py-2 border border-border rounded-md text-foreground hover:bg-muted transition-colors'
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  disabled={createRule.isPending || updateRule.isPending}
                  className='flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                >
                  {editId
                    ? updateRule.isPending
                      ? 'Updating...'
                      : 'Update Rule'
                    : createRule.isPending
                    ? 'Creating...'
                    : 'Create Rule'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Rules List */}
        <div className='bg-card border rounded-lg overflow-hidden'>
          {rulesLoading ? (
            <div className='flex items-center justify-center py-12'>
              <div className='w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin' />
            </div>
          ) : !rules || rules.length === 0 ? (
            <div className='text-center py-12'>
              <Settings className='w-16 h-16 text-muted-foreground mx-auto mb-4' />
              <h3 className='text-xl font-semibold mb-2'>No alert rules configured</h3>
              <p className='text-muted-foreground mb-4'>Create your first alert rule to start monitoring</p>
              <button
                onClick={() => setIsCreating(true)}
                className='inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90'
              >
                <Plus className='w-4 h-4' />
                Create Rule
              </button>
            </div>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full'>
                <thead className='bg-muted/50'>
                  <tr>
                    <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                      Rule Name
                    </th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                      Instance
                    </th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                      Type
                    </th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                      Threshold
                    </th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                      Status
                    </th>
                    <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                      Created
                    </th>
                    <th className='px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className='divide-y'>
                  {rules.map((rule) => (
                    <tr key={rule.id} className='hover:bg-muted/30'>
                      <td className='px-6 py-4'>
                        <div className='font-medium'>{rule.name}</div>
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap'>
                        <Link to={`/instances/${rule.instance?.name}`} className='text-primary hover:underline'>
                          {rule.instance?.name || rule.instanceId}
                        </Link>
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap'>
                        <span className='text-sm'>{getRuleName(rule.rule)}</span>
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap'>
                        <span className='text-sm'>{rule.threshold ? `${rule.threshold}%` : 'N/A'}</span>
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap'>
                        <button
                          onClick={() => handleToggleEnabled(rule)}
                          disabled={updateRule.isPending}
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            rule.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {rule.enabled ? (
                            <>
                              <ToggleRight className='w-4 h-4' />
                              Enabled
                            </>
                          ) : (
                            <>
                              <ToggleLeft className='w-4 h-4' />
                              Disabled
                            </>
                          )}
                        </button>
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap text-sm text-muted-foreground'>
                        {format(new Date(rule.createdAt), 'MMM d, yyyy')}
                      </td>
                      <td className='px-6 py-4 whitespace-nowrap text-right text-sm'>
                        <div className='flex items-center justify-end gap-2'>
                          <button
                            onClick={() => handleEdit(rule)}
                            className='inline-flex items-center gap-1 px-3 py-1 bg-secondary text-secondary-foreground border border-border rounded-md hover:bg-muted hover:text-foreground text-xs font-medium transition-colors'
                          >
                            <Pencil className='w-3 h-3' />
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(rule.id)}
                            disabled={deleteRule.isPending}
                            className='inline-flex items-center gap-1 px-3 py-1 bg-destructive text-white rounded-md hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors'
                          >
                            <Trash2 className='w-3 h-3' />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
