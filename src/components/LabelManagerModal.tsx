import { TypingLoader } from "./TypingLoader";
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  X, 
  Loader2, 
  Folder, 
  Inbox, 
  Trash2, 
  Plus, 
  LayoutList, 
  FolderInput, 
  Archive, 
  Mail, 
  MailOpen, 
  Search, 
  CheckCircle, 
  AlertTriangle, 
  RefreshCw, 
  Tag, 
  Send,
  Star,
  FileText,
  ShieldAlert,
  Sparkles,
  Edit2,
  Check,
  FolderPlus,
  ArrowRight,
  Filter
} from 'lucide-react';
import { 
  fetchGmailAPI, 
  searchEmails, 
  batchModifyEmails, 
  batchTrashEmails, 
  batchArchiveEmails, 
  batchMarkAsRead,
  createLabel, 
  deleteLabel,
  renameLabel,
  EmailData 
} from '../lib/gmail';
import { cn } from '../lib/utils';

export interface LabelManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  userLabels?: any[];
  onLabelsUpdated?: () => void;
  onApplyQuery?: (query: string, filter?: string) => void;
  aiSettings?: any;
}

interface LabelItem {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
  color?: { backgroundColor?: string; textColor?: string };
}

const SYSTEM_LABEL_MAP: Record<string, { name: string; query: string; icon: any; color: string }> = {
  'INBOX': { name: 'Inbox', query: 'in:inbox', icon: Inbox, color: 'text-slate-600' },
  'CATEGORY_PERSONAL': { name: 'Primary', query: 'category:primary', icon: Mail, color: 'text-blue-600' },
  'CATEGORY_UPDATES': { name: 'Updates', query: 'category:updates', icon: Sparkles, color: 'text-emerald-600' },
  'CATEGORY_PROMOTIONS': { name: 'Promotions', query: 'category:promotions', icon: Tag, color: 'text-amber-600' },
  'CATEGORY_SOCIAL': { name: 'Social', query: 'category:social', icon: Sparkles, color: 'text-slate-600' },
  'CATEGORY_FORUMS': { name: 'Forums', query: 'category:forums', icon: LayoutList, color: 'text-slate-600' },
  'STARRED': { name: 'Starred', query: 'is:starred', icon: Star, color: 'text-yellow-600' },
  'SENT': { name: 'Sent', query: 'in:sent', icon: Send, color: 'text-slate-600' },
  'DRAFT': { name: 'Drafts', query: 'in:draft', icon: FileText, color: 'text-slate-600' },
  'SPAM': { name: 'Spam', query: 'in:spam', icon: ShieldAlert, color: 'text-rose-600' },
  'TRASH': { name: 'Trash', query: 'in:trash', icon: Trash2, color: 'text-red-600' }
};

