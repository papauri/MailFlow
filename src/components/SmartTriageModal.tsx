import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  X, 
  Loader2, 
  CheckCircle2, 
  Archive, 
  Trash2, 
  Bookmark, 
  FolderInput, 
  Layers, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  CheckCircle,
  RefreshCw,
  FolderPlus,
  Inbox
} from 'lucide-react';
import { 
  searchEmails, 
  batchModifyEmails, 
  batchArchiveEmails, 
  batchTrashEmails, 
  createLabel, 
  createFilter, 
  fetchGmailAPI,
  EmailData
} from '../lib/gmail';
import { cn } from '../lib/utils';
import { extractSenderDetails, sanitizeGmailSearchQuery } from '../lib/emailUtils';

export interface SmartGroup {
  id: string;
  sender: string;
  title: string;
  emailIds: string[];
  deselectedEmailIds?: string[];
  actionType: 'archive' | 'trash' | 'move_to_label' | 'star_keep';
  suggestedLabel?: string;
  categoryTag: string;
  reason: string;
  filterQuery: string;
}

export interface SmartTriageModalProps {
  isOpen: boolean;
  onClose: () => void;
  aiSettings?: any;
  userLabels?: any[];
  userEmail?: string;
  onRefresh?: () => void;
}

const STORAGE_HANDLED_KEY = 'smart_organizer_handled_ids';
const STORAGE_DISMISSED_SENDERS_KEY = 'smart_organizer_dismissed_senders';

function getStoredHandledIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_HANDLED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveHandledIds(ids: string[]) {
  try {
    const existing = getStoredHandledIds();
    ids.forEach(id => existing.add(id));
    // Keep max 2000 IDs to avoid unbounded growth
    const arr = Array.from(existing).slice(-2000);
    localStorage.setItem(STORAGE_HANDLED_KEY, JSON.stringify(arr));
  } catch (e) {
    console.error('Failed to save handled IDs', e);
  }
}

