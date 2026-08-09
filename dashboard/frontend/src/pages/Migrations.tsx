import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInstancesAll } from '../hooks/useInstances';
import {
  useMigrationHistory,
  useMigrationTemplates,
  useExecuteMigration,
  useValidateSql,
  MigrationHistoryItem,
  useCreateTemplate,
  useDeleteTemplate,
  useSqlDumps,
  useDeleteSqlDump,
  useBulkDeleteSqlDumps,
  useUploadSqlDump,
  useApplySqlDump,
} from '../hooks/useMigrations';
import { migrationsApi } from '../lib/api';
import PageHeader from '../components/PageHeader';
import {
  Loader2,
  Play,
  CheckCircle,
  AlertTriangle,
  Database,
  History,
  FileText,
  Code,
  Upload,
  Save,
  Trash2,
  ArrowLeft,
  FileCode,
  Sparkles,
  RefreshCw,
  Info,
  Maximize2,
  Minimize2,
  Copy,
  PanelRightClose,
  PanelRight,
  Eraser,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Download, FileJson, Check } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';

interface ExecutionResult {
  message: string;
  migration: MigrationHistoryItem;
  result?: {
    command: string;
    rowCount: number;
    rows: any[];
  };
}

export default function Migrations() {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('');
  const [sql, setSql] = useState('');
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string } | null>(null);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [showSaveTemplateDialog, setShowSaveTemplateDialog] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDescription, setNewTemplateDescription] = useState('');

  // Editor UI & Layout state
  const [isTemplatesCollapsed, setIsTemplatesCollapsed] = useState(false);
  const [editorHeight, setEditorHeight] = useState<'medium' | 'large' | 'fullscreen'>('medium');

  // SQL Dump Manager state
  const [selectedDumpFiles, setSelectedDumpFiles] = useState<string[]>([]);
  const [inspectDumpModal, setInspectDumpModal] = useState<{
    isOpen: boolean;
    filename: string;
    data?: any;
    isLoading: boolean;
  }>({ isOpen: false, filename: '', isLoading: false });
  const [applyDumpModal, setApplyDumpModal] = useState<{
    isOpen: boolean;
    filename: string;
    targetInstance: string;
    isLoading: boolean;
  }>({ isOpen: false, filename: '', targetInstance: '', isLoading: false });

  // Queries
  const { data: instances, isLoading: instancesLoading } = useInstancesAll();
  const { data: historyData, isLoading: historyLoading } = useMigrationHistory(selectedInstanceId);
  const { data: templatesData } = useMigrationTemplates();
  const { data: sqlDumps, isLoading: dumpsLoading, refetch: refetchDumps } = useSqlDumps();

  // Mutations
  const executeMutation = useExecuteMigration();
  const validateMutation = useValidateSql();
  const createTemplateMutation = useCreateTemplate();
  const deleteTemplateMutation = useDeleteTemplate();
  const deleteDumpMutation = useDeleteSqlDump();
  const bulkDeleteDumpsMutation = useBulkDeleteSqlDumps();
  const uploadDumpMutation = useUploadSqlDump();
  const applyDumpMutation = useApplySqlDump();

  // Set default instance if available and not selected
  if (instances && instances.length > 0 && !selectedInstanceId) {
    const running = instances.find((i) => i.status === 'running');
    setSelectedInstanceId(running ? running.name : instances[0].name);
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const handleDumpFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.sql')) {
      toast.error('Please upload a .sql file');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      try {
        await uploadDumpMutation.mutateAsync({ filename: file.name, content });
      } catch {
        // Handled in mutation
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleLoadDumpIntoEditor = async (filename: string) => {
    try {
      const dump = await migrationsApi.getDump(filename);
      setSql(dump.content);
      toast.success(`Loaded dump ${filename} into editor`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      toast.error(e.message || 'Failed to load SQL dump');
    }
  };

  const handleInspectDump = async (filename: string) => {
    setInspectDumpModal({ isOpen: true, filename, isLoading: true });
    try {
      const info = await migrationsApi.inspectDump(filename);
      setInspectDumpModal({ isOpen: true, filename, data: info, isLoading: false });
    } catch {
      toast.error('Failed to inspect SQL dump');
      setInspectDumpModal({ isOpen: false, filename: '', isLoading: false });
    }
  };

  const handleOpenApplyModal = (filename: string, suggestedInstance?: string) => {
    const defaultTarget = suggestedInstance || selectedInstanceId || (instances && instances[0]?.name) || '';
    setApplyDumpModal({ isOpen: true, filename, targetInstance: defaultTarget, isLoading: false });
  };

  const handleConfirmApplyDump = async () => {
    if (!applyDumpModal.filename || !applyDumpModal.targetInstance) {
      toast.error('Please select a target instance');
      return;
    }

    setApplyDumpModal((prev) => ({ ...prev, isLoading: true }));
    try {
      await applyDumpMutation.mutateAsync({
        filename: applyDumpModal.filename,
        instanceId: applyDumpModal.targetInstance,
      });
      setApplyDumpModal({ isOpen: false, filename: '', targetInstance: '', isLoading: false });
    } catch {
      setApplyDumpModal((prev) => ({ ...prev, isLoading: false }));
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.sql')) {
      toast.error('Please upload a .sql file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setSql(content);
      toast.success('SQL file imported');
    };
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
  };

  const handleSaveTemplate = async () => {
    if (!newTemplateName.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (!sql.trim()) {
      toast.error('SQL content is required');
      return;
    }

    try {
      await createTemplateMutation.mutateAsync({
        name: newTemplateName,
        description: newTemplateDescription,
        sql: sql,
      });
      setShowSaveTemplateDialog(false);
      setNewTemplateName('');
      setNewTemplateDescription('');
    } catch (e) {
      // handled by mutation
    }
  };

  const handleDeleteTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this template?')) {
      try {
        await deleteTemplateMutation.mutateAsync(id);
      } catch (e) {
        // handled
      }
    }
  };

  const handleExecute = async (dryRun: boolean) => {
    if (!selectedInstanceId) {
      toast.error('Please select an instance');
      return;
    }
    if (!sql.trim()) {
      toast.error('Please enter SQL query');
      return;
    }

    try {
      const data = await executeMutation.mutateAsync({
        instanceId: selectedInstanceId,
        sql,
        dryRun,
      });

      if (!dryRun) {
        setExecutionResult(data);
      }
    } catch (e) {
      // Error handled by mutation
      setExecutionResult(null);
    }
  };

  const downloadCsv = () => {
    if (!executionResult?.result?.rows || executionResult.result.rows.length === 0) return;

    const rows = executionResult.result.rows;
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((header) => {
            const value = row[header];
            // Handle strings with commas or quotes, and objects
            if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
            if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
            return value;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `query_result_${format(new Date(), 'yyyyMMdd_HHmmss')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderResult = () => {
    if (!executionResult?.result) return null;

    const { command, rowCount, rows } = executionResult.result;

    if (command === 'SELECT' && Array.isArray(rows) && rows.length > 0) {
      const headers = Object.keys(rows[0]);
      return (
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <span className='text-sm text-muted-foreground'>
                {rowCount} row{rowCount !== 1 ? 's' : ''} returned
              </span>
            </div>
            <button
              onClick={downloadCsv}
              className='text-xs flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-muted text-secondary-foreground rounded-md transition-colors'
            >
              <Download className='w-3.5 h-3.5' />
              Download CSV
            </button>
          </div>

          <div className='border border-border rounded-lg overflow-hidden overflow-x-auto'>
            <table className='min-w-full divide-y divide-border'>
              <thead className='bg-muted/50'>
                <tr>
                  {headers.map((header) => (
                    <th
                      key={header}
                      className='px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap'
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className='bg-card divide-y divide-border'>
                {rows.map((row, i) => (
                  <tr key={i} className='hover:bg-muted/50'>
                    {headers.map((header) => {
                      const value = row[header];
                      return (
                        <td key={`${i}-${header}`} className='px-4 py-2 text-sm text-foreground whitespace-nowrap'>
                          {typeof value === 'object' && value !== null ? (
                            <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                              <FileJson className='w-3 h-3' />
                              JSON
                            </div>
                          ) : (
                            String(value)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (command === 'SELECT' && Array.isArray(rows) && rows.length === 0) {
      return (
        <div className='p-4 text-center text-muted-foreground border border-dashed border-border rounded-lg'>
          No rows returned
        </div>
      );
    }

    return (
      <div className='p-4 bg-green-500/10 border border-green-200 rounded-lg text-green-700 flex items-center gap-2'>
        <CheckCircle className='w-5 h-5' />
        <span className='font-medium'>
          Query executed successfully. {rowCount} row{rowCount !== 1 ? 's' : ''} affected.
        </span>
      </div>
    );
  };

  const handleValidate = async () => {
    if (!sql.trim()) return;
    try {
      const result = await validateMutation.mutateAsync(sql);
      setValidationResult({ valid: result.valid, error: result.error });
    } catch (e) {
      setValidationResult(null);
    }
  };

  const handleTemplateSelect = (templateSql: string) => {
    setSql(templateSql);
    setValidationResult(null);
  };

  if (instancesLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <Loader2 className='w-8 h-8 animate-spin text-primary' />
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-background pb-12'>
      <PageHeader>
        <div className='flex items-center justify-between'>
          <div>
            <Link to='/' className='inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-2'>
              <ArrowLeft className='w-4 h-4' />
              Back to Dashboard
            </Link>
            <h1 className='text-3xl font-bold tracking-tight text-foreground'>Database Migrations</h1>
            <p className='text-muted-foreground mt-1'>Manage generic SQL migrations for your instances</p>
          </div>

          {/* Instance Selector */}
          <div className='flex items-center gap-3 bg-card p-2 rounded-lg border border-border shadow-sm'>
            <Database className='w-4 h-4 text-muted-foreground' />
            <Select.Root value={selectedInstanceId} onValueChange={setSelectedInstanceId}>
              <Select.Trigger className='inline-flex items-center justify-between gap-2 min-w-[200px] px-3 py-1.5 text-sm font-medium bg-transparent hover:bg-secondary/50 rounded-md outline-none cursor-pointer transition-colors'>
                <Select.Value placeholder='Select Instance' />
                <Select.Icon>
                  <ChevronDown className='w-4 h-4 text-muted-foreground' />
                </Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content
                  className='overflow-hidden bg-card border border-border rounded-lg shadow-xl z-50'
                  position='popper'
                  sideOffset={5}
                >
                  <Select.Viewport className='p-1'>
                    {instances?.map((i) => (
                      <Select.Item
                        key={i.id}
                        value={i.name}
                        className='relative flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer outline-none select-none data-[highlighted]:bg-primary/20 data-[highlighted]:text-foreground text-foreground transition-colors'
                      >
                        <Select.ItemText>
                          <span className='flex items-center gap-2'>
                            {i.name}
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                i.status === 'running'
                                  ? 'bg-green-500/20 text-green-400'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {i.status}
                            </span>
                          </span>
                        </Select.ItemText>
                        <Select.ItemIndicator className='absolute right-2'>
                          <Check className='w-4 h-4 text-primary' />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </div>
        </div>
      </PageHeader>

      <main className='container mx-auto px-6 py-8'>
        {/* Editor & Templates Grid */}
        <div className={`grid grid-cols-1 ${isTemplatesCollapsed ? '' : 'lg:grid-cols-3'} gap-6 mb-8 transition-all duration-300`}>
          {/* Editor Section */}
          <div className={`${isTemplatesCollapsed ? 'lg:col-span-3' : 'lg:col-span-2'} space-y-4`}>
            <div className='bg-card border border-border rounded-lg shadow-sm overflow-hidden flex flex-col'>
              {/* Toolbar */}
              <div className='flex items-center justify-between px-4 py-3 bg-secondary/50 border-b border-border flex-wrap gap-2'>
                <div className='flex items-center gap-3'>
                  <div className='flex items-center gap-2'>
                    <Code className='w-4 h-4 text-primary' />
                    <h2 className='text-sm font-semibold'>SQL Editor</h2>
                  </div>

                  {/* Collapse / Expand Templates Toggle Button */}
                  <button
                    onClick={() => setIsTemplatesCollapsed(!isTemplatesCollapsed)}
                    className='hidden sm:flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground bg-secondary hover:bg-muted px-2.5 py-1 rounded-md border border-border transition-colors'
                    title={isTemplatesCollapsed ? 'Show Templates Sidebar' : 'Hide Templates Sidebar'}
                  >
                    {isTemplatesCollapsed ? (
                      <>
                        <PanelRight className='w-3.5 h-3.5 text-primary' />
                        Show Templates
                      </>
                    ) : (
                      <>
                        <PanelRightClose className='w-3.5 h-3.5' />
                        Expand Editor
                      </>
                    )}
                  </button>
                </div>

                <div className='flex items-center gap-2 flex-wrap'>
                  <button
                    onClick={() => {
                      if (sql.trim()) {
                        navigator.clipboard.writeText(sql);
                        toast.success('SQL copied to clipboard');
                      }
                    }}
                    disabled={!sql.trim()}
                    className='p-1.5 text-xs bg-secondary hover:bg-muted disabled:opacity-40 rounded-md transition-colors border border-border text-muted-foreground hover:text-foreground'
                    title='Copy SQL'
                  >
                    <Copy className='w-3.5 h-3.5' />
                  </button>

                  <button
                    onClick={() => {
                      if (sql.trim() && confirm('Clear editor content?')) {
                        setSql('');
                        setValidationResult(null);
                      }
                    }}
                    disabled={!sql.trim()}
                    className='p-1.5 text-xs bg-secondary hover:bg-muted disabled:opacity-40 rounded-md transition-colors border border-border text-muted-foreground hover:text-foreground'
                    title='Clear Editor'
                  >
                    <Eraser className='w-3.5 h-3.5' />
                  </button>

                  <div className='relative'>
                    <input
                      type='file'
                      accept='.sql'
                      onChange={handleFileUpload}
                      className='absolute inset-0 w-full h-full opacity-0 cursor-pointer'
                      title='Import SQL File'
                    />
                    <button className='text-xs bg-secondary hover:bg-muted px-2.5 py-1.5 rounded-md transition-colors border border-border flex items-center gap-1.5'>
                      <Upload className='w-3.5 h-3.5' />
                      Import .sql
                    </button>
                  </div>

                  <button
                    onClick={() => setShowSaveTemplateDialog(true)}
                    disabled={!sql.trim()}
                    className='text-xs bg-secondary hover:bg-muted px-2.5 py-1.5 rounded-md transition-colors border border-border flex items-center gap-1.5 disabled:opacity-40'
                  >
                    <Save className='w-3.5 h-3.5' />
                    Save Template
                  </button>

                  <div className='w-px h-5 bg-border mx-1 hidden sm:block'></div>

                  {/* Editor Height / Fullscreen Controls */}
                  <button
                    onClick={() => setEditorHeight(editorHeight === 'medium' ? 'large' : 'medium')}
                    className='text-xs bg-secondary hover:bg-muted px-2 py-1.5 rounded-md transition-colors border border-border text-muted-foreground hover:text-foreground font-mono'
                    title='Toggle Editor Height'
                  >
                    {editorHeight === 'large' ? 'Height: Large' : 'Height: Default'}
                  </button>

                  <button
                    onClick={() => setEditorHeight('fullscreen')}
                    className='p-1.5 text-xs bg-secondary hover:bg-muted rounded-md transition-colors border border-border text-muted-foreground hover:text-foreground'
                    title='Fullscreen Mode (Vollbild)'
                  >
                    <Maximize2 className='w-3.5 h-3.5' />
                  </button>

                  <div className='w-px h-5 bg-border mx-1 hidden sm:block'></div>

                  <button
                    onClick={() => handleExecute(true)}
                    disabled={executeMutation.isPending || !selectedInstanceId}
                    className='text-xs bg-secondary hover:bg-muted px-3 py-1.5 rounded-md transition-colors border border-border font-medium'
                  >
                    Test / Dry Run
                  </button>
                  <button
                    onClick={() => handleExecute(false)}
                    disabled={executeMutation.isPending || !selectedInstanceId}
                    className='text-xs bg-primary text-primary-foreground hover:bg-primary/90 px-3.5 py-1.5 rounded-md transition-colors flex items-center gap-1.5 font-medium shadow-sm'
                  >
                    {executeMutation.isPending ? (
                      <Loader2 className='w-3.5 h-3.5 animate-spin' />
                    ) : (
                      <Play className='w-3.5 h-3.5' />
                    )}
                    Execute
                  </button>
                </div>
              </div>

              {/* Code Editor Body with Line Numbers */}
              <div className='flex bg-background relative overflow-hidden flex-1'>
                <div className='bg-muted/30 text-muted-foreground/40 select-none py-4 px-3 text-right font-mono text-xs border-r border-border leading-6 shrink-0 min-w-[42px] overflow-hidden'>
                  {Array.from({ length: Math.max(1, sql.split('\n').length) }, (_, i) => (
                    <div key={i + 1}>{i + 1}</div>
                  ))}
                </div>

                <textarea
                  value={sql}
                  onChange={(e) => {
                    setSql(e.target.value);
                    setValidationResult(null);
                  }}
                  onBlur={handleValidate}
                  placeholder='-- Enter SQL query here...'
                  className={`w-full p-4 font-mono text-sm bg-transparent resize-y focus:outline-none leading-6 ${
                    editorHeight === 'large' ? 'min-h-[600px]' : 'min-h-[440px]'
                  }`}
                  spellCheck={false}
                />
              </div>

              {/* Editor Bottom Status Bar */}
              <div className='flex items-center justify-between px-4 py-2 bg-muted/40 border-t border-border text-xs text-muted-foreground font-mono'>
                <div className='flex items-center gap-4'>
                  <span>Lines: {Math.max(1, sql.split('\n').length)}</span>
                  <span>Chars: {sql.length}</span>
                </div>
                <div>
                  {validationResult && (
                    <span className={`inline-flex items-center gap-1 font-sans px-2.5 py-0.5 rounded text-xs border ${
                      validationResult.valid
                        ? 'bg-green-500/10 text-green-600 border-green-200'
                        : 'bg-red-500/10 text-red-600 border-red-200'
                    }`}>
                      {validationResult.valid ? (
                        <>
                          <CheckCircle className='w-3 h-3' />
                          Valid SQL
                        </>
                      ) : (
                        <>
                          <AlertTriangle className='w-3 h-3' />
                          {validationResult.error}
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Templates Sidebar */}
          {!isTemplatesCollapsed && (
            <div className='space-y-4'>
              <div className='bg-card border border-border rounded-lg shadow-sm h-full max-h-[580px] overflow-hidden flex flex-col'>
                <div className='px-4 py-3 bg-secondary/50 border-b border-border flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <FileText className='w-4 h-4 text-primary' />
                    <h2 className='text-sm font-semibold'>Templates</h2>
                  </div>
                  <button
                    onClick={() => setIsTemplatesCollapsed(true)}
                    className='text-xs text-muted-foreground hover:text-foreground p-1 hover:bg-muted rounded'
                    title='Hide Templates'
                  >
                    <PanelRightClose className='w-3.5 h-3.5' />
                  </button>
                </div>
                <div className='overflow-y-auto p-2 space-y-4 flex-1'>
                  {/* Custom Templates */}
                  <div>
                    <div className='px-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                      Custom
                    </div>
                    {templatesData?.templates.filter((t) => t.category === 'custom').length === 0 && (
                      <div className='text-xs text-muted-foreground px-2 italic'>No custom templates</div>
                    )}
                    {templatesData?.templates
                      .filter((t) => t.category === 'custom')
                      .map((template, idx) => (
                        <div key={idx} className='relative group'>
                          <button
                            onClick={() => handleTemplateSelect(template.sql)}
                            className='w-full text-left px-3 py-2 rounded-md hover:bg-secondary/50 group transition-colors pr-8'
                          >
                            <div className='text-sm font-medium text-foreground group-hover:text-primary transition-colors'>
                              {template.name}
                            </div>
                            <div className='text-xs text-muted-foreground line-clamp-1'>{template.description}</div>
                          </button>
                          <button
                            onClick={(e) => handleDeleteTemplate(template.id, e)}
                            className='absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded transition-all'
                            title='Delete template'
                          >
                            <Trash2 className='w-3.5 h-3.5' />
                          </button>
                        </div>
                      ))}
                  </div>

                  {/* System Templates */}
                  <div>
                    <div className='px-2 pb-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider'>
                      System
                    </div>
                    {templatesData?.templates
                      .filter((t) => t.category !== 'custom')
                      .map((template, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleTemplateSelect(template.sql)}
                          className='w-full text-left px-3 py-2 rounded-md hover:bg-secondary/50 group transition-colors'
                        >
                          <div className='text-sm font-medium text-foreground group-hover:text-primary transition-colors'>
                            {template.name}
                          </div>
                          <div className='text-xs text-muted-foreground line-clamp-1'>{template.description}</div>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fullscreen Editor Dialog */}
        <Dialog.Root open={editorHeight === 'fullscreen'} onOpenChange={(open) => !open && setEditorHeight('medium')}>
          <Dialog.Portal>
            <Dialog.Overlay className='fixed inset-0 bg-background/90 backdrop-blur-md z-50' />
            <Dialog.Content className='fixed inset-4 z-50 flex flex-col bg-background border border-border rounded-xl shadow-2xl overflow-hidden'>
              {/* Header */}
              <div className='flex items-center justify-between px-6 py-3 bg-secondary/80 border-b border-border flex-wrap gap-2'>
                <div className='flex items-center gap-3'>
                  <Code className='w-5 h-5 text-primary' />
                  <h2 className='text-base font-semibold text-foreground'>SQL Editor (Fullscreen)</h2>
                  <span className='text-xs bg-primary/10 text-primary px-2.5 py-0.5 rounded-full font-mono'>
                    Instance: {selectedInstanceId || 'None'}
                  </span>
                </div>

                <div className='flex items-center gap-2'>
                  <button
                    onClick={() => {
                      if (sql.trim()) {
                        navigator.clipboard.writeText(sql);
                        toast.success('SQL copied to clipboard');
                      }
                    }}
                    disabled={!sql.trim()}
                    className='p-2 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40'
                    title='Copy SQL'
                  >
                    <Copy className='w-4 h-4' />
                  </button>
                  <button
                    onClick={() => {
                      if (sql.trim() && confirm('Clear editor content?')) {
                        setSql('');
                        setValidationResult(null);
                      }
                    }}
                    disabled={!sql.trim()}
                    className='p-2 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40'
                    title='Clear Editor'
                  >
                    <Eraser className='w-4 h-4' />
                  </button>
                  <div className='w-px h-6 bg-border mx-1'></div>
                  <button
                    onClick={() => handleExecute(true)}
                    disabled={executeMutation.isPending || !selectedInstanceId}
                    className='text-xs bg-secondary hover:bg-muted px-3 py-1.5 rounded-md transition-colors border border-border font-medium'
                  >
                    Test / Dry Run
                  </button>
                  <button
                    onClick={() => handleExecute(false)}
                    disabled={executeMutation.isPending || !selectedInstanceId}
                    className='text-xs bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-1.5 rounded-md transition-colors flex items-center gap-1.5 font-medium shadow-sm'
                  >
                    {executeMutation.isPending ? (
                      <Loader2 className='w-4 h-4 animate-spin' />
                    ) : (
                      <Play className='w-4 h-4' />
                    )}
                    Execute Query
                  </button>
                  <div className='w-px h-6 bg-border mx-1'></div>
                  <button
                    onClick={() => setEditorHeight('medium')}
                    className='p-1.5 bg-secondary hover:bg-muted text-foreground rounded-md transition-colors border border-border flex items-center gap-1 text-xs font-medium'
                    title='Exit Fullscreen'
                  >
                    <Minimize2 className='w-4 h-4' />
                    Exit Fullscreen
                  </button>
                </div>
              </div>

              {/* Editor Body */}
              <div className='flex-1 flex overflow-hidden relative bg-background'>
                <div className='bg-muted/30 text-muted-foreground/40 select-none py-4 px-4 text-right font-mono text-xs border-r border-border leading-6 shrink-0 min-w-[50px] overflow-hidden'>
                  {Array.from({ length: Math.max(1, sql.split('\n').length) }, (_, i) => (
                    <div key={i + 1}>{i + 1}</div>
                  ))}
                </div>
                <textarea
                  value={sql}
                  onChange={(e) => {
                    setSql(e.target.value);
                    setValidationResult(null);
                  }}
                  onBlur={handleValidate}
                  placeholder='-- Enter SQL query here...'
                  className='w-full h-full p-4 font-mono text-sm bg-transparent resize-none focus:outline-none leading-6'
                  spellCheck={false}
                />
              </div>

              {/* Status Bar */}
              <div className='flex items-center justify-between px-6 py-2.5 bg-muted/40 border-t border-border text-xs text-muted-foreground font-mono'>
                <div className='flex items-center gap-6'>
                  <span>Lines: {Math.max(1, sql.split('\n').length)}</span>
                  <span>Characters: {sql.length}</span>
                </div>
                <div>
                  {validationResult && (
                    <span className={`inline-flex items-center gap-1 font-sans px-2.5 py-0.5 rounded text-xs border ${
                      validationResult.valid
                        ? 'bg-green-500/10 text-green-600 border-green-200'
                        : 'bg-red-500/10 text-red-600 border-red-200'
                    }`}>
                      {validationResult.valid ? (
                        <>
                          <CheckCircle className='w-3.5 h-3.5' />
                          Valid SQL
                        </>
                      ) : (
                        <>
                          <AlertTriangle className='w-3.5 h-3.5' />
                          {validationResult.error}
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Execution Result Section (Full-Width) */}
        {executionResult && (
          <div className='bg-card border border-border rounded-lg shadow-sm p-6 mb-8 animate-in fade-in slide-in-from-top-4 duration-300'>
            <div className='flex items-center justify-between mb-4 border-b border-border pb-3'>
              <div className='flex items-center gap-2'>
                <Database className='w-5 h-5 text-primary' />
                <h2 className='text-base font-semibold'>Execution Results</h2>
              </div>
              <button
                onClick={() => setExecutionResult(null)}
                className='text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted'
              >
                Dismiss
              </button>
            </div>
            {renderResult()}
          </div>
        )}

        {/* Save Template Dialog */}
        <Dialog.Root open={showSaveTemplateDialog} onOpenChange={setShowSaveTemplateDialog}>
          <Dialog.Portal>
            <Dialog.Overlay className='fixed inset-0 bg-background/80 backdrop-blur-sm z-50' />
            <Dialog.Content className='fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg'>
              <div className='flex flex-col space-y-1.5 text-center sm:text-left'>
                <Dialog.Title className='text-lg font-semibold leading-none tracking-tight'>
                  Save as Template
                </Dialog.Title>
                <Dialog.Description className='text-sm text-muted-foreground'>
                  Save current SQL as a reusable template.
                </Dialog.Description>
              </div>
              <div className='grid gap-4 py-4'>
                <div className='grid gap-2'>
                  <label htmlFor='name' className='text-sm font-medium'>
                    Name
                  </label>
                  <input
                    id='name'
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    placeholder='e.g., Get All Users'
                  />
                </div>
                <div className='grid gap-2'>
                  <label htmlFor='description' className='text-sm font-medium'>
                    Description
                  </label>
                  <input
                    id='description'
                    value={newTemplateDescription}
                    onChange={(e) => setNewTemplateDescription(e.target.value)}
                    className='flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    placeholder='Optional description'
                  />
                </div>
              </div>
              <div className='flex justify-end gap-3'>
                <button
                  onClick={() => setShowSaveTemplateDialog(false)}
                  className='inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background border border-input hover:bg-accent hover:text-accent-foreground h-10 py-2 px-4'
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={createTemplateMutation.isPending}
                  className='inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4'
                >
                  {createTemplateMutation.isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                  Save
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* SQL Dump Manager Section */}
        <div className='bg-card border border-border rounded-lg shadow-sm overflow-hidden mb-8'>
          <div className='px-6 py-4 border-b border-border flex items-center justify-between flex-wrap gap-4'>
            <div className='flex items-center gap-2'>
              <FileCode className='w-5 h-5 text-primary' />
              <div>
                <h2 className='text-lg font-semibold flex items-center gap-2'>
                  SQL Dump Manager & Uploads
                  <span className='text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-normal'>
                    {sqlDumps?.length || 0} Dumps
                  </span>
                </h2>
                <p className='text-xs text-muted-foreground'>
                  Inspect, apply to instances, or clean up existing and uploaded .sql dump files.
                </p>
              </div>
            </div>

            <div className='flex items-center gap-3'>
              <button
                onClick={() => refetchDumps()}
                className='p-2 hover:bg-muted rounded-md transition-colors text-muted-foreground hover:text-foreground'
                title='Refresh'
              >
                <RefreshCw className='w-4 h-4' />
              </button>

              <div className='relative'>
                <input
                  type='file'
                  accept='.sql'
                  onChange={handleDumpFileUpload}
                  className='absolute inset-0 w-full h-full opacity-0 cursor-pointer'
                  title='Upload SQL dump file'
                />
                <button
                  disabled={uploadDumpMutation.isPending}
                  className='flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium rounded-md transition-colors shadow-sm'
                >
                  {uploadDumpMutation.isPending ? (
                    <Loader2 className='w-4 h-4 animate-spin' />
                  ) : (
                    <Upload className='w-4 h-4' />
                  )}
                  Upload .sql Dump
                </button>
              </div>
            </div>
          </div>

          {/* Bulk Action Bar */}
          {selectedDumpFiles.length > 0 && (
            <div className='flex items-center justify-between bg-destructive/10 border-b border-destructive/20 px-6 py-3'>
              <span className='text-xs font-medium text-destructive flex items-center gap-1.5'>
                <CheckCircle className='w-4 h-4' />
                {selectedDumpFiles.length} SQL dump(s) selected
              </span>
              <div className='flex items-center gap-2'>
                <button
                  onClick={() => setSelectedDumpFiles([])}
                  className='px-2.5 py-1 text-xs border rounded-md hover:bg-muted transition-colors'
                >
                  Deselect All
                </button>
                <button
                  onClick={async () => {
                    if (confirm(`Are you sure you want to delete ${selectedDumpFiles.length} dump(s)?`)) {
                      await bulkDeleteDumpsMutation.mutateAsync(selectedDumpFiles);
                      setSelectedDumpFiles([]);
                    }
                  }}
                  disabled={bulkDeleteDumpsMutation.isPending}
                  className='flex items-center gap-1 px-3 py-1 bg-destructive text-white text-xs rounded-md hover:bg-destructive/90 transition-colors'
                >
                  <Trash2 className='w-3.5 h-3.5' />
                  Delete Selected ({selectedDumpFiles.length})
                </button>
              </div>
            </div>
          )}

          {/* Dumps Table */}
          <div className='overflow-x-auto'>
            <table className='min-w-full divide-y divide-border'>
              <thead className='bg-muted/50'>
                <tr>
                  <th className='w-10 px-4 py-3 text-left'>
                    <input
                      type='checkbox'
                      checked={!!sqlDumps && sqlDumps.length > 0 && selectedDumpFiles.length === sqlDumps.length}
                      onChange={(e) => {
                        if (e.target.checked && sqlDumps) {
                          setSelectedDumpFiles(sqlDumps.map((d) => d.filename));
                        } else {
                          setSelectedDumpFiles([]);
                        }
                      }}
                      className='rounded border-border text-primary focus:ring-primary cursor-pointer'
                    />
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    Filename
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    Source Instance / Type
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    Size
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    Created / Modified
                  </th>
                  <th className='px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className='bg-card divide-y divide-border'>
                {dumpsLoading ? (
                  <tr>
                    <td colSpan={6} className='px-6 py-8 text-center'>
                      <Loader2 className='w-6 h-6 animate-spin mx-auto text-muted-foreground' />
                    </td>
                  </tr>
                ) : !sqlDumps || sqlDumps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className='px-6 py-8 text-center text-muted-foreground'>
                      No SQL dump files found.
                    </td>
                  </tr>
                ) : (
                  sqlDumps.map((dump) => (
                    <tr key={dump.filename} className='hover:bg-muted/50 transition-colors'>
                      <td className='w-10 px-4 py-3'>
                        <input
                          type='checkbox'
                          checked={selectedDumpFiles.includes(dump.filename)}
                          onChange={() =>
                            setSelectedDumpFiles((prev) =>
                              prev.includes(dump.filename)
                                ? prev.filter((f) => f !== dump.filename)
                                : [...prev, dump.filename]
                            )
                          }
                          className='rounded border-border text-primary focus:ring-primary cursor-pointer'
                        />
                      </td>
                      <td className='px-6 py-3 font-mono text-sm font-medium text-foreground truncate max-w-xs'>
                        {dump.filename}
                      </td>
                      <td className='px-6 py-3 text-xs text-muted-foreground'>
                        {dump.suggestedInstance ? (
                          <span className='inline-flex items-center gap-1 bg-secondary px-2 py-0.5 rounded border border-border text-foreground font-medium'>
                            <Database className='w-3 h-3 text-primary' />
                            {dump.suggestedInstance}
                          </span>
                        ) : (
                          <span className='italic'>—</span>
                        )}
                      </td>
                      <td className='px-6 py-3 text-xs text-foreground font-mono'>{formatBytes(dump.size)}</td>
                      <td className='px-6 py-3 text-xs text-muted-foreground'>
                        {format(new Date(dump.createdAt), 'MMM d, yyyy HH:mm')}
                      </td>
                      <td className='px-6 py-3 text-right'>
                        <div className='flex items-center justify-end gap-2'>
                          <button
                            onClick={() => handleLoadDumpIntoEditor(dump.filename)}
                            className='px-2.5 py-1 text-xs bg-secondary hover:bg-muted border rounded transition-colors flex items-center gap-1'
                            title='Load into SQL editor'
                          >
                            <Code className='w-3.5 h-3.5 text-primary' />
                            Editor
                          </button>
                          <button
                            onClick={() => handleInspectDump(dump.filename)}
                            className='px-2.5 py-1 text-xs bg-secondary hover:bg-muted border rounded transition-colors flex items-center gap-1'
                            title='Inspect structure and metadata'
                          >
                            <Info className='w-3.5 h-3.5 text-blue-500' />
                            Inspect
                          </button>
                          <button
                            onClick={() => handleOpenApplyModal(dump.filename, dump.suggestedInstance)}
                            className='px-2.5 py-1 text-xs bg-primary text-primary-foreground hover:bg-primary/90 rounded transition-colors flex items-center gap-1 font-medium'
                            title='Apply SQL dump to instance'
                          >
                            <Play className='w-3.5 h-3.5' />
                            Apply
                          </button>
                          <button
                            onClick={async () => {
                              if (confirm(`Are you sure you want to delete dump "${dump.filename}"?`)) {
                                await deleteDumpMutation.mutateAsync(dump.filename);
                              }
                            }}
                            className='p-1 text-red-600 hover:text-red-800 hover:bg-red-50 dark:hover:bg-red-950/50 rounded transition-colors'
                            title='Delete dump'
                          >
                            <Trash2 className='w-4 h-4' />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Inspect Dump Modal */}
        <Dialog.Root
          open={inspectDumpModal.isOpen}
          onOpenChange={(open) => !open && setInspectDumpModal({ isOpen: false, filename: '', isLoading: false })}
        >
          <Dialog.Portal>
            <Dialog.Overlay className='fixed inset-0 bg-background/80 backdrop-blur-sm z-50' />
            <Dialog.Content className='fixed left-[50%] top-[50%] z-50 grid w-full max-w-xl translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg'>
              <div className='flex flex-col space-y-1.5'>
                <Dialog.Title className='text-lg font-semibold flex items-center gap-2'>
                  <Info className='w-5 h-5 text-blue-500' />
                  SQL Dump Inspection: {inspectDumpModal.filename}
                </Dialog.Title>
                <Dialog.Description className='text-sm text-muted-foreground'>
                  Analysis of dump content and contained PostgreSQL structures.
                </Dialog.Description>
              </div>

              {inspectDumpModal.isLoading ? (
                <div className='py-8 text-center'>
                  <Loader2 className='w-8 h-8 animate-spin mx-auto text-primary' />
                </div>
              ) : inspectDumpModal.data ? (
                <div className='space-y-4 text-sm'>
                  <div className='grid grid-cols-2 gap-3 bg-muted/50 p-3 rounded-lg border'>
                    <div>
                      <span className='text-xs text-muted-foreground block'>File Size</span>
                      <span className='font-mono font-medium'>{formatBytes(inspectDumpModal.data.size)}</span>
                    </div>
                    <div>
                      <span className='text-xs text-muted-foreground block'>Created At</span>
                      <span className='font-medium'>
                        {format(new Date(inspectDumpModal.data.createdAt), 'MMM d, yyyy HH:mm:ss')}
                      </span>
                    </div>
                    <div>
                      <span className='text-xs text-muted-foreground block'>Tables Found</span>
                      <span className='font-semibold text-primary'>{inspectDumpModal.data.tables?.length || 0}</span>
                    </div>
                    <div>
                      <span className='text-xs text-muted-foreground block'>Contains Data (INSERT)</span>
                      <span className='font-medium'>{inspectDumpModal.data.hasInsert ? 'Yes (Data Present)' : 'No (Schema Only)'}</span>
                    </div>
                  </div>

                  {inspectDumpModal.data.tables?.length > 0 && (
                    <div>
                      <span className='text-xs font-semibold text-muted-foreground block mb-1 uppercase tracking-wider'>
                        Detected Tables ({inspectDumpModal.data.tables.length})
                      </span>
                      <div className='flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-background border rounded-md'>
                        {inspectDumpModal.data.tables.map((tbl: string) => (
                          <span key={tbl} className='text-xs font-mono bg-secondary px-2 py-0.5 rounded border'>
                            {tbl}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <span className='text-xs font-semibold text-muted-foreground block mb-1 uppercase tracking-wider'>
                      Dump Header Preview
                    </span>
                    <pre className='text-xs font-mono bg-muted p-3 rounded-md overflow-x-auto max-h-40 border'>
                      {inspectDumpModal.data.headerPreview}
                    </pre>
                  </div>
                </div>
              ) : null}

              <div className='flex justify-end gap-3 pt-2 border-t'>
                <button
                  onClick={() => setInspectDumpModal({ isOpen: false, filename: '', isLoading: false })}
                  className='px-4 py-2 text-sm border rounded-md hover:bg-muted'
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    const fn = inspectDumpModal.filename;
                    setInspectDumpModal({ isOpen: false, filename: '', isLoading: false });
                    handleOpenApplyModal(fn);
                  }}
                  className='px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium flex items-center gap-1.5'
                >
                  <Play className='w-4 h-4' />
                  Apply Now
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* Apply Dump Modal */}
        <Dialog.Root
          open={applyDumpModal.isOpen}
          onOpenChange={(open) => !open && setApplyDumpModal({ isOpen: false, filename: '', targetInstance: '', isLoading: false })}
        >
          <Dialog.Portal>
            <Dialog.Overlay className='fixed inset-0 bg-background/80 backdrop-blur-sm z-50' />
            <Dialog.Content className='fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg'>
              <div className='flex flex-col space-y-1.5'>
                <Dialog.Title className='text-lg font-semibold flex items-center gap-2 text-foreground'>
                  <Sparkles className='w-5 h-5 text-primary' />
                  Apply SQL Dump
                </Dialog.Title>
                <Dialog.Description className='text-sm text-muted-foreground'>
                  Select the target instance to apply dump <span className='font-mono font-medium text-foreground'>{applyDumpModal.filename}</span> to.
                </Dialog.Description>
              </div>

              <div className='space-y-4 py-2'>
                <div className='p-3 bg-amber-500/10 border border-amber-200 text-amber-800 rounded-lg text-xs flex items-start gap-2'>
                  <AlertTriangle className='w-4 h-4 shrink-0 mt-0.5' />
                  <div>
                    <span className='font-semibold block mb-0.5'>Warning: Overwriting Existing Data</span>
                    Applying a SQL dump restores the database state. Existing tables in the selected database may be overwritten.
                  </div>
                </div>

                <div>
                  <label className='block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5'>
                    Target Instance *
                  </label>
                  <select
                    value={applyDumpModal.targetInstance}
                    onChange={(e) => setApplyDumpModal({ ...applyDumpModal, targetInstance: e.target.value })}
                    className='w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary bg-input text-foreground text-sm font-medium'
                  >
                    <option value=''>Select instance...</option>
                    {instances?.map((inst) => (
                      <option key={inst.id} value={inst.name}>
                        {inst.name} ({inst.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className='flex justify-end gap-3 pt-3 border-t'>
                <button
                  type='button'
                  onClick={() => setApplyDumpModal({ isOpen: false, filename: '', targetInstance: '', isLoading: false })}
                  className='px-4 py-2 text-sm border rounded-md hover:bg-muted'
                >
                  Cancel
                </button>
                <button
                  type='button'
                  onClick={handleConfirmApplyDump}
                  disabled={applyDumpModal.isLoading || !applyDumpModal.targetInstance}
                  className='px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium flex items-center gap-2'
                >
                  {applyDumpModal.isLoading && <Loader2 className='w-4 h-4 animate-spin' />}
                  Apply SQL Dump
                </button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {/* History Table */}
        <div className='bg-card border border-border rounded-lg shadow-sm overflow-hidden'>
          <div className='px-6 py-4 border-b border-border flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              <History className='w-5 h-5 text-primary' />
              <h2 className='text-lg font-semibold'>Migration History</h2>
            </div>
          </div>

          <div className='overflow-x-auto'>
            <table className='min-w-full divide-y divide-border'>
              <thead className='bg-muted/50'>
                <tr>
                  <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    Status
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    Executed At
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    SQL
                  </th>
                  <th className='px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'>
                    Executed By
                  </th>
                </tr>
              </thead>
              <tbody className='bg-card divide-y divide-border'>
                {historyLoading ? (
                  <tr>
                    <td colSpan={4} className='px-6 py-8 text-center'>
                      <Loader2 className='w-6 h-6 animate-spin mx-auto text-muted-foreground' />
                    </td>
                  </tr>
                ) : !historyData?.history || historyData.history.length === 0 ? (
                  <tr>
                    <td colSpan={4} className='px-6 py-8 text-center text-muted-foreground'>
                      No migrations recorded for this instance
                    </td>
                  </tr>
                ) : (
                  historyData.history.map((item: MigrationHistoryItem) => (
                    <>
                      <tr
                        key={item.id}
                        className='hover:bg-muted/50 transition-colors cursor-pointer group'
                        onClick={() => setExpandedHistoryId(expandedHistoryId === item.id ? null : item.id)}
                      >
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center gap-2'>
                            {expandedHistoryId === item.id ? (
                              <ChevronDown className='w-4 h-4 text-muted-foreground' />
                            ) : (
                              <ChevronRight className='w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity' />
                            )}
                            {item.success ? (
                              <span className='inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800'>
                                Success
                              </span>
                            ) : (
                              <span className='inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800'>
                                Failed
                              </span>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-foreground'>
                          {format(new Date(item.executedAt), 'MMM d, yyyy HH:mm:ss')}
                        </td>
                        <td
                          className='px-6 py-4 text-sm text-muted-foreground font-mono max-w-md truncate'
                          title={item.sql}
                        >
                          {item.sql}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm text-muted-foreground'>{item.executedBy}</td>
                      </tr>
                      {expandedHistoryId === item.id && (
                        <tr className='bg-muted/30'>
                          <td colSpan={4} className='px-6 py-4 space-y-3'>
                            <div>
                              <p className='text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider'>
                                SQL Query
                              </p>
                              <pre className='bg-background border border-border rounded-md p-3 text-xs font-mono overflow-x-auto'>
                                {item.sql}
                              </pre>
                            </div>
                            {item.error && (
                              <div>
                                <p className='text-xs font-medium text-destructive mb-1 uppercase tracking-wider flex items-center gap-1'>
                                  <AlertTriangle className='w-3 h-3' /> Error details
                                </p>
                                <div className='bg-destructive/10 border border-destructive/20 text-destructive rounded-md p-3 text-xs font-mono'>
                                  {item.error}
                                </div>
                              </div>
                            )}
                            <div className='flex gap-4 text-xs text-muted-foreground'>
                              <p>
                                Rows Affected: <span className='font-mono text-foreground'>{item.rowsAffected}</span>
                              </p>
                              <p>
                                Migration ID: <span className='font-mono'>{item.id}</span>
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
