import { useState } from 'react';
import { Key, Loader2, Trash2, CheckCircle2, ChevronDown } from 'lucide-react';
import { useAiKeyStatus, useSaveAiKey, useDeleteAiKey } from '../hooks/useAiAgent';
import { toast } from 'sonner';

// Provider definitions with available models
const AI_PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      { id: 'gpt-5.5', name: 'GPT-5.5', description: 'Frontier quality' },
      { id: 'gpt-5.4', name: 'GPT-5.4', description: 'Professional quality at lower cost' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', description: 'Strong coding at low cost' },
      { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', description: 'Fastest, cheapest 5.4 tier' },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Very low-cost tool calling' },
      { id: 'gpt-5-nano', name: 'GPT-5 Nano', description: 'Lowest-cost GPT-5 tier' },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Frontier capability' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', description: 'Balanced quality and cost' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'Fast, cost-efficient' },
    ],
    placeholder: 'sk-...',
    color: 'emerald',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      { id: 'claude-fable-5', name: 'Claude Fable 5', description: 'Highest capability' },
      { id: 'claude-opus-5', name: 'Claude Opus 5', description: 'Complex agentic work' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', description: 'Balanced speed and quality' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: 'Fastest, cost-efficient' },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Latest, balanced' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Powerful & fast' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest, cheapest' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Most capable' },
    ],
    placeholder: 'sk-ant-...',
    color: 'orange',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    models: [
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', description: 'Latest stable, agentic and multimodal' },
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Frontier coding and reasoning' },
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', description: 'Fastest, lowest cost' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', description: 'Advanced reasoning (preview)' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Deep reasoning and coding' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast reasoning and tool use' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Latest, fast' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast & efficient' },
    ],
    placeholder: 'AIza...',
    color: 'blue',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    models: [
      { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'via OpenRouter' },
      { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', description: 'via OpenRouter' },
      { id: 'google/gemini-3.6-flash', name: 'Gemini 3.6 Flash', description: 'via OpenRouter' },
      { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', description: 'via OpenRouter' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', description: 'via OpenRouter' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'via OpenRouter' },
      { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'via OpenRouter' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'via OpenRouter' },
      { id: 'google/gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', description: 'via OpenRouter' },
      { id: 'meta-llama/llama-3.1-405b-instruct', name: 'Llama 3.1 405B', description: 'Open source' },
      { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', description: 'Open source' },
      { id: 'mistralai/mistral-large-latest', name: 'Mistral Large', description: 'European AI' },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', description: 'Efficient reasoning' },
      { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', description: 'Alibaba AI' },
    ],
    placeholder: 'sk-or-v1-...',
    color: 'purple',
  },
];

export default function AiKeySection() {
  const { data: keyStatus, isLoading } = useAiKeyStatus();
  const saveKey = useSaveAiKey();
  const deleteKey = useDeleteAiKey();

  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-5.4-mini');
  const [apiKey, setApiKey] = useState('');

  const selectedProvider = AI_PROVIDERS.find((p) => p.id === provider);

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const prov = AI_PROVIDERS.find((p) => p.id === newProvider);
    if (prov && prov.models.length > 0) {
      setModel(prov.models[0].id);
    }
  };

  const handleSave = async () => {
    if (!apiKey.trim()) {
      toast.error('Please enter an API key');
      return;
    }
    try {
      await saveKey.mutateAsync({ provider, apiKey, model });
      toast.success('AI configuration saved successfully');
      setApiKey('');
    } catch (error: any) {
      toast.error(error.message || 'Failed to save AI configuration');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteKey.mutateAsync();
      toast.success('AI configuration removed');
    } catch (error: any) {
      toast.error(error.message || 'Failed to remove AI configuration');
    }
  };

  if (isLoading) {
    return (
      <div className='space-y-4'>
        <div className='flex items-center gap-2'>
          <Loader2 className='w-4 h-4 animate-spin text-purple-400' />
          <span className='text-muted-foreground'>Loading AI configuration...</span>
        </div>
      </div>
    );
  }

  if (keyStatus?.configured) {
    const configuredProvider = AI_PROVIDERS.find((p) => p.id === keyStatus.provider);
    return (
      <div className='space-y-4'>
        <div className='flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl'>
          <CheckCircle2 className='w-5 h-5 text-green-400 flex-shrink-0' />
          <div className='flex-1 min-w-0'>
            <p className='text-sm font-medium text-foreground'>
              Connected to {configuredProvider?.name || keyStatus.provider}
            </p>
            <p className='text-xs text-muted-foreground'>
              {keyStatus.model ? `Model: ${keyStatus.model}` : 'AI assistant is ready to use'}
            </p>
          </div>
          <button
            onClick={handleDelete}
            disabled={deleteKey.isPending}
            className='flex items-center gap-2 px-3 py-1.5 text-xs bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 text-destructive rounded-lg transition-colors disabled:opacity-50'
          >
            {deleteKey.isPending ? <Loader2 className='w-3 h-3 animate-spin' /> : <Trash2 className='w-3 h-3' />}
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-5'>
      {/* Provider Selection */}
      <div>
        <label className='block text-sm font-medium text-foreground mb-3'>AI Provider</label>
        <div className='grid grid-cols-2 sm:grid-cols-4 gap-2'>
          {AI_PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id)}
              className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                provider === p.id
                  ? 'bg-purple-500/20 border-purple-500/50 text-purple-300 shadow-lg shadow-purple-500/10'
                  : 'bg-card/50 border-border text-muted-foreground hover:border-purple-500/30 hover:text-foreground'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Model Selection */}
      {selectedProvider && (
        <div>
          <label className='block text-sm font-medium text-foreground mb-2'>
            <ChevronDown className='w-4 h-4 inline-block mr-1' />
            Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className='w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none'
          >
            {selectedProvider.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.description}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* API Key */}
      <div>
        <label className='block text-sm font-medium text-foreground mb-2'>
          <Key className='w-4 h-4 inline-block mr-1' />
          API Key
        </label>
        <input
          type='password'
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={selectedProvider?.placeholder || 'Enter API key...'}
          className='w-full px-4 py-2.5 bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-purple-500/50'
        />
        <p className='text-xs text-muted-foreground mt-1.5'>Your key is encrypted with AES-256-GCM before storage</p>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={!apiKey.trim() || saveKey.isPending}
        className='flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 text-purple-300 rounded-lg transition-all disabled:opacity-50 hover:shadow-lg hover:shadow-purple-500/10'
      >
        {saveKey.isPending ? <Loader2 className='w-4 h-4 animate-spin' /> : <CheckCircle2 className='w-4 h-4' />}
        Save Configuration
      </button>
    </div>
  );
}
