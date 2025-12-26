import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInstances } from '../hooks/useInstances';
import {
  useMigrationHistory,
  useMigrationTemplates,
  useExecuteMigration,
  useValidateSql,
  MigrationHistoryItem,
  useCreateTemplate,
  useDeleteTemplate,
} from '../hooks/useMigrations';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Download, FileJson } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';

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

  // Queries
  const { data: instances, isLoading: instancesLoading } = useInstances();

  // Set default instance if available and not selected
  if (instances && instances.length > 0 && !selectedInstanceId) {
    // Prefer running instances
    const running = instances.find((i) => i.status === 'running');
    setSelectedInstanceId(running ? running.name : instances[0].name);
  }

  const { data: historyData, isLoading: historyLoading } = useMigrationHistory(selectedInstanceId);
  const { data: templatesData } = useMigrationTemplates();

  // Mutations
  const executeMutation = useExecuteMigration();
  const validateMutation = useValidateSql();
  const createTemplateMutation = useCreateTemplate();
  const deleteTemplateMutation = useDeleteTemplate();

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
            <select
              value={selectedInstanceId}
              onChange={(e) => setSelectedInstanceId(e.target.value)}
              className='bg-transparent border-none text-sm font-medium focus:ring-0 cursor-pointer min-w-[200px]'
            >
              <option value='' disabled>
                Select Instance
              </option>
              {instances?.map((i) => (
                <option key={i.id} value={i.name}>
                  {i.name} ({i.status})
                </option>
              ))}
            </select>
          </div>
        </div>
      </PageHeader>

      <main className='container mx-auto px-6 py-8'>
        <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8'>
          {/* Editor Section */}
          <div className='lg:col-span-2 space-y-4'>
            <div className='bg-card border border-border rounded-lg shadow-sm overflow-hidden'>
              <div className='flex items-center justify-between px-4 py-3 bg-secondary/50 border-b border-border'>
                <div className='flex items-center gap-2'>
                  <Code className='w-4 h-4 text-primary' />
                  <h2 className='text-sm font-semibold'>SQL Editor</h2>
                </div>
                <div className='flex gap-2'>
                  <div className='relative'>
                    <input
                      type='file'
                      accept='.sql'
                      onChange={handleFileUpload}
                      className='absolute inset-0 w-full h-full opacity-0 cursor-pointer'
                      title='Import SQL File'
                    />
                    <button className='text-xs bg-secondary hover:bg-muted px-3 py-1.5 rounded-md transition-colors border border-border flex items-center gap-1.5'>
                      <Upload className='w-3.5 h-3.5' />
                      Import .sql
                    </button>
                  </div>
                  <button
                    onClick={() => setShowSaveTemplateDialog(true)}
                    disabled={!sql.trim()}
                    className='text-xs bg-secondary hover:bg-muted px-3 py-1.5 rounded-md transition-colors border border-border flex items-center gap-1.5'
                  >
                    <Save className='w-3.5 h-3.5' />
                    Save Template
                  </button>
                  <div className='w-px h-6 bg-border mx-1'></div>
                  <button
                    onClick={() => handleExecute(true)}
                    disabled={executeMutation.isPending || !selectedInstanceId}
                    className='text-xs bg-secondary hover:bg-muted px-3 py-1.5 rounded-md transition-colors border border-border'
                  >
                    Test / Dry Run
                  </button>
                  <button
                    onClick={() => handleExecute(false)}
                    disabled={executeMutation.isPending || !selectedInstanceId}
                    className='text-xs bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1'
                  >
                    <Play className='w-3 h-3' />
                    Execute
                  </button>
                </div>
              </div>

              <div className='relative'>
                <textarea
                  value={sql}
                  onChange={(e) => {
                    setSql(e.target.value);
                    setValidationResult(null);
                  }}
                  onBlur={handleValidate}
                  placeholder='ENTER SQL QUERY HERE...'
                  className='w-full h-64 p-4 font-mono text-sm bg-background resize-none focus:outline-none'
                  spellCheck={false}
                />

                {/* Validation Status Overlay */}
                {validationResult && (
                  <div
                    className={`absolute bottom-4 right-4 px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border ${
                      validationResult.valid
                        ? 'bg-green-500/10 text-green-600 border-green-200'
                        : 'bg-red-500/10 text-red-600 border-red-200'
                    }`}
                  >
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
                  </div>
                )}
              </div>
            </div>
            {/* Execution Result Section */}
            {executionResult && (
              <div className='bg-card border border-border rounded-lg shadow-sm p-4 animate-in fade-in slide-in-from-top-4 duration-300'>
                <div className='flex items-center gap-2 mb-4 border-b border-border pb-3'>
                  <Database className='w-4 h-4 text-primary' />
                  <h2 className='text-sm font-semibold'>Execution Result</h2>
                </div>
                {renderResult()}
              </div>
            )}
          </div>

          {/* Templates Sidebar */}
          <div className='space-y-4'>
            <div className='bg-card border border-border rounded-lg shadow-sm h-full max-h-[400px] overflow-hidden flex flex-col'>
              <div className='px-4 py-3 bg-secondary/50 border-b border-border'>
                <div className='flex items-center gap-2'>
                  <FileText className='w-4 h-4 text-primary' />
                  <h2 className='text-sm font-semibold'>Templates</h2>
                </div>
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
        </div>

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
