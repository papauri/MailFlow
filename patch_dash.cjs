const fs = require('fs');
let content = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

content = content.replace(
  /{emails.length === 0 \? \([\s\S]*?\) : \(/,
  `{emails.length === 0 ? (
              isSearching ? (
                <div className="flex flex-col items-center justify-center h-96 text-slate-400 px-4 text-center">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                    <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700 mb-2">Loading messages...</h3>
                  <p className="text-sm text-slate-500 max-w-sm mb-6">
                    Fetching your emails from Gmail.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-96 text-slate-400 px-4 text-center">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                    <Search className="w-10 h-10 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700 mb-2">No messages found</h3>
                  <p className="text-sm text-slate-500 max-w-sm mb-6">
                    We couldn't find any emails matching your current search and filters.
                  </p>
                  {(query || (folderFilters.length > 0 && !folderFilters.includes('anywhere'))) && (
                    <button 
                      onClick={() => {
                        setQuery('');
                        setFolderFilters(['anywhere']);
                        setTimeout(() => handleSearch(undefined, '', ['anywhere']), 0);
                      }}
                      className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              )
            ) : (`
);

fs.writeFileSync('src/components/Dashboard.tsx', content);
