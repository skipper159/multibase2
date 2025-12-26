import { Link } from 'react-router-dom';

interface PageHeaderProps {
  children?: React.ReactNode;
}

export default function PageHeader({ children }: PageHeaderProps) {
  return (
    <header className='border-b border-border bg-card'>
      <div className='container mx-auto px-6 py-4'>
        {/* Logo Section */}
        <div className='flex items-center gap-3 mb-4'>
          <Link to='/' className='flex items-center gap-3 hover:opacity-80 transition-opacity'>
            <img src='/logo.png' alt='Multibase Logo' className='h-12 w-auto' />
            <h1 className='text-3xl font-bold text-foreground'>Multibase Dashboard</h1>
          </Link>
        </div>
        
        {/* Page-specific content */}
        {children && (
          <div>
            {children}
          </div>
        )}
      </div>
    </header>
  );
}