export function LabelManagerModal({ 
  isOpen, 
  onClose, 
  userLabels = [], 
  onLabelsUpdated,
  onApplyQuery 
}: LabelManagerModalProps) {
  // Folder List State
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [loadingLabels, setLoadingLabels] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('INBOX');
  const [folderSearchQuery, setFolderSearchQuery] = useState('');

  // Create Label State
  const [isCreatingLabel, setIsCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [creatingLoading, setCreatingLoading] = useState(false);

  // Delete Label State
  const [labelToDelete, setLabelToDelete] = useState<LabelItem | null>(null);
  const [deletingLoading, setDeletingLoading] = useState(false);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  // Rename Label State
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editedName, setEditedName] = useState('');
  const [renamingLoading, setRenamingLoading] = useState(false);

  // Right Content (Emails in selected folder)
  const [folderEmails, setFolderEmails] = useState<EmailData[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [selectedEmailIds, setSelectedEmailIds] = useState<Set<string>>(new Set());
  const [emailSearchTerm, setEmailSearchTerm] = useState('');
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);
  const [onlyUnreadInFolder, setOnlyUnreadInFolder] = useState(false);

  // Move action state
  const [isMoveDropdownOpen, setIsMoveDropdownOpen] = useState(false);
  const [isLabelDropdownOpen, setIsLabelDropdownOpen] = useState(false);
  const [isMovingEmails, setIsMovingEmails] = useState(false);
  const [movingProgressMessage, setMovingProgressMessage] = useState<string>('');
  const [customDestinationName, setCustomDestinationName] = useState('');
  const [showNewFolderInMove, setShowNewFolderInMove] = useState(false);

  // Success Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Load all labels with message stats
  const loadLabels = useCallback(async () => {
    setLoadingLabels(true);
    try {
      const data = await fetchGmailAPI('/labels');
      if (!data || !data.labels) return;

      const allLabels: any[] = data.labels;
      // Fetch stats for all custom labels and system labels
      const detailed = await Promise.all(
        allLabels.map((l: any) => 
          fetchGmailAPI(`/labels/${l.id}`).catch(() => l)
        )
      );

      setLabels(detailed);
    } catch (e) {
      console.error("Failed to load labels", e);
    } finally {
      setLoadingLabels(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadLabels();
    }
  }, [isOpen, loadLabels]);

  // Determine current active folder object
  const currentFolder = useMemo(() => {
    return labels.find(l => l.id === selectedFolderId) || {
      id: selectedFolderId,
      name: SYSTEM_LABEL_MAP[selectedFolderId]?.name || selectedFolderId,
      type: SYSTEM_LABEL_MAP[selectedFolderId] ? 'system' : 'user'
    };
  }, [labels, selectedFolderId]);

  // Load emails for the currently selected folder
  const loadEmailsForFolder = useCallback(async (folderId: string) => {
    setLoadingEmails(true);
    setSelectedEmailIds(new Set());
    setExpandedEmailId(null);

    try {
      let query = '';
      if (SYSTEM_LABEL_MAP[folderId]) {
        query = SYSTEM_LABEL_MAP[folderId].query;
      } else {
        const found = labels.find(l => l.id === folderId);
        const name = found ? found.name : folderId;
        query = `label:"${name}"`;
      }

      if (onlyUnreadInFolder) {
        query += ' is:unread';
      }

      if (emailSearchTerm.trim()) {
        query += ` ${emailSearchTerm.trim()}`;
      }

      const emails = await searchEmails(query, 50);
      setFolderEmails(emails || []);
    } catch (e) {
      console.error("Failed to load emails for folder", e);
      setFolderEmails([]);
    } finally {
      setLoadingEmails(false);
    }
  }, [labels, onlyUnreadInFolder, emailSearchTerm]);

  useEffect(() => {
    if (isOpen && selectedFolderId) {
      loadEmailsForFolder(selectedFolderId);
    }
  }, [isOpen, selectedFolderId, loadEmailsForFolder]);

  // Create a new folder / label
  const handleCreateLabel = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newLabelName.trim();
    if (!cleanName) return;

    setCreatingLoading(true);
    try {
      const res = await createLabel(cleanName);
      if (res && res.id) {
        const newLabel: LabelItem = {
          id: res.id,
          name: res.name || cleanName,
          type: 'user',
          messagesTotal: 0,
          messagesUnread: 0
        };
        setLabels(prev => [...prev, newLabel]);
        setSelectedFolderId(res.id);
        setNewLabelName('');
        setIsCreatingLabel(false);
        showToast(`Folder "${cleanName}" created successfully.`);
        if (onLabelsUpdated) onLabelsUpdated();
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Failed to create folder. It may already exist.');
    } finally {
      setCreatingLoading(false);
    }
  };

  // Delete a custom folder / label
  const executeDeleteFolder = async () => {
    if (!labelToDelete) return;
    setDeletingLoading(true);
    setDeleteErrorMessage(null);

    try {
      await deleteLabel(labelToDelete.id);
      
      // Update local label list
      setLabels(prev => prev.filter(l => l.id !== labelToDelete.id));
      
      // If we were viewing the deleted folder, switch to Inbox
      if (selectedFolderId === labelToDelete.id) {
        setSelectedFolderId('INBOX');
      }

      showToast(`Folder "${labelToDelete.name}" deleted.`);
      setLabelToDelete(null);
      if (onLabelsUpdated) onLabelsUpdated();
    } catch (err: any) {
      console.error("Delete folder error", err);
      setDeleteErrorMessage(err.message || 'Failed to delete folder from Gmail.');
    } finally {
      setDeletingLoading(false);
    }
  };

  // Rename a custom folder / label
  const handleRenameLabel = async (id: string) => {
    const cleanName = editedName.trim();
    if (!cleanName) return;

    setRenamingLoading(true);
    try {
      await renameLabel(id, cleanName);
      setLabels(prev => prev.map(l => l.id === id ? { ...l, name: cleanName } : l));
      setEditingLabelId(null);
      setEditedName('');
      showToast(`Folder renamed to "${cleanName}".`);
      if (onLabelsUpdated) onLabelsUpdated();
    } catch (err: any) {
      console.error("Rename folder error", err);
      alert(err.message || 'Failed to rename folder.');
    } finally {
      setRenamingLoading(false);
    }
  };

  // Move Selected Emails to a Destination Folder
  const handleMoveEmails = async (destinationLabelId: string, destinationLabelName: string) => {
    const targetEmailIds = Array.from(selectedEmailIds) as string[];
    if (targetEmailIds.length === 0) return;

    setIsMovingEmails(true);
    setIsMoveDropdownOpen(false);
    setMovingProgressMessage(`Moving ${targetEmailIds.length} email(s) to ${destinationLabelName}...`);

    try {
      const allMessageIds: string[] = [];
      targetEmailIds.forEach((tid: string) => {
        const em = folderEmails.find(e => e.id === tid);
        if (em && em.messageIds && em.messageIds.length > 0) {
          allMessageIds.push(...em.messageIds);
        } else {
          allMessageIds.push(tid);
        }
      });

      const addLabels: string[] = [];
      const removeLabels: string[] = [];

      if (destinationLabelId === 'INBOX') {
        addLabels.push('INBOX');
        if (selectedFolderId !== 'INBOX' && !SYSTEM_LABEL_MAP[selectedFolderId]) {
          removeLabels.push(selectedFolderId);
        }
      } else if (destinationLabelId === 'ARCHIVE') {
        removeLabels.push('INBOX');
        if (selectedFolderId !== 'INBOX' && !SYSTEM_LABEL_MAP[selectedFolderId]) {
          removeLabels.push(selectedFolderId);
        }
      } else if (destinationLabelId === 'TRASH') {
        await batchTrashEmails(allMessageIds);
      } else {
        addLabels.push(destinationLabelId);
        if (selectedFolderId === 'INBOX') {
          removeLabels.push('INBOX');
        } else if (!SYSTEM_LABEL_MAP[selectedFolderId]) {
          removeLabels.push(selectedFolderId);
        }
      }

      if (destinationLabelId !== 'TRASH') {
        await batchModifyEmails(allMessageIds, addLabels, removeLabels);
      }

      // Remove moved emails from current view
      setFolderEmails(prev => prev.filter(e => !selectedEmailIds.has(e.id)));
      setSelectedEmailIds(new Set());
      showToast(`Moved ${targetEmailIds.length} email(s) to "${destinationLabelName}".`);

      // Refresh labels count in background
      loadLabels();
      if (onLabelsUpdated) onLabelsUpdated();
    } catch (e: any) {
      console.error("Failed to move emails", e);
      alert(e.message || "Failed to move emails.");
    } finally {
      setIsMovingEmails(false);
      setMovingProgressMessage('');
    }
  };

  // Apply or remove a label without removing from current folder
  const handleApplyLabel = async (targetLabelId: string, targetLabelName: string) => {
    const targetEmailIds = Array.from(selectedEmailIds) as string[];
    if (targetEmailIds.length === 0) return;

    setIsMovingEmails(true);
    setIsLabelDropdownOpen(false);
    setMovingProgressMessage(`Applying label "${targetLabelName}"...`);

    try {
      const allMessageIds: string[] = [];
      targetEmailIds.forEach((tid: string) => {
        const em = folderEmails.find(e => e.id === tid);
        if (em && em.messageIds && em.messageIds.length > 0) {
          allMessageIds.push(...em.messageIds);
        } else {
          allMessageIds.push(tid);
        }
      });

      await batchModifyEmails(allMessageIds, [targetLabelId], []);

      // Update local state labelIds
      setFolderEmails(prev => prev.map(e => {
        if (selectedEmailIds.has(e.id)) {
          const next = new Set(e.labelIds || []);
          next.add(targetLabelId);
          return { ...e, labelIds: Array.from(next) };
        }
        return e;
      }));

      setSelectedEmailIds(new Set());
      showToast(`Label "${targetLabelName}" applied to ${targetEmailIds.length} email(s).`);
      loadLabels();
      if (onLabelsUpdated) onLabelsUpdated();
    } catch (e: any) {
      alert("Failed to apply label.");
    } finally {
      setIsMovingEmails(false);
      setMovingProgressMessage('');
    }
  };

  // Move to a brand new folder on the fly
  const handleCreateAndMove = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = customDestinationName.trim();
    if (!clean) return;

    try {
      setIsMovingEmails(true);
      setMovingProgressMessage(`Creating folder "${clean}"...`);
      const newLab = await createLabel(clean);
      if (newLab && newLab.id) {
        setLabels(prev => [...prev, { id: newLab.id, name: clean, type: 'user', messagesTotal: 0, messagesUnread: 0 }]);
        setCustomDestinationName('');
        setShowNewFolderInMove(false);
        await handleMoveEmails(newLab.id, clean);
      }
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'Could not create destination folder.');
      setIsMovingEmails(false);
    }
  };

  // Quick action: Archive selected
  const handleQuickArchive = async () => {
    const ids = Array.from(selectedEmailIds) as string[];
    if (ids.length === 0) return;
    setIsMovingEmails(true);
    setMovingProgressMessage(`Archiving ${ids.length} email(s)...`);
    try {
      const allMessageIds: string[] = [];
      ids.forEach((tid: string) => {
        const em = folderEmails.find(e => e.id === tid);
        if (em && em.messageIds) allMessageIds.push(...em.messageIds);
        else allMessageIds.push(tid);
      });
      await batchArchiveEmails(allMessageIds);
      setFolderEmails(prev => prev.filter(e => !selectedEmailIds.has(e.id)));
      setSelectedEmailIds(new Set());
      showToast(`Archived ${ids.length} email(s).`);
      loadLabels();
    } catch (e: any) {
      alert("Failed to archive emails.");
    } finally {
      setIsMovingEmails(false);
      setMovingProgressMessage('');
    }
  };

  // Quick action: Mark Read / Unread
  const handleToggleRead = async (markRead: boolean) => {
    const ids = Array.from(selectedEmailIds) as string[];
    if (ids.length === 0) return;
    setIsMovingEmails(true);
    try {
      const allMessageIds: string[] = [];
      ids.forEach((tid: string) => {
        const em = folderEmails.find(e => e.id === tid);
        if (em && em.messageIds) allMessageIds.push(...em.messageIds);
        else allMessageIds.push(tid);
      });
      if (markRead) {
        await batchMarkAsRead(allMessageIds);
      } else {
        await batchModifyEmails(allMessageIds, ['UNREAD'], []);
      }
      setFolderEmails(prev => prev.map(e => {
        if (selectedEmailIds.has(e.id)) {
          const nextLabels = markRead 
            ? e.labelIds.filter(l => l !== 'UNREAD')
            : [...e.labelIds, 'UNREAD'];
          return { ...e, labelIds: nextLabels };
        }
        return e;
      }));
      setSelectedEmailIds(new Set());
      showToast(markRead ? `Marked ${ids.length} as read.` : `Marked ${ids.length} as unread.`);
    } catch (e) {
      alert("Failed to update status.");
    } finally {
      setIsMovingEmails(false);
    }
  };

  // Filtered system & user labels for left pane
  const systemLabels = useMemo(() => {
    return labels.filter(l => l.type === 'system' && SYSTEM_LABEL_MAP[l.id]);
  }, [labels]);

  const userLabelsList = useMemo(() => {
    return labels
      .filter(l => l.type === 'user')
      .filter(l => !folderSearchQuery.trim() || l.name.toLowerCase().includes(folderSearchQuery.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labels, folderSearchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden ring-1 ring-slate-200">
        
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-2xs">
              <Folder className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Folders & Labels Manager</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-50 border border-slate-200 text-slate-700 rounded-full">
                  Gmail Labels & Folders
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Create, rename, delete custom labels, and organize emails into folders
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={onClose} 
              className="p-2 hover:bg-slate-200 rounded-xl transition-colors text-slate-500 hover:text-slate-800"
              title="Close Manager"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Toast Alert */}
        {toastMessage && (
          <div className="bg-emerald-600 text-white px-4 py-2 text-xs font-semibold flex items-center justify-between shrink-0 shadow-inner animate-in slide-in-from-top-1">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              <span>{toastMessage}</span>
            </div>
            <button onClick={() => setToastMessage(null)} className="text-emerald-100 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main 2-Column Split Workspace */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          
          {/* ================= LEFT NAVIGATION PANE: FOLDERS & LABELS LIST ================= */}
          <div className="w-full md:w-72 lg:w-80 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50/60 flex flex-col shrink-0 h-2/5 md:h-full overflow-hidden">
            
            {/* Search Folders & Create Folder Header */}
            <div className="p-3 border-b border-slate-200 bg-white/80 flex flex-col gap-2 shrink-0">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter folders & labels..."
                  value={folderSearchQuery}
                  onChange={(e) => setFolderSearchQuery(e.target.value)}
                  className="w-full bg-slate-100/80 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-700"
                />
              </div>

              {!isCreatingLabel ? (
                <button
                  onClick={() => setIsCreatingLabel(true)}
                  className="flex items-center justify-center gap-1.5 w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 py-1.5 rounded-lg text-xs font-medium shadow-2xs transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Create New Label / Folder</span>
                </button>
              ) : (
                <form onSubmit={handleCreateLabel} className="flex flex-col gap-1.5 p-2 bg-slate-50/40 border border-slate-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-900 uppercase">New Label Name</span>
                    <span className="text-[10px] text-slate-400">e.g. Work/Clients</span>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Enter folder or label name..."
                    value={newLabelName}
                    onChange={(e) => setNewLabelName(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-600"
                  />
                  <div className="flex items-center gap-1.5 mt-1">
                    <button
                      type="submit"
                      disabled={!newLabelName.trim() || creatingLoading}
                      className="flex-1 bg-slate-900 hover:bg-slate-800 text-white py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                    >
                      {creatingLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => { setIsCreatingLabel(false); setNewLabelName(''); }}
                      className="px-2.5 py-1 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded text-xs font-medium"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Scrollable Folder List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-4">
              
              {/* System Folders */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1 flex items-center justify-between">
                  <span>System Folders</span>
                  <span>Messages</span>
                </div>
                <div className="space-y-0.5">
                  {Object.keys(SYSTEM_LABEL_MAP).map(key => {
                    const meta = SYSTEM_LABEL_MAP[key];
                    const labelObj = labels.find(l => l.id === key);
                    const isSelected = selectedFolderId === key;
                    const IconComponent = meta.icon;

                    return (
                      <button
                        key={key}
                        onClick={() => setSelectedFolderId(key)}
                        className={cn(
                          "w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-all text-left group",
                          isSelected 
                            ? "bg-slate-800 text-white font-bold shadow-2xs" 
                            : "text-slate-700 hover:bg-slate-100/80"
                        )}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <IconComponent className={cn("w-4 h-4 shrink-0", isSelected ? "text-white" : meta.color)} />
                          <span className="truncate">{meta.name}</span>
                        </div>
                        
                        <div className="flex items-center gap-1.5 shrink-0">
                          {labelObj?.messagesUnread ? (
                            <span className={cn(
                              "text-[10px] font-bold px-1.5 py-0.2 rounded-full",
                              isSelected ? "bg-slate-700 text-white" : "bg-blue-100 text-blue-700"
                            )}>
                              {labelObj.messagesUnread}
                            </span>
                          ) : null}
                          <span className={cn("text-[10px]", isSelected ? "text-slate-300" : "text-slate-400")}>
                            {labelObj?.messagesTotal || 0}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Folders & Labels */}
              <div>
                <div className="flex items-center justify-between px-2 mb-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Custom Labels & Folders ({userLabelsList.length})
                  </span>
                </div>

                {loadingLabels ? (
                  <div className="py-4 text-center text-slate-400 flex items-center justify-center gap-2 text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Loading labels...</span>
                  </div>
                ) : userLabelsList.length === 0 ? (
                  <div className="px-2 py-4 text-center text-xs text-slate-400 bg-slate-100/50 rounded-xl border border-dashed border-slate-200">
                    <p>{folderSearchQuery ? "No matching folders" : "No custom folders created yet."}</p>
                    {!folderSearchQuery && (
                      <button
                        onClick={() => setIsCreatingLabel(true)}
                        className="mt-2 text-slate-600 font-semibold hover:underline text-xs"
                      >
                        + Create your first folder
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {userLabelsList.map(label => {
                      const isSelected = selectedFolderId === label.id;
                      const isEditing = editingLabelId === label.id;

                      if (isEditing) {
                        return (
                          <div key={label.id} className="p-1.5 bg-white border border-slate-300 rounded-lg flex items-center gap-1">
                            <input
                              type="text"
                              autoFocus
                              value={editedName}
                              onChange={(e) => setEditedName(e.target.value)}
                              className="w-full text-xs px-1.5 py-0.5 border border-slate-200 rounded font-medium focus:outline-none focus:ring-1 focus:ring-slate-500"
                            />
                            <button
                              onClick={() => handleRenameLabel(label.id)}
                              disabled={renamingLoading}
                              className="p-1 bg-slate-800 text-white rounded hover:bg-slate-900"
                              title="Save name"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditingLabelId(null)}
                              className="p-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200"
                              title="Cancel"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      }

                      // Check if label has a subfolder path structure
                      const isNested = label.name.includes('/');

                      return (
                        <div
                          key={label.id}
                          onClick={() => setSelectedFolderId(label.id)}
                          className={cn(
                            "w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-all text-left cursor-pointer group",
                            isSelected 
                              ? "bg-slate-800 text-white font-bold shadow-2xs" 
                              : "text-slate-700 hover:bg-slate-100/80",
                            isNested && "pl-4"
                          )}
                        >
                          <div className="flex items-center gap-2 truncate min-w-0 pr-1">
                            <Folder className={cn("w-4 h-4 shrink-0", isSelected ? "text-white" : "text-slate-500")} />
                            <span className="truncate">{label.name}</span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {label.messagesUnread ? (
                              <span className={cn(
                                "text-[10px] font-bold px-1.5 py-0.2 rounded-full",
                                isSelected ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-700"
                              )}>
                                {label.messagesUnread}
                              </span>
                            ) : null}
                            <span className={cn("text-[10px]", isSelected ? "text-slate-300" : "text-slate-400")}>
                              {label.messagesTotal || 0}
                            </span>

                            {/* Action Buttons (Rename & Delete) */}
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingLabelId(label.id);
                                  setEditedName(label.name);
                                }}
                                className={cn(
                                  "p-1 rounded transition-colors",
                                  isSelected ? "hover:bg-slate-700 text-slate-300" : "hover:bg-slate-200 text-slate-500"
                                )}
                                title="Rename Folder"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLabelToDelete(label);
                                }}
                                className={cn(
                                  "p-1 rounded transition-colors",
                                  isSelected ? "hover:bg-rose-900 text-rose-300" : "hover:bg-rose-100 text-rose-600"
                                )}
                                title="Delete Folder"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ================= RIGHT CONTENT PANE: FOLDER CONTENTS & ACTIONS ================= */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            
            {/* Folder View Header */}
            <div className="p-3.5 sm:p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-white border border-slate-200 text-slate-700 shadow-2xs">
                  {SYSTEM_LABEL_MAP[selectedFolderId] ? (
                    React.createElement(SYSTEM_LABEL_MAP[selectedFolderId].icon, { className: "w-4 h-4 text-slate-600" })
                  ) : (
                    <Folder className="w-4 h-4 text-slate-600" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 truncate">
                      {currentFolder.name}
                    </h3>
                    <span className="text-xs font-semibold text-slate-500 bg-slate-200/80 px-2 py-0.5 rounded-full">
                      {folderEmails.length} messages loaded
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">
                    {SYSTEM_LABEL_MAP[selectedFolderId] ? 'System Gmail Folder' : 'Custom Gmail User Label / Folder'}
                  </p>
                </div>
              </div>

              {/* Actions & Filters */}
              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end flex-wrap">
                {/* Search within folder */}
                <div className="relative flex-1 sm:w-48">
                  <Search className="w-3 h-3 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search in this folder..."
                    value={emailSearchTerm}
                    onChange={(e) => setEmailSearchTerm(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg pl-7 pr-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-700"
                  />
                </div>

                <label className="flex items-center gap-1 text-xs font-medium text-slate-600 cursor-pointer bg-white border border-slate-200 px-2 py-1 rounded-lg">
                  <input
                    type="checkbox"
                    checked={onlyUnreadInFolder}
                    onChange={(e) => setOnlyUnreadInFolder(e.target.checked)}
                    className="rounded text-slate-800 focus:ring-slate-700 border-slate-300 w-3 h-3"
                  />
                  <span>Unread</span>
                </label>

                <button
                  onClick={() => loadEmailsForFolder(selectedFolderId)}
                  disabled={loadingEmails}
                  className="p-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors shadow-2xs"
                  title="Refresh folder messages"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5", loadingEmails && "animate-spin")} />
                </button>

                {/* If custom folder, allow rename and delete directly from header */}
                {currentFolder.type === 'user' && (
                  <>
                    <button
                      onClick={() => {
                        setEditingLabelId(currentFolder.id);
                        setEditedName(currentFolder.name);
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg transition-colors shadow-2xs"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Rename</span>
                    </button>
                    <button
                      onClick={() => setLabelToDelete(currentFolder as LabelItem)}
                      className="flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2.5 py-1 rounded-lg transition-colors shadow-2xs"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Delete Folder</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Email Batch Action Toolbar (When emails are loaded or selected) */}
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-100/70 flex items-center justify-between gap-3 text-xs shrink-0 flex-wrap">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={folderEmails.length > 0 && selectedEmailIds.size === folderEmails.length}
                    onChange={() => {
                      if (selectedEmailIds.size === folderEmails.length) {
                        setSelectedEmailIds(new Set());
                      } else {
                        setSelectedEmailIds(new Set(folderEmails.map(e => e.id)));
                      }
                    }}
                    disabled={folderEmails.length === 0 || isMovingEmails}
                    className="rounded text-slate-800 focus:ring-slate-700 border-slate-300 w-3.5 h-3.5"
                  />
                  <span>Select All ({selectedEmailIds.size} of {folderEmails.length})</span>
                </label>

                {isMovingEmails && (
                  <div className="flex items-center gap-1.5 text-slate-700 font-semibold animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-800" />
                    <span>{movingProgressMessage}</span>
                  </div>
                )}
              </div>

              {/* Move & Batch Action Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap">
                
                {/* MOVE TO FOLDER DROPDOWN */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setIsMoveDropdownOpen(!isMoveDropdownOpen);
                      setIsLabelDropdownOpen(false);
                    }}
                    disabled={selectedEmailIds.size === 0 || isMovingEmails}
                    className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white font-medium px-3 py-1.5 rounded-lg text-xs transition-colors shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <FolderInput className="w-3.5 h-3.5" />
                    <span>Move to Folder...</span>
                  </button>

                  {/* Dropdown Menu */}
                  {isMoveDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setIsMoveDropdownOpen(false)} />
                      <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-40 p-2 text-xs flex flex-col gap-1 max-h-80 overflow-y-auto animate-in fade-in zoom-in-95">
                        
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
                          Move {selectedEmailIds.size} email(s) to:
                        </div>

                        {/* Fast destination targets */}
                        <button
                          onClick={() => handleMoveEmails('INBOX', 'Inbox')}
                          className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-100 rounded-lg text-left text-slate-700 font-medium"
                        >
                          <Inbox className="w-3.5 h-3.5 text-slate-600" />
                          <span>Inbox</span>
                        </button>

                        <button
                          onClick={() => handleMoveEmails('ARCHIVE', 'Archive')}
                          className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-100 rounded-lg text-left text-slate-700 font-medium"
                        >
                          <Archive className="w-3.5 h-3.5 text-slate-600" />
                          <span>Archive (All Mail)</span>
                        </button>

                        <div className="h-px bg-slate-100 my-1" />

                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-0.5">
                          Custom Folders
                        </div>

                        {userLabelsList.map(l => (
                          <button
                            key={l.id}
                            onClick={() => handleMoveEmails(l.id, l.name)}
                            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-100 rounded-lg text-left text-slate-700 font-medium truncate"
                          >
                            <Folder className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="truncate">{l.name}</span>
                          </button>
                        ))}

                        <div className="h-px bg-slate-100 my-1" />

                        {/* Create new destination folder */}
                        {!showNewFolderInMove ? (
                          <button
                            onClick={() => setShowNewFolderInMove(true)}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-slate-700 hover:bg-slate-50 rounded-lg font-medium"
                          >
                            <Plus className="w-3.5 h-3.5 text-slate-600" />
                            <span>+ Create New & Move</span>
                          </button>
                        ) : (
                          <form onSubmit={handleCreateAndMove} className="flex flex-col gap-1 p-1.5 bg-slate-50 rounded-lg border border-slate-200">
                            <input
                              type="text"
                              autoFocus
                              placeholder="New folder name..."
                              value={customDestinationName}
                              onChange={(e) => setCustomDestinationName(e.target.value)}
                              className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-xs text-slate-800"
                            />
                            <div className="flex gap-1 mt-1">
                              <button
                                type="submit"
                                disabled={!customDestinationName.trim()}
                                className="flex-1 bg-slate-900 text-white rounded py-1 text-xs font-medium disabled:opacity-50"
                              >
                                Create & Move
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowNewFolderInMove(false)}
                                className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* APPLY LABEL DROPDOWN */}
                <div className="relative">
                  <button
                    onClick={() => {
                      setIsLabelDropdownOpen(!isLabelDropdownOpen);
                      setIsMoveDropdownOpen(false);
                    }}
                    disabled={selectedEmailIds.size === 0 || isMovingEmails}
                    className="flex items-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium px-3 py-1.5 rounded-lg text-xs transition-colors shadow-2xs disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Add or apply a label tag without moving from folder"
                  >
                    <Tag className="w-3.5 h-3.5 text-slate-600" />
                    <span>Apply Label...</span>
                  </button>

                  {isLabelDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setIsLabelDropdownOpen(false)} />
                      <div className="absolute right-0 top-full mt-1.5 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-40 p-2 text-xs flex flex-col gap-1 max-h-72 overflow-y-auto animate-in fade-in">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
                          Attach Label Tag:
                        </div>
                        {userLabelsList.map(l => (
                          <button
                            key={l.id}
                            onClick={() => handleApplyLabel(l.id, l.name)}
                            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-slate-100 rounded-lg text-left text-slate-700 font-medium truncate"
                          >
                            <Tag className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="truncate">{l.name}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Archive Button */}
                <button
                  onClick={handleQuickArchive}
                  disabled={selectedEmailIds.size === 0 || isMovingEmails}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg shadow-2xs transition-colors disabled:opacity-40"
                  title="Archive selected messages (remove from Inbox)"
                >
                  <Archive className="w-3 h-3" />
                  <span className="hidden sm:inline">Archive</span>
                </button>

                {/* Mark Read */}
                <button
                  onClick={() => handleToggleRead(true)}
                  disabled={selectedEmailIds.size === 0 || isMovingEmails}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg shadow-2xs transition-colors disabled:opacity-40"
                  title="Mark selected as read"
                >
                  <MailOpen className="w-3 h-3" />
                  <span className="hidden sm:inline">Mark Read</span>
                </button>

                {/* Move to Trash */}
                <button
                  onClick={() => handleMoveEmails('TRASH', 'Trash')}
                  disabled={selectedEmailIds.size === 0 || isMovingEmails}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 font-medium rounded-lg shadow-2xs transition-colors disabled:opacity-40"
                  title="Move selected to Trash"
                >
                  <Trash2 className="w-3 h-3" />
                  <span className="hidden sm:inline">Trash</span>
                </button>
              </div>
            </div>

            {/* Email List View */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50/40">
              {loadingEmails ? (
                <div className="h-full flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
                  <TypingLoader 
                    title={`Loading ${currentFolder.name}`} 
                    messages={[
                      "Fetching emails...",
                      "Retrieving sender information...",
                      "Sorting by date..."
                    ]} 
                  />
                </div>
              ) : folderEmails.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-16 text-slate-400 gap-3 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400">
                    <Inbox className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-700">No Emails in This Folder</h4>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">
                      {emailSearchTerm ? "No emails match your search query." : "You can move emails into this folder from other folders or the Inbox."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {folderEmails.map((email) => {
                    const isSelected = selectedEmailIds.has(email.id);
                    const isExpanded = expandedEmailId === email.id;
                    const isUnread = email.labelIds?.includes('UNREAD');

                    return (
                      <div
                        key={email.id}
                        onClick={() => setExpandedEmailId(isExpanded ? null : email.id)}
                        className={cn(
                          "bg-white border rounded-xl p-3 sm:p-3.5 transition-all shadow-2xs cursor-pointer select-none",
                          isSelected ? "border-slate-800 ring-1 ring-slate-800" : "border-slate-200 hover:border-slate-300",
                          isUnread ? "bg-white" : "bg-slate-50/50"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          {/* Checkbox */}
                          <div 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEmailIds(prev => {
                                const next = new Set(prev);
                                if (next.has(email.id)) next.delete(email.id);
                                else next.add(email.id);
                                return next;
                              });
                            }}
                            className="pt-0.5 shrink-0"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {}}
                              className="rounded text-slate-800 focus:ring-slate-700 border-slate-300 w-4 h-4 cursor-pointer"
                            />
                          </div>

                          {/* Email Sender & Subject & Snippet */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 truncate">
                                <span className={cn("text-xs truncate", isUnread ? "font-semibold text-slate-900" : "font-semibold text-slate-700")}>
                                  {email.sender.replace(/<.*>/, '').trim() || email.sender}
                                </span>
                                {isUnread && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 shrink-0">
                                {email.date ? new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                              </span>
                            </div>

                            <h4 className={cn("text-xs truncate", isUnread ? "font-bold text-slate-900" : "font-medium text-slate-800")}>
                              {email.subject || '(No Subject)'}
                            </h4>

                            {!isExpanded && (
                              <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                {email.snippet}
                              </p>
                            )}

                            {/* Expanded email message preview */}
                            {isExpanded && (
                              <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                                {email.snippet || "No additional preview content."}
                                
                                <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between">
                                  <span className="text-[10px] text-slate-400">
                                    Full Date: {email.date ? new Date(email.date).toLocaleString() : ''}
                                  </span>
                                  {onApplyQuery && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onClose();
                                        onApplyQuery(`rfc822msgid:${email.id}`, 'anywhere');
                                      }}
                                      className="text-xs text-blue-600 font-semibold hover:underline"
                                    >
                                      Open in Main Search &rarr;
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ================= IN-APP DELETE FOLDER CONFIRMATION MODAL ================= */}
        {labelToDelete && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
            <div className="bg-white rounded-2xl p-5 sm:p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4">
              <div className="flex items-center gap-3 text-rose-600">
                <div className="p-2 bg-rose-100 rounded-xl">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-900">Delete Folder / Label?</h4>
                  <p className="text-xs text-slate-500">Remove this label from your Gmail account</p>
                </div>
              </div>

              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1.5">
                <p>
                  Are you sure you want to delete folder <strong className="text-slate-900">"{labelToDelete.name}"</strong>?
                </p>
                <p className="text-slate-500 text-[11px]">
                  • Emails inside will <strong>NOT</strong> be deleted; they will simply lose this label tag and remain in your All Mail archive.
                </p>
              </div>

              {deleteErrorMessage && (
                <div className="text-xs text-rose-700 bg-rose-50 p-2.5 rounded-lg border border-rose-200">
                  {deleteErrorMessage}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => { setLabelToDelete(null); setDeleteErrorMessage(null); }}
                  disabled={deletingLoading}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeDeleteFolder}
                  disabled={deletingLoading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-medium transition-colors shadow-2xs disabled:opacity-50"
                >
                  {deletingLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Confirm Delete</span>
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
