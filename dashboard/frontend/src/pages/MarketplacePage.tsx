import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Search, RefreshCw, Star } from 'lucide-react';
import { marketplaceApi, type MarketplaceExtension } from '../lib/api';
import ExtensionCard from '../components/marketplace/ExtensionCard';
import ExtensionDetailModal from '../components/marketplace/ExtensionDetailModal';

const CATEGORIES = [
  { id: '', label: 'All' },
  { id: 'database', label: '🗄️ Database' },
  { id: 'auth', label: '🔐 Auth' },
  { id: 'functions', label: '⚡ Functions' },
  { id: 'monitoring', label: '📊 Monitoring' },
  { id: 'ai', label: '🤖 AI / Vectors' },
  { id: 'storage', label: '💾 Storage' },
];

type SortKey = 'default' | 'installs' | 'rating' | 'name';

function ExtensionCardSkeleton() {
  return (
    <div className='glass-card p-4 flex flex-col gap-3'>
      <div className='flex items-start gap-3'>
        <div className='w-10 h-10 rounded-xl bg-white/5 animate-pulse flex-shrink-0' />
        <div className='flex-1 space-y-1.5'>
          <div className='h-3.5 w-28 bg-white/5 rounded animate-pulse' />
          <div className='h-3 w-20 bg-white/5 rounded animate-pulse' />
        </div>
      </div>
      <div className='space-y-1.5'>
        <div className='h-3 w-full bg-white/5 rounded animate-pulse' />
        <div className='h-3 w-full bg-white/5 rounded animate-pulse' />
        <div className='h-3 w-3/4 bg-white/5 rounded animate-pulse' />
      </div>
      <div className='flex gap-1'>
        {[1, 2, 3].map((i) => (
          <div key={i} className='h-4 w-14 bg-white/5 rounded animate-pulse' />
        ))}
      </div>
      <div className='flex items-center justify-between pt-0.5'>
        <div className='flex gap-3'>
          <div className='h-3 w-10 bg-white/5 rounded animate-pulse' />
          <div className='h-3 w-10 bg-white/5 rounded animate-pulse' />
        </div>
        <div className='h-6 w-16 bg-white/5 rounded animate-pulse' />
      </div>
    </div>
  );
}

export default function MarketplacePage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState<SortKey>('default');
  const [selectedExt, setSelectedExt] = useState<MarketplaceExtension | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['marketplace-extensions', { category, search }],
    queryFn: () =>
      marketplaceApi.listExtensions({
        category: category || undefined,
        search: search || undefined,
      }),
    staleTime: 60_000,
  });

  const extensions = data?.extensions ?? [];
  const featured = extensions.filter((e) => e.featured);

  const all =
    sort === 'rating' ? [...extensions].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    : sort === 'installs' ? [...extensions].sort((a, b) => b.installCount - a.installCount)
    : sort === 'name' ? [...extensions].sort((a, b) => a.name.localeCompare(b.name))
    : extensions;

  const currentCategoryLabel = CATEGORIES.find((c) => c.id === category)?.label;
  const emptyMessage =
    search && category
      ? `No extensions match "${search}" in ${currentCategoryLabel}`
      : search
        ? `No extensions match "${search}"`
        : category
          ? `No extensions in the ${currentCategoryLabel} category`
          : 'The marketplace catalog is being loaded. Try refreshing.';

  return (
    <div className='max-w-5xl mx-auto py-6 px-4 sm:px-6'>
      {/* Page header */}
      <div className='flex items-center justify-between mb-6'>
        <div className='flex items-center gap-3'>
          <div className='w-10 h-10 rounded-xl bg-brand-500/15 flex items-center justify-center'>
            <Package className='w-5 h-5 text-brand-400' />
          </div>
          <div>
            <h1 className='text-xl font-bold'>Extension Marketplace</h1>
            <p className='text-sm text-muted-foreground'>Discover and install extensions for your Supabase instances</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className='flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20 transition-colors'
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          {isFetching ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Search */}
      <div className='relative mb-4'>
        <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder='Search extensions…'
          className='w-full pl-9 pr-4 py-2.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-500/50'
        />
      </div>

      {/* Category filter */}
      <div className='flex flex-wrap gap-1.5 mb-6'>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              category === cat.id
                ? 'bg-brand-500/20 border-brand-500/30 text-brand-400'
                : 'border-white/10 text-muted-foreground hover:border-white/20 hover:text-foreground'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
          {Array.from({ length: 9 }).map((_, i) => (
            <ExtensionCardSkeleton key={i} />
          ))}
        </div>
      ) : extensions.length === 0 ? (
        <div className='text-center py-16 text-muted-foreground'>
          <Package className='w-10 h-10 mx-auto mb-3 opacity-30' />
          <p className='text-sm'>{emptyMessage}</p>
          <div className='flex justify-center gap-3 mt-2'>
            {search && (
              <button onClick={() => setSearch('')} className='text-xs text-brand-400 hover:underline'>
                Clear search
              </button>
            )}
            {category && (
              <button onClick={() => setCategory('')} className='text-xs text-brand-400 hover:underline'>
                Clear filter
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Featured section — only shown when not filtering */}
          {!search && !category && featured.length > 0 && (
            <section className='mb-8'>
              <div className='flex items-center gap-2 mb-3'>
                <Star className='w-4 h-4 text-yellow-400 fill-yellow-400' />
                <h2 className='text-sm font-semibold'>Featured</h2>
              </div>
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
                {featured.map((ext) => (
                  <ExtensionCard key={ext.id} extension={ext} onDetails={setSelectedExt} onInstall={setSelectedExt} />
                ))}
              </div>
            </section>
          )}

          {/* All extensions */}
          <section>
            <div className='flex items-center justify-between mb-3'>
              <h2 className='text-sm font-semibold'>
                {search || category ? 'Results' : 'All Extensions'}{' '}
                <span className='text-muted-foreground font-normal'>({all.length})</span>
              </h2>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className='text-xs px-2 py-1 rounded border border-white/10 bg-secondary text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500/50 cursor-pointer'
              >
                <option value='default'>Sort: Default</option>
                <option value='installs'>Most Installed</option>
                <option value='rating'>Top Rated</option>
                <option value='name'>Name A–Z</option>
              </select>
            </div>
            <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
              {all.map((ext) => (
                <ExtensionCard key={ext.id} extension={ext} onDetails={setSelectedExt} onInstall={setSelectedExt} />
              ))}
            </div>
          </section>
        </>
      )}

      {/* Detail Modal */}
      {selectedExt && <ExtensionDetailModal extension={selectedExt} onClose={() => setSelectedExt(null)} />}
    </div>
  );
}
