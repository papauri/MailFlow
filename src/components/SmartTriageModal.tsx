import { SketchLoadingState } from './SketchLoader';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  CheckCircle,
  RefreshCw,
  Zap,
  MoreHorizontal,
  Star
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
import { useActionCompletion } from '../lib/useActionCompletion';
import { extractSenderDetails, sanitizeGmailSearchQuery } from '../lib/emailUtils';
import {
  AutomationToolbar, AutomationGrid, AutomationCard, AutomationState,
  ReviewToggle, ReviewPanel,
} from './AutomationShell';

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

export interface SmartInsight {
  id: string;
  title: string;
  description: string;
  actionType: 'mark_read' | 'trash_promotions' | 'archive_old' | string;
  actionLabel: string;
  filterQuery: string;
}

export interface SmartTriageModalProps {
  isOpen?: boolean;
  onClose: () => void;
  aiSettings?: any;
  userLabels?: any[];
  userEmail?: string;
  onRefresh?: () => void;
  isPage?: boolean;
  /** False when shown as a tab inside another page, which supplies its own header. */
  showHeader?: boolean;
  /** Rendered inside a panel the parent already drew — so draw no panel of our own. */
  embedded?: boolean;
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
  isOpen = true,
  onClose,
  aiSettings,
  userLabels = [],
  userEmail,
  onRefresh,
  isPage = false,
  showHeader = true,
  embedded = false,
}: SmartTriageModalProps) {
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<SmartGroup[]>([]);
  const [insights, setInsights] = useState<SmartInsight[]>([]);
  const [handledInsightIds, setHandledInsightIds] = useState<Set<string>>(new Set());
  const [executingInsightId, setExecutingInsightId] = useState<string | null>(null);

  /**
   * Inline review state for the Smart Actions.
   *
   * These used to hand off to `#filter-view`, which meant leaving Smart Automations
   * to look at what an action would touch and then finding your way back. Everything
   * a card offers is now reviewable inside the card, so the messages are fetched here
   * on demand and kept per insight — reopening one costs nothing.
   */
  const [expandedInsightIds, setExpandedInsightIds] = useState<Set<string>>(new Set());
  const [insightEmails, setInsightEmails] = useState<Map<string, EmailData[]>>(new Map());
  const [loadingInsightId, setLoadingInsightId] = useState<string | null>(null);
  const [insightDeselected, setInsightDeselected] = useState<Map<string, Set<string>>>(new Map());
  const [insightErrors, setInsightErrors] = useState<Map<string, string>>(new Map());
  const [fetchedEmails, setFetchedEmails] = useState<EmailData[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  // Selection & UI Filters
  const [selectedFolder, setSelectedFolder] = useState<string>("in:inbox");
  const [activeFilterTab, setActiveFilterTab] = useState<'all' | 'archive' | 'move' | 'trash' | 'keep'>('all');
  const [filterText, setFilterText] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  // Execution States
  const [executingGroupId, setExecutingGroupId] = useState<string | null>(null);
  const [executingAll, setExecutingAll] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{ current: number; total: number; message: string }>({ current: 0, total: 0, message: '' });
  const [completedGroupIds, setCompletedGroupIds] = useState<Set<string>>(new Set());
  // Same confirm-then-clear behaviour as the recommendation panels: a finished
  // group is no longer actionable, so it should leave rather than sit greyed out.
  const completion = useActionCompletion();
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
              if (data.insights && Array.isArray(data.insights)) {
                setInsights(data.insights);
              } else {
                setInsights([]);
              }
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
  const executeGroupAction = async (
    group: SmartGroup, 
    createFolderIfNeeded = false, 
    overrideAction?: 'trash' | 'archive' | 'star_keep' | 'move_to_label',
    overrideLabel?: string
  ) => {
    const activeEmailIds = group.emailIds.filter(id => !(group.deselectedEmailIds || []).includes(id));
    if (activeEmailIds.length === 0) return;

    setExecutingGroupId(group.id);
    try {
      const matchingEmailObjects = fetchedEmails.filter(e => activeEmailIds.includes(e.id));
      const allMessageIds = matchingEmailObjects.flatMap(e => e.messageIds && e.messageIds.length > 0 ? e.messageIds : [e.id]);

      const action = overrideAction || group.actionType;
      const targetLabel = overrideLabel || group.suggestedLabel;

      if (action === 'trash') {
        await batchTrashEmails(allMessageIds);
      } else if (action === 'archive') {
        await batchArchiveEmails(allMessageIds);
      } else if (action === 'star_keep') {
        await batchModifyEmails(allMessageIds, ['STARRED'], []);
      } else if (action === 'move_to_label') {
        let targetLabelId: string | undefined;
        if (targetLabel) {
          const existing = userLabels.find(l => l.name.toLowerCase() === targetLabel.toLowerCase());
          if (existing) {
            targetLabelId = existing.id;
          } else if (createFolderIfNeeded) {
            const created = await createLabel(targetLabel);
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
      completion.complete(group.id, 'Organized');

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
        completion.complete(group.id, 'Organized');
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

  /** Number of messages the insight's review list still has selected. */
  const insightSelection = useCallback((insight: SmartInsight): EmailData[] => {
    const loaded = insightEmails.get(insight.id);
    if (!loaded) return [];
    const off = insightDeselected.get(insight.id) || new Set<string>();
    return loaded.filter(e => !off.has(e.id));
  }, [insightEmails, insightDeselected]);

  /** True once the user has excluded something, which pins the action to the review. */
  const insightIsNarrowed = (insight: SmartInsight) =>
    (insightDeselected.get(insight.id)?.size || 0) > 0;

  const toggleInsightReview = async (insight: SmartInsight) => {
    const isOpen = expandedInsightIds.has(insight.id);
    setExpandedInsightIds(prev => {
      const next = new Set(prev);
      if (isOpen) next.delete(insight.id);
      else next.add(insight.id);
      return next;
    });
    if (isOpen || insightEmails.has(insight.id)) return;

    setLoadingInsightId(insight.id);
    setInsightErrors(prev => { const n = new Map(prev); n.delete(insight.id); return n; });
    try {
      // A review sample, not the whole result set: the action itself still runs
      // against the query unless the user narrows it, so fetching hundreds of
      // messages nobody will scroll through would only spend quota.
      const matches = await searchEmails(sanitizeGmailSearchQuery(insight.filterQuery), 60);
      setInsightEmails(prev => new Map(prev).set(insight.id, matches));
    } catch (err: any) {
      setInsightErrors(prev => new Map(prev).set(insight.id, err?.message || 'Could not load these messages.'));
    } finally {
      setLoadingInsightId(null);
    }
  };

  const toggleEmailInInsight = (insightId: string, emailId: string) => {
    setInsightDeselected(prev => {
      const next = new Map<string, Set<string>>(prev);
      const set = new Set<string>(next.get(insightId) || []);
      if (set.has(emailId)) set.delete(emailId);
      else set.add(emailId);
      next.set(insightId, set);
      return next;
    });
  };

  /**
   * Runs a Smart Action.
   *
   * Acts on the whole query by default — that is what the card claims to do. But once
   * the user has deselected something in the review list, the action is confined to
   * exactly what is still ticked: silently trashing messages someone has just
   * unticked would make the review a lie.
   */
  const executeInsightAction = async (insight: SmartInsight) => {
    setExecutingInsightId(insight.id);
    try {
      const narrowed = insightIsNarrowed(insight);
      const targets = narrowed
        ? insightSelection(insight)
        : await searchEmails(sanitizeGmailSearchQuery(insight.filterQuery), 500);

      const allMessageIds = targets.flatMap(e => e.messageIds && e.messageIds.length > 0 ? e.messageIds : [e.id]);

      if (allMessageIds.length > 0) {
        if (insight.actionType === 'mark_read') {
          await batchModifyEmails(allMessageIds, [], ['UNREAD']);
        } else if (insight.actionType === 'trash_promotions' || insight.actionType === 'trash') {
          await batchTrashEmails(allMessageIds);
        } else if (insight.actionType === 'archive_old' || insight.actionType === 'archive') {
          await batchArchiveEmails(allMessageIds);
        } else {
          // Default to archive if unknown
          await batchArchiveEmails(allMessageIds);
        }
      }

      setHandledInsightIds(prev => new Set(prev).add(insight.id));
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Insight execution failed:', err);
      alert('Failed to execute insight action.');
    } finally {
      setExecutingInsightId(null);
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
    let result = groups;
    if (activeFilterTab === 'archive') result = result.filter(g => g.actionType === 'archive');
    else if (activeFilterTab === 'move') result = result.filter(g => g.actionType === 'move_to_label');
    else if (activeFilterTab === 'trash') result = result.filter(g => g.actionType === 'trash');
    else if (activeFilterTab === 'keep') result = result.filter(g => g.actionType === 'star_keep');
    
    if (filterText.trim()) {
      const lower = filterText.toLowerCase();
      result = result.filter(g => 
        g.sender.toLowerCase().includes(lower) || 
        g.title.toLowerCase().includes(lower) || 
        (g.reason || '').toLowerCase().includes(lower)
      );
    }
    
    return result;
  }, [groups, activeFilterTab, filterText]);

  const totalActionableEmails = useMemo(() => {
    return groups.reduce((acc, g) => acc + g.emailIds.length, 0);
  }, [groups]);

  const isAllCompleted = groups.length > 0 && completedGroupIds.size === groups.length;

  const visibleInsights = useMemo(
    () => insights.filter(i => !handledInsightIds.has(i.id)),
    [insights, handledInsightIds]
  );

  /** Chips are built from what is actually present, so none of them ever reads zero. */
  const filterChips = useMemo(() => {
    const byAction = (t: SmartGroup['actionType']) => groups.filter(g => g.actionType === t).length;
    return [
      { id: 'all', label: 'All', count: groups.length },
      { id: 'archive', label: 'Archive', count: byAction('archive') },
      { id: 'move', label: 'File', count: byAction('move_to_label') },
      { id: 'trash', label: 'Trash', count: byAction('trash') },
      { id: 'keep', label: 'Keep', count: byAction('star_keep') },
    ].filter(c => c.id === 'all' || c.count > 0);
  }, [groups]);

  if (!isPage && !isOpen) return null;

  const headerElement = (
    <div className={cn(
      "flex flex-wrap justify-between items-center bg-white shrink-0 gap-3",
      isPage ? "p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs" : "px-5 py-4 border-b border-slate-200"
    )}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-100 border border-slate-200 text-slate-700 rounded-xl shrink-0">
          <Layers className="w-5 h-5" />
        </div>
        <div>
          <h2 id="smart-organizer-title" className="font-bold text-slate-900 text-base sm:text-lg">
            Smart Organizer
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Identifies recurring senders and bundles them into clean, one-click actions.
          </p>
        </div>
      </div>

      {!isPage && (
        <button
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
          title="Close modal"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );

  /**
   * Which mailbox this is analysing, and a way to re-run it.
   *
   * These lived inside the header, which the Smart Automations portal hides because it
   * supplies its own — so on that tab there was no way to change folder or refresh at
   * all, while the other two tabs both had a refresh control. Kept out of the header
   * so it renders wherever the tool does.
   */
  const folderPicker = (
    <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 bg-white border-b border-slate-200 shrink-0">
      <label htmlFor="smart-organizer-scope" className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider shrink-0">
        Analysing
      </label>
      <select
        id="smart-organizer-scope"
        value={selectedFolder}
        onChange={(e) => setSelectedFolder(e.target.value)}
        disabled={loading}
        className="bg-white border border-slate-200 rounded-lg py-1 px-2 text-xs font-semibold text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 cursor-pointer disabled:opacity-50 max-w-[200px]"
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

      <button
        onClick={() => analyzeFolder(selectedFolder)}
        disabled={loading}
        className="ml-auto p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50 cursor-pointer shrink-0"
        title="Refresh analysis"
        aria-label="Refresh analysis"
      >
        <RefreshCw className={cn("w-4 h-4", loading && "animate-spin text-slate-800")} />
      </button>
    </div>
  );

  /** One icon per action, so a card's intent is readable before its text is. */
  const ACTION_ICON: Record<SmartGroup['actionType'], React.ReactNode> = {
    archive: <Archive className="w-3.5 h-3.5" />,
    trash: <Trash2 className="w-3.5 h-3.5" />,
    move_to_label: <FolderInput className="w-3.5 h-3.5" />,
    star_keep: <Bookmark className="w-3.5 h-3.5" />,
  };

  /**
   * One row of an inline review list.
   *
   * Shared between the group cards and the Smart Actions so reviewing is the same
   * gesture in both: tick to include, untick to exclude, open in Gmail to check.
   */
  const reviewRow = (
    email: EmailData,
    checked: boolean,
    onToggle: () => void,
    disabled: boolean = false
  ) => (
    <div
      key={email.id}
      className={cn(
        "flex items-start gap-2 px-2.5 py-2 bg-white/60 hover:bg-white transition-colors",
        !checked && "opacity-50"
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-0 cursor-pointer shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className={cn(
          "text-[12px] font-semibold text-slate-800 leading-snug truncate",
          !checked && "line-through"
        )}>
          {email.subject || '(No Subject)'}
        </p>
        <p className="text-[11px] text-slate-500 truncate">
          <span className="font-medium text-slate-600">{email.sender}</span>
          {email.snippet ? ` — ${email.snippet}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] text-slate-400 whitespace-nowrap hidden sm:inline">
          {email.date ? new Date(email.date).toLocaleDateString() : ''}
        </span>
        <a
          href={`https://mail.google.com/mail/u/0/#all/${email.threadId || email.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-300 hover:text-slate-700 p-1 rounded hover:bg-slate-100 transition-colors"
          title="Open in Gmail"
          onClick={(e) => e.stopPropagation()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
        </a>
      </div>
    </div>
  );

  const mainBodyContent = (
    <>
      {/* Smart Actions — whole-mailbox moves, reviewable in place */}
      {!loading && visibleInsights.length > 0 && !isAllCompleted && (
        <div className="px-3 sm:px-4 pt-3 pb-3.5 bg-slate-50/70 border-b border-slate-200 shrink-0">
          <h3 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-slate-500" /> Smart Actions
          </h3>
          <AutomationGrid>
            {visibleInsights.map(insight => {
              const isExecuting = executingInsightId === insight.id;
              const isOpen = expandedInsightIds.has(insight.id);
              const loaded = insightEmails.get(insight.id);
              const narrowed = insightIsNarrowed(insight);
              const selected = insightSelection(insight);
              const loadError = insightErrors.get(insight.id);

              return (
                <AutomationCard
                  key={insight.id}
                  icon={<Zap className="w-3.5 h-3.5" />}
                  title={insight.title}
                  description={insight.description}
                  expanded={isOpen}
                  tags={narrowed ? [{ label: `${selected.length} of ${loaded?.length ?? 0} selected`, tone: 'warn' }] : undefined}
                  footerLeft={
                    <ReviewToggle
                      open={isOpen}
                      loading={loadingInsightId === insight.id}
                      count={loaded?.length ?? 0}
                      onClick={() => toggleInsightReview(insight)}
                    />
                  }
                  footerRight={
                    <button
                      onClick={() => executeInsightAction(insight)}
                      disabled={isExecuting || (narrowed && selected.length === 0)}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-[11px] font-semibold shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {isExecuting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                      <span className="whitespace-nowrap">
                        {narrowed ? `${insight.actionLabel} ${selected.length}` : insight.actionLabel}
                      </span>
                    </button>
                  }
                >
                  {isOpen && (
                    <ReviewPanel>
                      {loadError ? (
                        <p className="px-3 py-4 text-[11px] text-slate-500 text-center">{loadError}</p>
                      ) : !loaded ? (
                        <p className="px-3 py-4 text-[11px] text-slate-500 text-center flex items-center justify-center gap-2">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading messages…
                        </p>
                      ) : loaded.length === 0 ? (
                        <p className="px-3 py-4 text-[11px] text-slate-500 text-center">
                          Nothing currently matches this action.
                        </p>
                      ) : (
                        <>
                          {loaded.map(email =>
                            reviewRow(
                              email,
                              !(insightDeselected.get(insight.id)?.has(email.id)),
                              () => toggleEmailInInsight(insight.id, email.id),
                              isExecuting
                            )
                          )}
                          <p className="px-3 py-2 text-[10px] text-slate-500 bg-slate-100/70 leading-relaxed">
                            {narrowed
                              ? `Untick anything you want to keep — this will act on the ${selected.length.toLocaleString()} still selected.`
                              : `Showing the first ${loaded.length.toLocaleString()}. Leaving everything ticked applies the action to all matching mail; untick any message to limit it to this list.`}
                          </p>
                        </>
                      )}
                    </ReviewPanel>
                  )}
                </AutomationCard>
              );
            })}
          </AutomationGrid>
        </div>
      )}

      {/* Filters and the batch action */}
      {!loading && groups.length > 0 && !isAllCompleted && (
        <AutomationToolbar
          chips={filterChips}
          activeChip={activeFilterTab}
          onChipSelect={(id) => setActiveFilterTab(id as typeof activeFilterTab)}
          search={filterText}
          onSearchChange={setFilterText}
          actions={
            <button
              onClick={executeAllGroups}
              disabled={executingAll || completedGroupIds.size === groups.length}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg text-[11px] font-semibold shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
            >
              {executingAll ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span className="whitespace-nowrap">Applying {executionProgress.current}/{executionProgress.total}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  <span className="whitespace-nowrap">Apply all ({totalActionableEmails.toLocaleString()})</span>
                </>
              )}
            </button>
          }
        />
      )}

      {/* Recommendations */}
      <div className="flex-1 bg-slate-50/50 p-3 sm:p-4 overflow-y-auto">
        {loading ? (
          <div className="h-72 flex flex-col items-center justify-center gap-3 text-center">
            <SketchLoadingState scene="sorting"
              title="Triaging Inbox"
              messages={[
                "Analyzing unorganized emails...",
                "Grouping by recurring senders...",
                "Isolating receipts and notifications...",
                "Preparing smart recommendations..."
              ]}
            />
          </div>
        ) : error ? (
          <AutomationState
            kind="error"
            title={error}
            action={
              <button
                onClick={() => analyzeFolder(selectedFolder)}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            }
          />
        ) : isAllCompleted ? (
          <AutomationState
            kind="done"
            title="All caught up"
            body="You have reviewed and organized all recommended clusters in this view."
            action={
              <button
                onClick={onClose}
                className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Done
              </button>
            }
          />
        ) : filteredGroups.length === 0 ? (
          <AutomationState
            kind="empty"
            title="No clusters found"
            body="No unorganized patterns or repetitive clusters were detected in this folder."
          />
        ) : (
          <AutomationGrid>
            {filteredGroups.filter(g => !completion.isCleared(g.id)).map((group) => {
              const doneLabel = completion.labelFor(group.id);
              const isCompleted = !!doneLabel;
              const isExecuting = executingGroupId === group.id;
              const isExpanded = expandedGroupIds.has(group.id);
              const isFilterCreated = createdFilterGroupIds.has(group.id);
              const isCreatingFilter = creatingFilterId === group.id;

              const activeEmailIds = group.emailIds.filter(id => !(group.deselectedEmailIds || []).includes(id));
              const sampleEmails = fetchedEmails.filter(e => group.emailIds.includes(e.id));
              const excluded = group.emailIds.length - activeEmailIds.length;

              const labelExists = !group.suggestedLabel || userLabels?.some(l => l.name.toLowerCase() === group.suggestedLabel!.toLowerCase());

              return (
                <AutomationCard
                  key={group.id}
                  icon={ACTION_ICON[group.actionType]}
                  title={group.title}
                  done={isCompleted}
                  doneLabel={doneLabel}
                  expanded={isExpanded}
                  onDismiss={isExecuting ? undefined : () => handleDismissGroup(group)}
                  tags={[
                    { label: group.categoryTag },
                    {
                      label: `${activeEmailIds.length.toLocaleString()} ${activeEmailIds.length === 1 ? 'email' : 'emails'}`,
                      tone: excluded > 0 ? 'warn' : 'neutral',
                    },
                  ]}
                  description={<><span className="font-medium text-slate-700">{group.sender}</span> — {group.reason}</>}
                  footerLeft={
                    <>
                      <ReviewToggle
                        open={isExpanded}
                        count={sampleEmails.length}
                        onClick={() => toggleExpandGroup(group.id)}
                      />
                      {group.filterQuery && !isCompleted && (
                        isFilterCreated ? (
                          <span className="text-[10px] text-emerald-600 flex items-center gap-1 font-semibold whitespace-nowrap">
                            <CheckCircle2 className="w-3 h-3" /> Rule on
                          </span>
                        ) : (
                          <button
                            onClick={() => handleCreateRule(group)}
                            disabled={isCreatingFilter}
                            className="text-[10px] text-slate-400 hover:text-slate-800 font-semibold flex items-center gap-1 hover:underline disabled:opacity-50 cursor-pointer whitespace-nowrap"
                            title="Create a Gmail filter so future mail like this is handled automatically"
                          >
                            {isCreatingFilter ? <Loader2 className="w-3 h-3 animate-spin" /> : <Filter className="w-3 h-3" />}
                            <span>Automate</span>
                          </button>
                        )
                      )}
                    </>
                  }
                  footerRight={
                    isCompleted ? (
                      <span className="flex items-center gap-1 text-emerald-600 text-[11px] font-semibold px-2 py-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Done
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => executeGroupAction(group, group.actionType === 'move_to_label' && !labelExists)}
                          disabled={isExecuting || activeEmailIds.length === 0}
                          className={cn(
                            "flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-semibold text-white shadow-2xs transition-colors disabled:opacity-50 cursor-pointer max-w-[170px]",
                            group.actionType === 'trash' && "bg-rose-600 hover:bg-rose-700",
                            group.actionType === 'archive' && "bg-slate-900 hover:bg-slate-800",
                            group.actionType === 'move_to_label' && "bg-emerald-700 hover:bg-emerald-800",
                            group.actionType === 'star_keep' && "bg-amber-600 hover:bg-amber-700",
                          )}
                        >
                          {isExecuting
                            ? <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            : <span className="shrink-0">{ACTION_ICON[group.actionType]}</span>}
                          <span className="truncate">
                            {group.actionType === 'trash' && `Trash ${activeEmailIds.length}`}
                            {group.actionType === 'archive' && `Archive ${activeEmailIds.length}`}
                            {group.actionType === 'move_to_label' && `File to ${group.suggestedLabel || 'label'}`}
                            {group.actionType === 'star_keep' && 'Protect'}
                          </span>
                        </button>

                        <div className="relative shrink-0">
                          <button
                            onClick={() => setOpenDropdownId(openDropdownId === group.id ? null : group.id)}
                            disabled={isExecuting || activeEmailIds.length === 0}
                            className="flex items-center justify-center p-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-50 cursor-pointer"
                            title="Other actions"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>

                          <AnimatePresence>
                            {openDropdownId === group.id && (
                              <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 4 }}
                                className="absolute right-0 bottom-full mb-1.5 w-44 bg-white border border-slate-200 shadow-lg rounded-xl overflow-hidden z-20 py-1"
                              >
                                <button onClick={() => { executeGroupAction(group, false, 'trash'); setOpenDropdownId(null); }} className="w-full text-left px-3 py-1.5 text-[11px] text-rose-600 hover:bg-slate-50 flex items-center gap-2 transition-colors cursor-pointer">
                                  <Trash2 className="w-3.5 h-3.5" /> Move to Trash
                                </button>
                                <button onClick={() => { executeGroupAction(group, false, 'archive'); setOpenDropdownId(null); }} className="w-full text-left px-3 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors cursor-pointer">
                                  <Archive className="w-3.5 h-3.5" /> Archive
                                </button>
                                <button onClick={() => { executeGroupAction(group, false, 'star_keep'); setOpenDropdownId(null); }} className="w-full text-left px-3 py-1.5 text-[11px] text-amber-600 hover:bg-slate-50 flex items-center gap-2 transition-colors cursor-pointer">
                                  <Star className="w-3.5 h-3.5" /> Star / Keep
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </>
                    )
                  }
                >
                  {isExpanded && (
                    <ReviewPanel>
                      {sampleEmails.length === 0 ? (
                        <p className="px-3 py-4 text-[11px] text-slate-500 text-center">
                          These messages are no longer in the current sample.
                        </p>
                      ) : (
                        <>
                          {sampleEmails.map(email =>
                            reviewRow(
                              email,
                              !(group.deselectedEmailIds || []).includes(email.id),
                              () => toggleEmailInGroup(group.id, email.id),
                              isCompleted || isExecuting
                            )
                          )}
                          {excluded > 0 && (
                            <p className="px-3 py-2 text-[10px] text-slate-500 bg-slate-100/70">
                              {excluded.toLocaleString()} excluded — the action will skip {excluded === 1 ? 'it' : 'them'}.
                            </p>
                          )}
                        </>
                      )}
                    </ReviewPanel>
                  )}
                </AutomationCard>
              );
            })}
          </AutomationGrid>
        )}
      </div>
    </>
  );

  // Inside Smart Automations the portal already supplies the panel. Drawing a second
  // one here is what gave that tab a card-inside-a-card border the other tabs lacked.
  if (embedded) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        {showHeader && headerElement}
        {folderPicker}
        {mainBodyContent}
      </div>
    );
  }

  if (isPage) {
    return (
      <div className="w-full flex flex-col gap-4 animate-in fade-in duration-150">
        {showHeader && headerElement}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden flex flex-col min-h-[600px] relative">
          {folderPicker}
          {mainBodyContent}
        </div>
      </div>
    );
  }

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-organizer-title"
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {headerElement}
        {folderPicker}
        {mainBodyContent}
      </div>
    </div>
  );
}
