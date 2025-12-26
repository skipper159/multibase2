import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, FileCode, Pencil, ArrowLeft } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import TemplateFormModal from '../components/TemplateFormModal';
import TemplatePreviewModal from '../components/TemplatePreviewModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { templatesApi } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { InstanceTemplate } from '../types';
import { toast } from 'sonner';

export default function Templates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<InstanceTemplate | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<InstanceTemplate | null>(null);

  // Confirm dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    templateId: number | null;
    templateName: string;
  }>({ isOpen: false, templateId: null, templateName: '' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['templates'],
    queryFn: templatesApi.list,
  });

  const templates = data?.templates || [];

  const deleteMutation = useMutation({
    mutationFn: templatesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template deleted successfully');
      setConfirmDialog({ isOpen: false, templateId: null, templateName: '' });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete template');
    },
  });

  const handleDeleteClick = (template: InstanceTemplate) => {
    setConfirmDialog({
      isOpen: true,
      templateId: template.id,
      templateName: template.name,
    });
  };

  const handleConfirmDelete = () => {
    if (confirmDialog.templateId) {
      deleteMutation.mutate(confirmDialog.templateId);
    }
  };

  const handleEditClick = (template: InstanceTemplate) => {
    setEditingTemplate(template);
    setShowFormModal(true);
  };

  const handleCreateClick = () => {
    setEditingTemplate(null);
    setShowFormModal(true);
  };

  const handleModalClose = () => {
    setShowFormModal(false);
    setPreviewTemplate(null);
    setEditingTemplate(null);
  };

  const handleModalSuccess = () => {
    handleModalClose();
    queryClient.invalidateQueries({ queryKey: ['templates'] });
  };

  const handleUseTemplate = (template: InstanceTemplate) => {
    setPreviewTemplate(template);
  };

  return (
    <div className='min-h-screen bg-background'>
      <PageHeader>
        <div className='flex items-center justify-between'>
          <div>
            <Link to='/' className='inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-2'>
              <ArrowLeft className='w-4 h-4' />
              Back to Dashboard
            </Link>
            <h1 className='text-3xl font-bold tracking-tight text-foreground'>Templates</h1>
            <p className='text-muted-foreground mt-1'>Manage instance configurations</p>
          </div>
          <button
            onClick={handleCreateClick}
            className='flex items-center gap-2 px-4 py-2 bg-primary text-white font-medium rounded-md hover:bg-primary/90 transition-colors'
          >
            <Plus className='w-4 h-4' />
            Create Template
          </button>
        </div>
      </PageHeader>

      <main className='container mx-auto px-6 py-8'>
        {isLoading ? (
          <div className='flex justify-center py-12'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary'></div>
          </div>
        ) : error ? (
          <div className='bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-destructive flex items-center gap-2'>
            <span>Failed to load templates</span>
          </div>
        ) : templates.length === 0 ? (
          <div className='text-center py-12 bg-card border rounded-lg'>
            <p className='text-muted-foreground'>No templates found. Create one or save an instance as a template.</p>
          </div>
        ) : (
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'>
            {templates.map((template) => (
              <div
                key={template.id}
                className='bg-card border border-border rounded-lg p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group'
                onClick={() => handleUseTemplate(template)}
              >
                <div className='flex justify-between items-start mb-4'>
                  <div className='flex items-center gap-2'>
                    <div className='p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors'>
                      <FileCode className='w-5 h-5 text-primary' />
                    </div>
                    <h3 className='font-semibold text-lg group-hover:text-primary transition-colors'>
                      {template.name}
                    </h3>
                  </div>
                  {template.isPublic && (
                    <span className='text-xs bg-secondary px-2 py-1 rounded-full text-secondary-foreground'>
                      Public
                    </span>
                  )}
                </div>

                <p className='text-sm text-muted-foreground mb-4 line-clamp-2 min-h-[40px]'>
                  {template.description || 'No description provided'}
                </p>

                <div className='flex items-center justify-between text-xs text-muted-foreground mt-auto pt-4 border-t border-border'>
                  <span>By: {template.creator?.username || 'Unknown'}</span>
                  <div className='flex gap-1' onClick={(e) => e.stopPropagation()}>
                    {(user?.role === 'admin' || template.createdBy === user?.id) && (
                      <>
                        <button
                          onClick={() => handleEditClick(template)}
                          className='p-2 hover:bg-secondary rounded-md text-foreground transition-colors'
                          title='Edit Template'
                        >
                          <Pencil className='w-4 h-4' />
                        </button>
                        <button
                          onClick={() => handleDeleteClick(template)}
                          className='p-2 hover:bg-destructive/10 text-destructive rounded-md transition-colors'
                          title='Delete Template'
                        >
                          <Trash2 className='w-4 h-4' />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Template Preview Modal */}
      <TemplatePreviewModal isOpen={!!previewTemplate} template={previewTemplate} onClose={handleModalClose} />

      {/* Template Form Modal (Create/Edit) */}
      <TemplateFormModal
        isOpen={showFormModal}
        template={editingTemplate}
        onClose={handleModalClose}
        onSuccess={handleModalSuccess}
      />

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title='Delete Template'
        message={`Are you sure you want to delete "${confirmDialog.templateName}"? This action cannot be undone.`}
        confirmText='Delete'
        variant='danger'
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDialog({ isOpen: false, templateId: null, templateName: '' })}
      />
    </div>
  );
}
