import React, { useState, useEffect } from 'react';
import { X, Loader2, Folder, Inbox, Trash2, Plus, LayoutList } from 'lucide-react';
import { fetchGmailAPI } from '../lib/gmail';
import { cn } from '../lib/utils';

export function LabelManagerModal({ isOpen, onClose }: any) {
  const [labels, setLabels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create Label
  const [isCreating, setIsCreating] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [creatingLabel, setCreatingLabel] = useState(false);
  
  // Delete Label
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadLabels();
    }
  }, [isOpen]);

  const loadLabels = async () => {
    setLoading(true);
    try {
      // Fetch all labels freshly
      const data = await fetchGmailAPI('/labels');
      if (!data || !data.labels) return;
      
      const allLabels = data.labels;
      
      // Fetch details for each label to get counts (messagesTotal, messagesUnread)
      // Cap at 40 labels to avoid spamming the API too hard if they have tons
      const toFetch = allLabels.slice(0, 40);
      const detailed = await Promise.all(
        toFetch.map((l: any) => fetchGmailAPI(`/labels/${l.id}`).catch(() => l))
      );
      
      setLabels(detailed);
    } catch (e) {
      console.error("Failed to load detailed labels", e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLabelName.trim()) return;
    
    setCreatingLabel(true);
    try {
      const res = await fetchGmailAPI('/labels', {
        method: 'POST',
        body: JSON.stringify({
          name: newLabelName.trim(),
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        })
      });
      if (res && res.id) {
        setLabels(prev => [...prev, { ...res, type: 'user', messagesTotal: 0, messagesUnread: 0 }]);
        setNewLabelName('');
        setIsCreating(false);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to create label. It might already exist.');
    } finally {
      setCreatingLabel(false);
    }
  };

  const handleDeleteLabel = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this folder? Emails inside will NOT be deleted, but they will lose this label.')) {
      return;
    }
    
    setDeletingId(id);
    try {
      await fetchGmailAPI(`/labels/${id}`, { method: 'DELETE' });
      setLabels(prev => prev.filter(l => l.id !== id));
    } catch (err) {
      console.error(err);
      alert('Failed to delete label.');
    } finally {
      setDeletingId(null);
    }
  };

  if (!isOpen) return null;

  const systemMap: Record<string, string> = {
    'INBOX': 'Inbox',
    'CATEGORY_PERSONAL': 'Primary',
    'CATEGORY_PROMOTIONS': 'Promotions',
    'CATEGORY_UPDATES': 'Updates',
    'CATEGORY_SOCIAL': 'Social',
    'CATEGORY_FORUMS': 'Forums',
    'SPAM': 'Spam',
    'TRASH': 'Trash',
    'SENT': 'Sent',
    'DRAFT': 'Drafts',
    'STARRED': 'Starred'
  };

  // Group labels
  const systemLabels = labels.filter(l => l.type === 'system' && systemMap[l.id]);
  const userLabelsList = labels.filter(l => l.type === 'user');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl h-[85vh] flex flex-col overflow-hidden ring-1 ring-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
              <LayoutList className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800 tracking-tight leading-tight">Folder & Label Manager</h2>
              <p className="text-sm text-slate-500">View and manage all your Gmail folders</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50/30">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-4 text-indigo-500" />
              <p className="text-sm font-medium">Loading all folders...</p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-8">
              
              {/* Create New Folder */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-3 text-slate-800 font-bold">
                  <Plus className="w-4 h-4 text-indigo-600" />
                  <h3>Create New Folder</h3>
                </div>
                {!isCreating ? (
                  <button 
                    onClick={() => setIsCreating(true)}
                    className="w-full flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 border-dashed text-slate-600 py-3 rounded-lg text-sm font-semibold transition-colors"
                  >
                    + Add Custom Folder
                  </button>
                ) : (
                  <form onSubmit={handleCreateLabel} className="flex flex-col gap-3">
                    <input
                      type="text"
                      autoFocus
                      placeholder="e.g. Invoices, Newsletters, Travel"
                      value={newLabelName}
                      onChange={e => setNewLabelName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex items-center gap-2">
                      <button type="submit" disabled={!newLabelName.trim() || creatingLabel} className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50">
                        {creatingLabel && <Loader2 className="w-3 h-3 animate-spin" />}
                        Create Folder
                      </button>
                      <button type="button" onClick={() => {setIsCreating(false); setNewLabelName('');}} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg text-sm font-semibold transition-colors">
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>

              {/* Custom Folders */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 ml-1">Custom Folders</h3>
                {userLabelsList.length === 0 ? (
                  <p className="text-sm text-slate-500 italic ml-1">No custom folders created yet.</p>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    {userLabelsList.map((l, i) => (
                      <div key={l.id} className={cn("flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors", i !== userLabelsList.length - 1 && "border-b border-slate-100")}>
                        <div className="flex items-center gap-3 truncate min-w-0">
                          <Folder className="w-4 h-4 text-indigo-400 shrink-0" />
                          <span className="font-medium text-slate-700 truncate">{l.name}</span>
                          <span className="text-xs text-slate-400 font-semibold bg-slate-100 px-2 py-0.5 rounded-full">
                            {l.messagesTotal || 0} emails
                          </span>
                        </div>
                        <button 
                          onClick={(e) => handleDeleteLabel(l.id, e)}
                          disabled={deletingId === l.id}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                          title="Delete Folder"
                        >
                          {deletingId === l.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* System Folders */}
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 ml-1">System Folders</h3>
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm grid grid-cols-1 sm:grid-cols-2">
                  {systemLabels.map((l, i) => (
                    <div key={l.id} className="flex items-center justify-between p-3.5 hover:bg-slate-50 transition-colors border-b border-slate-100">
                      <div className="flex items-center gap-3 truncate min-w-0">
                        <Inbox className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-700 truncate">{systemMap[l.id]}</span>
                      </div>
                      <span className="text-xs text-slate-400 font-semibold bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
                        {l.messagesTotal || 0} emails
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2 ml-1">System folders cannot be deleted or renamed.</p>
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
