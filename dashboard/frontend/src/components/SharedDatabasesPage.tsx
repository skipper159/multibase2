import { useState } from 'react';
import { Database, Trash2 } from 'lucide-react';
import { useDeleteDatabase, useSharedDatabases } from '../hooks/useShared';

export default function SharedDatabasesPage() {
  const { data: dbData } = useSharedDatabases();
  const deleteMutation = useDeleteDatabase();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  return (
    <div className='bg-card border rounded-lg p-6'>
      <div className='flex items-start justify-between gap-4 mb-6'>
        <div>
          <h2 className='text-xl font-semibold flex items-center gap-2'>
            <Database className='w-5 h-5' />
            Database Cluster
          </h2>
          <p className='text-sm text-muted-foreground mt-1'>Project databases hosted in the shared PostgreSQL cluster.</p>
        </div>
        <span className='text-sm text-muted-foreground'>{dbData?.count || 0} project databases</span>
      </div>

      {dbData && dbData.databases.length > 0 ? (
        <div className='overflow-x-auto'>
          <table className='w-full'>
            <thead>
              <tr className='border-b border-white/10'>
                <th className='text-left py-3 px-4 text-sm font-medium text-muted-foreground'>Database</th>
                <th className='text-left py-3 px-4 text-sm font-medium text-muted-foreground'>Project</th>
                <th className='text-left py-3 px-4 text-sm font-medium text-muted-foreground'>Size</th>
                <th className='text-right py-3 px-4 text-sm font-medium text-muted-foreground'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dbData.databases.map((db) => (
                <tr key={db.name} className='border-b border-white/5 hover:bg-white/5 transition-colors'>
                  <td className='py-3 px-4 font-mono text-sm'>{db.name}</td>
                  <td className='py-3 px-4 text-sm text-muted-foreground'>{db.projectName}</td>
                  <td className='py-3 px-4 text-sm text-muted-foreground'>{db.sizeFormatted}</td>
                  <td className='py-3 px-4 text-right'>
                    {deleteTarget === db.projectName ? (
                      <div className='flex items-center justify-end gap-2'>
                        <button
                          onClick={() => {
                            deleteMutation.mutate(db.projectName);
                            setDeleteTarget(null);
                          }}
                          className='text-xs px-3 py-1 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30'
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteTarget(null)}
                          className='text-xs px-3 py-1 bg-white/10 text-muted-foreground rounded hover:bg-white/20'
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteTarget(db.projectName)}
                        className='text-muted-foreground hover:text-red-400 transition-colors'
                        title='Delete database'
                      >
                        <Trash2 className='w-4 h-4' />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className='text-center py-12'>
          <Database className='w-12 h-12 text-muted-foreground/30 mx-auto mb-4' />
          <p className='text-muted-foreground'>No project databases yet</p>
          <p className='text-sm text-muted-foreground/70 mt-1'>Create a cloud instance to automatically provision a database</p>
        </div>
      )}
    </div>
  );
}