function getStoredDismissedSenders(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_DISMISSED_SENDERS_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedSender(sender: string) {
  try {
    const existing = getStoredDismissedSenders();
    existing.add(sender.toLowerCase().trim());
    localStorage.setItem(STORAGE_DISMISSED_SENDERS_KEY, JSON.stringify(Array.from(existing)));
  } catch (e) {
    console.error('Failed to save dismissed sender', e);
  }
}

export function SmartTriageModal({
  isOpen,
  onClose,
  aiSettings,
  userLabels = [],
  userEmail,
  onRefresh
}: SmartTriageModalProps) {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<SmartGroup[]>([]);
  const [fetchedEmails, setFetchedEmails] = useState<EmailData[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Selection & UI Filters
  const [selectedFolder, setSelectedFolder] = useState<string>("in:inbox");
  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'archive' | 'move' | 'trash' | 'keep'>('all');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // Execution States
  const [executingGroupId, setExecutingGroupId] = useState<string | null>(null);
  const [executingAll, setExecutingAll] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{ current: number; total: number; message: string }>({ current: 0, total: 0, message: '' });
  const [completedGroupIds, setCompletedGroupIds] = useState<Set<string>>(new Set());
  const [createdFilterGroupIds, setCreatedFilterGroupIds] = useState<Set<string>>(new Set());
  const [creatingFilterId, setCreatingFilterId] = useState<string | null>(null);

  // Local categorization fallback
  const runLocalClustering = useCallback((emails: EmailData[], folders: any[]): SmartGroup[] => {
    const availableFolderNames = (folders || []).map(f => f.name).filter(Boolean);
    const dismissedSenders = getStoredDismissedSenders();

    const otpEmails: EmailData[] = [];
    const receiptEmails: EmailData[] = [];
    const buildAlertEmails: EmailData[] = [];
    const shippingEmails: EmailData[] = [];
    const calendarEmails: EmailData[] = [];
    const statementEmails: EmailData[] = [];
    const importantEmails: EmailData[] = [];
    const senderMap = new Map<string, { details: ReturnType<typeof extractSenderDetails>, emails: EmailData[] }>();

    emails.forEach(e => {
      const details = extractSenderDetails(e.sender || '');
      const senderAddr = details.emailAddr;
      if (dismissedSenders.has(senderAddr) || (userEmail && senderAddr.includes(userEmail.toLowerCase()))) {
        return;
      }

      const senderGroupKey = (!details.isGenericFreemail && details.rootDomain) ? details.rootDomain : senderAddr;
      if (!senderMap.has(senderGroupKey)) {
        senderMap.set(senderGroupKey, { details, emails: [] });
      }
      senderMap.get(senderGroupKey)!.emails.push(e);

      const subject = (e.subject || '').toLowerCase();
      const snippet = (e.snippet || '').toLowerCase();
      const fullText = `${subject} ${snippet}`;

      // 1. Critical Security / Taxes / Legal
      if (
        fullText.includes('tax form') || 
        fullText.includes('w-2') || 
        fullText.includes('1099') || 
        fullText.includes('court notice') || 
        fullText.includes('legal notice') || 
        fullText.includes('security alert') || 
        fullText.includes('unauthorized login') ||
        fullText.includes('suspicious activity') ||
        fullText.includes('password reset')
      ) {
        importantEmails.push(e);
      }
      // 2. Temporary OTP & Verification Codes (Ephemeral)
      else if (
        fullText.includes('verification code') || 
        fullText.includes('security code') || 
        fullText.includes('one-time password') || 
        fullText.includes('your otp') || 
        fullText.includes('login code') || 
        fullText.includes('confirm your email') ||
        fullText.includes('temporary passcode')
      ) {
        otpEmails.push(e);
      }
      // 3. Shipping & Package Tracking
      else if (
        fullText.includes('out for delivery') ||
        fullText.includes('package delivered') ||
        fullText.includes('tracking number') ||
        fullText.includes('order shipped') ||
        fullText.includes('shipment confirmation') ||
        fullText.includes('in transit')
      ) {
        shippingEmails.push(e);
      }
      // 4. Financial Statements & Invoices
      else if (
        fullText.includes('statement is ready') ||
        fullText.includes('monthly statement') ||
        fullText.includes('e-statement') ||
        fullText.includes('bill is ready') ||
        fullText.includes('invoice attached')
      ) {
        statementEmails.push(e);
      }
      // 5. Receipts & Purchase Orders
      else if (
        fullText.includes('receipt') || 
        fullText.includes('invoice') || 
        fullText.includes('order confirmation') || 
        fullText.includes('payment received') || 
        fullText.includes('your order from') ||
        fullText.includes('thank you for your purchase')
      ) {
        receiptEmails.push(e);
      }
      // 6. Calendar & Meeting Invites
      else if (
        subject.startsWith('invitation:') ||
        subject.startsWith('accepted:') ||
        subject.startsWith('declined:') ||
        subject.startsWith('rescheduled:') ||
        fullText.includes('zoom meeting') ||
        fullText.includes('google meet')
      ) {
        calendarEmails.push(e);
      }
      // 7. Developer & CI/CD Status
      else if (
        fullText.includes('build failed') || 
        fullText.includes('build succeeded') || 
        fullText.includes('pipeline') || 
        fullText.includes('deployment') || 
        fullText.includes('cron job') || 
        fullText.includes('pull request') ||
        subject.includes('jira: [') || 
        subject.includes('github: [')
      ) {
        buildAlertEmails.push(e);
      }
    });

    const resultGroups: SmartGroup[] = [];
    const claimedEmailIds = new Set<string>();

    // 1. Expired OTPs
    if (otpEmails.length > 0) {
      const ids = otpEmails.map(e => e.id);
      ids.forEach(id => claimedEmailIds.add(id));
      resultGroups.push({
        id: 'group_otp',
        sender: 'Verification Services',
        title: `Trash ${ids.length} expired verification codes`,
        emailIds: ids,
        actionType: 'trash',
        categoryTag: 'Expired Codes',
        reason: 'Temporary login and verification codes that are no longer valid.',
        filterQuery: 'subject:("verification code" OR "security code" OR "login code" OR "passcode")'
      });
    }

    // 2. Financial Statements
    if (statementEmails.length > 0) {
      const unclaimedStatements = statementEmails.filter(e => !claimedEmailIds.has(e.id));
      if (unclaimedStatements.length > 0) {
        const ids = unclaimedStatements.map(e => e.id);
        ids.forEach(id => claimedEmailIds.add(id));

        const matchedFolder = availableFolderNames.find(f => {
          const l = f.toLowerCase();
          return l.includes('finance') || l.includes('statement') || l.includes('bank') || l.includes('bills');
        });

        resultGroups.push({
          id: 'group_statements',
          sender: 'Finance & Statements',
          title: matchedFolder 
            ? `Move ${ids.length} banking statements to "${matchedFolder}"`
            : `Archive ${ids.length} monthly financial statements`,
          emailIds: ids,
          actionType: matchedFolder ? 'move_to_label' : 'archive',
          suggestedLabel: matchedFolder,
          categoryTag: 'Finance',
          reason: 'Banking alerts, billing notices, and monthly statements.',
          filterQuery: 'subject:("statement ready" OR "monthly statement" OR "e-statement")'
        });
      }
    }

    // 3. Receipts & Orders
    if (receiptEmails.length > 0) {
      const unclaimedReceipts = receiptEmails.filter(e => !claimedEmailIds.has(e.id));
      if (unclaimedReceipts.length > 0) {
        const ids = unclaimedReceipts.map(e => e.id);
        ids.forEach(id => claimedEmailIds.add(id));

        const matchedFolder = availableFolderNames.find(f => {
          const l = f.toLowerCase();
          return l.includes('receipt') || l.includes('purchases') || l.includes('invoice') || l.includes('orders');
        });

        resultGroups.push({
          id: 'group_receipts',
          sender: 'Purchases & Billing',
          title: matchedFolder 
            ? `Move ${ids.length} receipts to "${matchedFolder}"`
            : `Archive ${ids.length} order confirmations & receipts`,
          emailIds: ids,
          actionType: matchedFolder ? 'move_to_label' : 'archive',
          suggestedLabel: matchedFolder,
          categoryTag: 'Receipts',
          reason: matchedFolder 
            ? `Organize completed purchases into your "${matchedFolder}" label and clear from inbox.`
            : `Archive order receipts so they remain safely searchable when needed.`,
          filterQuery: 'subject:(receipt OR invoice OR "order confirmation")'
        });
      }
    }

    // 4. Shipping & Delivery Tracking
    if (shippingEmails.length > 0) {
      const unclaimedShipping = shippingEmails.filter(e => !claimedEmailIds.has(e.id));
      if (unclaimedShipping.length > 0) {
        const ids = unclaimedShipping.map(e => e.id);
        ids.forEach(id => claimedEmailIds.add(id));

        resultGroups.push({
          id: 'group_shipping',
          sender: 'Deliveries & Logistics',
          title: `Archive ${ids.length} package delivery updates`,
          emailIds: ids,
          actionType: 'archive',
          categoryTag: 'Tracking',
          reason: 'Courier tracking numbers and delivered package notifications.',
          filterQuery: 'subject:("out for delivery" OR "package delivered" OR "tracking number")'
        });
      }
    }

    // 5. Calendar Invites
    if (calendarEmails.length > 0) {
      const unclaimedCalendar = calendarEmails.filter(e => !claimedEmailIds.has(e.id));
      if (unclaimedCalendar.length > 0) {
        const ids = unclaimedCalendar.map(e => e.id);
        ids.forEach(id => claimedEmailIds.add(id));

        resultGroups.push({
          id: 'group_calendar',
          sender: 'Calendar & Scheduling',
          title: `Archive ${ids.length} meeting invitations & responses`,
          emailIds: ids,
          actionType: 'archive',
          categoryTag: 'Calendar',
          reason: 'Calendar invites and meeting responses already recorded on schedule.',
          filterQuery: 'subject:(invitation: OR accepted: OR declined: OR "zoom meeting")'
        });
      }
    }

    // 6. Build & CI/CD Alerts
    if (buildAlertEmails.length > 0) {
      const unclaimedBuilds = buildAlertEmails.filter(e => !claimedEmailIds.has(e.id));
      if (unclaimedBuilds.length > 0) {
        const ids = unclaimedBuilds.map(e => e.id);
        ids.forEach(id => claimedEmailIds.add(id));

        resultGroups.push({
          id: 'group_builds',
          sender: 'Developer & CI/CD Alerts',
          title: `Archive ${ids.length} build notifications`,
          emailIds: ids,
          actionType: 'archive',
          categoryTag: 'Notifications',
          reason: 'Automated status reports and build notifications that have already passed.',
          filterQuery: 'subject:("build" OR "pipeline" OR "deployment")'
        });
      }
    }

    // 7. Sender Clusters (Senders with 2+ emails)
    senderMap.forEach((entry, senderGroupKey) => {
      const unclaimed = entry.emails.filter(e => !claimedEmailIds.has(e.id));
      if (unclaimed.length >= 2) {
        const ids = unclaimed.map(e => e.id);
        ids.forEach(id => claimedEmailIds.add(id));

        const brandName = entry.details.brand || entry.details.displayName;
        const hasUnsub = unclaimed.some(e => e.listUnsubscribe);
        const query = (!entry.details.isGenericFreemail && entry.details.rootDomain) 
          ? `from:${entry.details.rootDomain}` 
          : `from:${entry.details.emailAddr}`;

        resultGroups.push({
          id: `group_sender_${senderGroupKey.replace(/[^a-zA-Z0-9]/g, '_')}`,
          sender: brandName,
          title: hasUnsub
            ? `Archive ${ids.length} newsletters from ${brandName}`
            : `Archive ${ids.length} notifications from ${brandName}`,
          emailIds: ids,
          actionType: 'archive',
          categoryTag: hasUnsub ? 'Newsletters' : 'Notifications',
          reason: `High volume of recurring automated messages from ${brandName}.`,
          filterQuery: sanitizeGmailSearchQuery(query)
        });
      }
    });

    // 8. Important Documents & Critical Notices
    if (importantEmails.length > 0) {
      const unclaimedImportant = importantEmails.filter(e => !claimedEmailIds.has(e.id));
      if (unclaimedImportant.length > 0) {
        const ids = unclaimedImportant.map(e => e.id);
        ids.forEach(id => claimedEmailIds.add(id));

        resultGroups.push({
          id: 'group_important',
          sender: 'Important Documents',
          title: `Star ${ids.length} critical notices and security alerts`,
          emailIds: ids,
          actionType: 'star_keep',
          categoryTag: 'Important',
          reason: 'Tax records, security notices, and legal compliance records.',
          filterQuery: 'subject:("tax form" OR "security alert" OR "password reset" OR "w-2")'
        });
      }
    }

    return resultGroups;
  }, [userEmail]);

  // Main Organizer Analysis
  const analyzeFolder = useCallback(async (folderQuery: string) => {
    setLoading(true);
    setError(null);
    setCompletedGroupIds(new Set());
    setCreatedFilterGroupIds(new Set());
    setExpandedGroupIds(new Set());

    try {
      let q = "-in:trash -in:spam -in:sent -is:draft";
      if (folderQuery !== "anywhere") {
        if (folderQuery.startsWith("label:")) {
           const labelName = folderQuery.split(":")[1];
           q = `label:"${labelName}" -in:trash -in:spam -in:sent -is:draft`;
        } else {
           q = `${folderQuery} -in:trash -in:spam -in:sent -is:draft`;
        }
      }// Fetch emails
      const rawEmails = await searchEmails(q, 100);
      const handledIds = getStoredHandledIds();
      const dismissedSenders = getStoredDismissedSenders();

      // Filter out previously handled emails and dismissed senders
      const activeEmails = rawEmails.filter(e => {
        if (handledIds.has(e.id)) return false;
        const match = (e.sender || '').match(/<([^>]+)>/);
        const addr = (match ? match[1] : e.sender || '').toLowerCase().trim();
        if (dismissedSenders.has(addr)) return false;
        return true;
      });

      setFetchedEmails(activeEmails);

      if (activeEmails.length === 0) {
        setGroups([]);
        setLoading(false);
        return;
      }

      // Refresh labels
      let freshLabels = userLabels;
      try {
        const labelsData = await fetchGmailAPI('/labels');
        if (labelsData && labelsData.labels) {
          freshLabels = labelsData.labels;
        }
      } catch {
        // Fall back to cached labels
      }

      const hasAiKey = !!(aiSettings?.apiKey || sessionStorage.getItem('ai_quota_ok') !== 'false');
      let aiSucceeded = false;

      if (hasAiKey) {
        try {
          const payload = {
            emails: activeEmails.map(e => ({
              id: e.id,
              sender: e.sender,
              subject: e.subject,
              labelIds: e.labelIds
            })),
            existingLabels: freshLabels,
            settings: aiSettings,
            userEmail
          };

          const res = await fetch("/api/smart-triage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            const data = await res.json();
            if (data && data.groups && Array.isArray(data.groups) && data.groups.length > 0) {
              setGroups(data.groups);
              aiSucceeded = true;
            }
          } else if (res.status === 429) {
            sessionStorage.setItem('ai_quota_ok', 'false');
          }
        } catch (aiErr) {
          console.warn("AI Triage failed, running local clustering:", aiErr);
        }
      }

      if (!aiSucceeded) {
        const localGroups = runLocalClustering(activeEmails, freshLabels);
        setGroups(localGroups);
      }

    } catch (err: any) {
      console.error('Smart Triage Error:', err);
      setError(err?.message || 'Failed to analyze mailbox.');
    } finally {
      setLoading(false);
    }
  }, [aiSettings, runLocalClustering, userEmail, userLabels]);

  useEffect(() => {
    if (isOpen) {
      analyzeFolder(selectedFolder);
    }
  }, [isOpen, analyzeFolder, selectedFolder]);

  // Toggle Email in a Group
  const toggleEmailInGroup = (groupId: string, emailId: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const deselected = new Set(g.deselectedEmailIds || []);
      if (deselected.has(emailId)) {
        deselected.delete(emailId);
      } else {
        deselected.add(emailId);
      }
      return { ...g, deselectedEmailIds: Array.from(deselected) };
    }));
  };

  // Toggle Expand Email Details
  const toggleExpandGroup = (groupId: string) => {
    setExpandedGroupIds(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // Execute a Single Group Action
  const executeGroupAction = async (group: SmartGroup, createFolderIfNeeded = false) => {
    const activeEmailIds = group.emailIds.filter(id => !(group.deselectedEmailIds || []).includes(id));
    if (activeEmailIds.length === 0) return;

    setExecutingGroupId(group.id);
    try {
      const matchingEmailObjects = fetchedEmails.filter(e => activeEmailIds.includes(e.id));
      const allMessageIds = matchingEmailObjects.flatMap(e => e.messageIds && e.messageIds.length > 0 ? e.messageIds : [e.id]);

      if (group.actionType === 'trash') {
        await batchTrashEmails(allMessageIds);
      } else if (group.actionType === 'archive') {
        await batchArchiveEmails(allMessageIds);
      } else if (group.actionType === 'star_keep') {
        await batchModifyEmails(allMessageIds, ['STARRED'], []);
      } else if (group.actionType === 'move_to_label') {
        let targetLabelId: string | undefined;
        if (group.suggestedLabel) {
          const existing = userLabels.find(l => l.name.toLowerCase() === group.suggestedLabel!.toLowerCase());
          if (existing) {
            targetLabelId = existing.id;
          } else if (createFolderIfNeeded) {
            const created = await createLabel(group.suggestedLabel);
            if (created && created.id) targetLabelId = created.id;
          }
        }

        if (targetLabelId) {
          await batchModifyEmails(allMessageIds, [targetLabelId], ['INBOX']);
        } else {
          await batchArchiveEmails(allMessageIds);
        }
      }

      // Mark handled in state and persistence
      saveHandledIds(activeEmailIds);
      setCompletedGroupIds(prev => new Set(prev).add(group.id));

      if (onRefresh) onRefresh();

    } catch (err: any) {
      console.error('Failed to execute action:', err);
      alert(`Action failed: ${err.message || 'Error executing action on Gmail'}`);
    } finally {
      setExecutingGroupId(null);
    }
  };

  // Execute All Groups
  const executeAllGroups = async () => {
    const pendingGroups = groups.filter(g => !completedGroupIds.has(g.id));
    if (pendingGroups.length === 0) return;

    setExecutingAll(true);
    try {
      for (let i = 0; i < pendingGroups.length; i++) {
        const group = pendingGroups[i];
        const activeIds = group.emailIds.filter(id => !(group.deselectedEmailIds || []).includes(id));
        
        setExecutionProgress({
          current: i + 1,
          total: pendingGroups.length,
          message: `Applying "${group.title}"...`
        });

        if (activeIds.length > 0) {
          const matchingEmailObjects = fetchedEmails.filter(e => activeIds.includes(e.id));
          const allMessageIds = matchingEmailObjects.flatMap(e => e.messageIds && e.messageIds.length > 0 ? e.messageIds : [e.id]);

          if (group.actionType === 'trash') {
            await batchTrashEmails(allMessageIds);
          } else if (group.actionType === 'archive') {
            await batchArchiveEmails(allMessageIds);
          } else if (group.actionType === 'star_keep') {
            await batchModifyEmails(allMessageIds, ['STARRED'], []);
          } else if (group.actionType === 'move_to_label') {
            let labelId = userLabels.find(l => l.name.toLowerCase() === (group.suggestedLabel || '').toLowerCase())?.id;
            if (labelId) {
              await batchModifyEmails(allMessageIds, [labelId], ['INBOX']);
            } else {
              await batchArchiveEmails(allMessageIds);
            }
          }
          saveHandledIds(activeIds);
        }

        setCompletedGroupIds(prev => new Set(prev).add(group.id));
        await new Promise(r => setTimeout(r, 120));
      }

      if (onRefresh) onRefresh();

    } catch (err: any) {
      console.error('Failed executing all groups:', err);
      alert(`Batch error: ${err.message || 'Error processing all groups'}`);
    } finally {
      setExecutingAll(false);
      setExecutionProgress({ current: 0, total: 0, message: '' });
    }
  };

  // Create Future Filter Rule
  const handleCreateRule = async (group: SmartGroup) => {
    if (!group.filterQuery) return;
    setCreatingFilterId(group.id);
    try {
      let addLabels: string[] = [];
      let removeLabels: string[] = ['INBOX'];

      if (group.actionType === 'move_to_label' && group.suggestedLabel) {
        const existing = userLabels.find(l => l.name.toLowerCase() === group.suggestedLabel!.toLowerCase());
        if (existing) addLabels.push(existing.id);
      } else if (group.actionType === 'trash') {
        addLabels.push('TRASH');
      } else if (group.actionType === 'star_keep') {
        addLabels.push('STARRED');
        removeLabels = [];
      }

      await createFilter(group.filterQuery, addLabels, removeLabels);
      setCreatedFilterGroupIds(prev => new Set(prev).add(group.id));
    } catch (err: any) {
      console.error('Failed to create filter rule:', err);
      alert(`Failed to create rule: ${err.message || 'Error creating Gmail filter'}`);
    } finally {
      setCreatingFilterId(null);
    }
  };

  // Dismiss a Sender permanently
  const handleDismissGroup = (group: SmartGroup) => {
    saveDismissedSender(group.sender);
    saveHandledIds(group.emailIds);
    setGroups(prev => prev.filter(g => g.id !== group.id));
  };

  // Filter tabs
  const filteredGroups = useMemo(() => {
    if (activeFilterTab === 'all') return groups;
    if (activeFilterTab === 'archive') return groups.filter(g => g.actionType === 'archive');
    if (activeFilterTab === 'move') return groups.filter(g => g.actionType === 'move_to_label');
    if (activeFilterTab === 'trash') return groups.filter(g => g.actionType === 'trash');
    if (activeFilterTab === 'keep') return groups.filter(g => g.actionType === 'star_keep');
    return groups;
  }, [groups, activeFilterTab]);

  const totalActionableEmails = useMemo(() => {
    return groups.reduce((acc, g) => acc + g.emailIds.length, 0);
  }, [groups]);

  const isAllCompleted = groups.length > 0 && completedGroupIds.size === groups.length;

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 lg:p-6 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-organizer-title"
    >
      <div 
        className="bg-white w-full max-w-4xl shadow-xl flex flex-col overflow-hidden border border-slate-200 h-full sm:h-[88vh] sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap justify-between items-center bg-white shrink-0 gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 text-slate-700 rounded-lg shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="smart-organizer-title" className="font-semibold text-slate-900 text-base sm:text-lg">
                  Smart Organizer
                </h2>
                <div className="h-4 w-px bg-slate-200 hidden sm:block" />
                <select
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                  disabled={loading}
                  className="bg-slate-50 border border-slate-200 rounded-md py-1 px-2.5 text-xs font-medium text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-slate-400 cursor-pointer disabled:opacity-50"
                >
                  <option value="in:inbox">Inbox</option>
                  <option value="anywhere">Everywhere</option>
                  <option value="category:updates">Updates</option>
                  <option value="category:promotions">Promotions</option>
                  <option value="category:social">Social</option>
                  <option value="category:forums">Forums</option>
                  {userLabels?.filter(l => l.type === 'user').map(l => (
                    <option key={l.id} value={`label:"${l.name}"`}>{l.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Identifies recurring senders and bundles them into clean, one-click actions.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => analyzeFolder(selectedFolder)}
              disabled={loading}
              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
              title="Refresh analysis"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
            <button 
              onClick={onClose} 
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              title="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Top Control Bar & Filters */}
        {!loading && groups.length > 0 && !isAllCompleted && (
          <div className="px-5 py-3 border-b border-slate-200/80 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                onClick={() => setActiveFilterTab('all')}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                  activeFilterTab === 'all'
                    ? "bg-slate-900 text-white shadow-xs"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                )}
              >
                All ({groups.length})
              </button>
              {groups.some(g => g.actionType === 'archive') && (
                <button
                  onClick={() => setActiveFilterTab('archive')}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                    activeFilterTab === 'archive'
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  )}
                >
                  To Archive ({groups.filter(g => g.actionType === 'archive').length})
                </button>
              )}
              {groups.some(g => g.actionType === 'move_to_label') && (
                <button
                  onClick={() => setActiveFilterTab('move')}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                    activeFilterTab === 'move'
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  )}
                >
                  To Labels ({groups.filter(g => g.actionType === 'move_to_label').length})
                </button>
              )}
              {groups.some(g => g.actionType === 'trash') && (
                <button
                  onClick={() => setActiveFilterTab('trash')}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                    activeFilterTab === 'trash'
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  )}
                >
                  To Trash ({groups.filter(g => g.actionType === 'trash').length})
                </button>
              )}
              {groups.some(g => g.actionType === 'star_keep') && (
                <button
                  onClick={() => setActiveFilterTab('keep')}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                    activeFilterTab === 'keep'
                      ? "bg-slate-900 text-white shadow-xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  )}
                >
                  Keep / Protect ({groups.filter(g => g.actionType === 'star_keep').length})
                </button>
              )}
            </div>

            <button
              onClick={executeAllGroups}
              disabled={executingAll || completedGroupIds.size === groups.length}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 ml-auto"
            >
              {executingAll ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Applying ({executionProgress.current}/{executionProgress.total})...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Apply All ({totalActionableEmails} emails)</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6">
          {loading ? (
            <div className="h-72 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-7 h-7 text-slate-700 animate-spin" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Analyzing your inbox...</p>
                <p className="text-xs text-slate-500 mt-0.5">Grouping emails by recurring senders, receipts, and notifications.</p>
              </div>
            </div>
          ) : error ? (
            <div className="h-72 flex flex-col items-center justify-center gap-3 text-center p-4">
              <p className="text-sm font-medium text-slate-800">{error}</p>
              <button 
                onClick={() => analyzeFolder(selectedFolder)}
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          ) : isAllCompleted ? (
            <div className="h-80 flex flex-col items-center justify-center text-center p-6 animate-in zoom-in-95 duration-200">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-3">
                <CheckCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold text-slate-900">All caught up</h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm">
                You have reviewed and organized all recommended clusters in this view.
              </p>
              <button 
                onClick={onClose}
                className="mt-4 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
              >
                Done
              </button>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="h-80 flex flex-col items-center justify-center text-center p-6">
              <div className="w-12 h-12 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mb-3">
                <Inbox className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-slate-900">No clusters found</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                No unorganized patterns or repetitive clusters were detected in this folder.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5 max-w-3xl mx-auto w-full">
              {filteredGroups.map((group) => {
                const isCompleted = completedGroupIds.has(group.id);
                const isExecuting = executingGroupId === group.id;
                const isExpanded = expandedGroupIds.has(group.id);
                const isFilterCreated = createdFilterGroupIds.has(group.id);
                const isCreatingFilter = creatingFilterId === group.id;

                const activeEmailIds = group.emailIds.filter(id => !(group.deselectedEmailIds || []).includes(id));
                const sampleEmails = fetchedEmails.filter(e => group.emailIds.includes(e.id));

                const labelExists = !group.suggestedLabel || userLabels?.some(l => l.name.toLowerCase() === group.suggestedLabel!.toLowerCase());

                return (
                  <div
                    key={group.id}
                    className={cn(
                      "bg-white border rounded-xl p-4 shadow-xs transition-all flex flex-col gap-3",
                      isCompleted ? "border-slate-200 opacity-60 bg-slate-50/50" : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {/* Top Row: Sender Info & Actions */}
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div className="min-w-0 flex-1 w-full">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="font-semibold text-slate-900 text-sm truncate max-w-[200px] sm:max-w-xs">
                            {group.sender}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-slate-100 text-slate-600 shrink-0">
                            {group.categoryTag}
                          </span>
                          <span className="text-xs text-slate-400 shrink-0">
                            • {activeEmailIds.length} {activeEmailIds.length === 1 ? 'email' : 'emails'}
                          </span>
                        </div>
                        <h4 className="text-xs sm:text-sm font-bold text-slate-800 break-words leading-snug">
                          {group.title}
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed break-words">
                          {group.reason}
                        </p>
                      </div>

                      {/* Right Action Buttons */}
                      <div className="shrink-0 flex flex-row sm:flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        {isCompleted ? (
                          <div className="flex items-center justify-center gap-1.5 text-emerald-600 text-xs font-semibold px-4 py-2 bg-emerald-50 rounded-lg border border-emerald-100 w-full sm:w-auto">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Done</span>
                          </div>
                        ) : (
                          <div className="flex flex-1 sm:flex-initial gap-2 items-center">
                            {group.actionType === 'trash' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                <span>Trash ({activeEmailIds.length})</span>
                              </button>
                            )}

                            {group.actionType === 'archive' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                                <span>Archive ({activeEmailIds.length})</span>
                              </button>
                            )}

                            {group.actionType === 'move_to_label' && (
                              <button
                                onClick={() => executeGroupAction(group, !labelExists)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 min-w-[140px]"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5 shrink-0" />}
                                <span className="truncate max-w-[120px] sm:max-w-[150px]">Move to {group.suggestedLabel || 'Label'}</span>
                              </button>
                            )}

                            {group.actionType === 'star_keep' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5 fill-current shrink-0" />}
                                <span className="whitespace-nowrap">Protect & Keep</span>
                              </button>
                            )}

                            <button
                              onClick={() => handleDismissGroup(group)}
                              disabled={isExecuting}
                              className="p-2 sm:p-1.5 shrink-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 sm:border-transparent flex items-center justify-center"
                              title="Dismiss this sender from future recommendations"
                            >
                              <X className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Metadata & Expandable Emails */}
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs gap-2">
                      <button
                        onClick={() => toggleExpandGroup(group.id)}
                        className="text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1"
                      >
                        <span>{isExpanded ? 'Hide' : 'Review'} {sampleEmails.length} messages</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {group.filterQuery && !isCompleted && (
                        <div className="flex items-center gap-2">
                          {isFilterCreated ? (
                            <span className="text-[11px] text-emerald-600 flex items-center gap-1 font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              Rule Created
                            </span>
                          ) : (
                            <button
                              onClick={() => handleCreateRule(group)}
                              disabled={isCreatingFilter}
                              className="text-[11px] text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1 hover:underline disabled:opacity-50"
                            >
                              {isCreatingFilter ? <Loader2 className="w-3 h-3 animate-spin" /> : <Filter className="w-3 h-3" />}
                              <span>Auto-apply to future</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Expanded Email List */}
                    {isExpanded && sampleEmails.length > 0 && (
                      <div className="mt-1 bg-slate-50 rounded-lg p-2.5 border border-slate-200/70 flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                        {sampleEmails.map(email => {
                          const isChecked = !(group.deselectedEmailIds || []).includes(email.id);

                          return (
                            <label
                              key={email.id}
                              className="flex items-start gap-2 p-1.5 rounded-md hover:bg-white transition-colors cursor-pointer text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleEmailInGroup(group.id, email.id)}
                                disabled={isCompleted}
                                className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-0 cursor-pointer"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-slate-800 truncate">
                                  {email.subject || '(No Subject)'}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {email.snippet || email.sender}
                                </p>
                              </div>
                              <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap ml-2">
                                {email.date ? new Date(email.date).toLocaleDateString() : ''}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
