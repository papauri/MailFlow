import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { 
  X, 
  Loader2, 
  RefreshCw, 
  PieChart as PieChartIcon, 
  ArrowRight, 
  AlertCircle, 
  Trash2, 
  Archive, 
  FolderInput, 
  Bookmark, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  Filter, 
  CheckCircle,
  FolderPlus,
  Layers,
  Inbox,
  ShieldCheck,
  BellRing,
  AlertTriangle,
  ExternalLink
} from 'lucide-react';
import { 
  countEmails, 
  fetchGmailAPI, 
  processInChunks, 
  batchTrashEmails, 
  batchArchiveEmails, 
  batchModifyEmails, 
  createFilter,
  createLabel,
  EmailData
} from '../lib/gmail';
import { cn } from '../lib/utils';

export interface CategoryItem {
  id: string;
  name: string;
  query: string;
  filter: string;
  color: string;
  value: number;
  displayCount: string;
}

export const CATEGORY_CONFIG = [
  { id: 'updates', name: 'Updates', query: 'category:updates -in:trash -in:spam -in:sent', filter: 'category:updates', color: '#10B981', desc: 'System alerts, confirmations, receipts, bills, and notifications.' },
  { id: 'promotions', name: 'Promotions', query: 'category:promotions -in:trash -in:spam -in:sent', filter: 'category:promotions', color: '#F59E0B', desc: 'Marketing campaigns, store offers, discounts, and newsletters.' },
  { id: 'social', name: 'Social', query: 'category:social -in:trash -in:spam -in:sent', filter: 'category:social', color: '#0EA5E9', desc: 'Social network notifications, invitations, and activity updates.' },
  { id: 'forums', name: 'Forums', query: 'category:forums -in:trash -in:spam -in:sent', filter: 'category:forums', color: '#64748B', desc: 'Discussion boards, community groups, and mailing lists.' },
  { id: 'primary', name: 'Primary', query: 'category:primary -in:trash -in:spam -in:sent', filter: 'category:primary', color: '#3B82F6', desc: 'Direct emails, personal conversations, and important messages.' },
  { id: 'spam', name: 'Spam & Trash', query: 'in:spam OR in:trash', filter: 'anywhere', color: '#EF4444', desc: 'Junk and deleted messages waiting to be permanently removed.' },
];

export interface CategoryDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyCategory?: (query: string, filter?: string, sortOption?: "date" | "size" | "sender") => void;
  userLabels?: any[];
  aiSettings?: any;
  userEmail?: string;
  onRefresh?: () => void;
}

export interface AttentionItem {
  id: string;
  sender: string;
  subject: string;
  reason: string;
  urgencyLevel: 'high' | 'medium';
  tag: string;
  date?: string;
  snippet?: string;
}

export interface ActionBundle {
  id: string;
  title: string;
  actionType: 'trash' | 'archive' | 'move_to_label' | 'star_keep' | 'mark_read';
  suggestedLabel?: string;
  emailIds: string[];
  deselectedEmailIds?: string[];
  urgency: 'safe_to_delete' | 'safe_to_archive' | 'relocate_to_folder' | 'critical_keep';
  categoryTag: string;
  description: string;
  suggestFilterRule?: {
    senderQuery: string;
    description: string;
  };
}

export interface CategoryDiagnostic {
  headline: string;
  clutterPercentage: number;
  importantPercentage: number;
  relocatablePercentage: number;
  overview: string;
  practicalAdvice?: string;
}

export function CategoryDistributionModal({
  isOpen,
  onClose,
  onApplyCategory,
  userLabels = [],
  aiSettings,
  userEmail,
  onRefresh
}: CategoryDistributionModalProps) {
  // Navigation & View Mode
  const [activeTab, setActiveTab] = useState<'breakdown' | 'cleanup'>('breakdown');
  const [selectedCategory, setSelectedCategory] = useState<string>('updates');

  // Distribution Data
  const [data, setData] = useState<CategoryItem[]>([]);
  const [loadingDistribution, setLoadingDistribution] = useState(false);
  const [distributionError, setDistributionError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Category Cleanup State
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [categoryEmails, setCategoryEmails] = useState<EmailData[]>([]);
  const [diagnostic, setDiagnostic] = useState<CategoryDiagnostic | null>(null);
  const [actionBundles, setActionBundles] = useState<ActionBundle[]>([]);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [dismissedAttentionIds, setDismissedAttentionIds] = useState<Set<string>>(new Set());
  const [handledAttentionIds, setHandledAttentionIds] = useState<Set<string>>(new Set());
  const [handlingAttentionId, setHandlingAttentionId] = useState<string | null>(null);
  const [protectingAllAttention, setProtectingAllAttention] = useState(false);
  const [expandedBundleIds, setExpandedBundleIds] = useState<Set<string>>(new Set());

  // Execution & Progress State
  const [executingBundleId, setExecutingBundleId] = useState<string | null>(null);
  const [executingAll, setExecutingAll] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{ current: number; total: number; message: string }>({ current: 0, total: 0, message: '' });
  const [completedBundleIds, setCompletedBundleIds] = useState<Set<string>>(new Set());
  const [createdFilterIds, setCreatedFilterIds] = useState<Set<string>>(new Set());
  const [creatingFilterId, setCreatingFilterId] = useState<string | null>(null);
  const [totalCleanedInSession, setTotalCleanedInSession] = useState<number>(0);
  const [actionFilter, setActionFilter] = useState<'all' | 'trash' | 'move' | 'archive' | 'keep'>('all');

  // Fetch Category Distribution Overview
  const fetchCategoryData = useCallback(async () => {
    setLoadingDistribution(true);
    setDistributionError(null);
    try {
      const results: CategoryItem[] = await Promise.all(
        CATEGORY_CONFIG.map(async (cat) => {
          const rawCount = await countEmails(cat.query);
          const numValue =
            typeof rawCount === 'number'
              ? rawCount
              : parseInt(String(rawCount).replace(/[^0-9]/g, ''), 10) || 5000;
          return {
            id: cat.id,
            name: cat.name,
            query: cat.query,
            filter: cat.filter,
            color: cat.color,
            value: numValue,
            displayCount: typeof rawCount === 'number' ? rawCount.toLocaleString() : String(rawCount),
          };
        })
      );
      const total = results.reduce((acc, curr) => acc + curr.value, 0);
      setData(results);
      setTotalCount(total);
    } catch (err: any) {
      console.error('Failed to load category distribution:', err);
      setDistributionError(err?.message || 'Failed to load category counts.');
    } finally {
      setLoadingDistribution(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchCategoryData();
    }
  }, [isOpen, fetchCategoryData]);

  // Run Category Scan & Analysis
  const runCategoryAudit = useCallback(async (categoryId: string) => {
    const config = CATEGORY_CONFIG.find(c => c.id === categoryId) || CATEGORY_CONFIG[0];
    setSelectedCategory(categoryId);
    setActiveTab('cleanup');
    setScanLoading(true);
    setScanError(null);
    setCompletedBundleIds(new Set());
    setCreatedFilterIds(new Set());
    setExpandedBundleIds(new Set());
    setAttentionItems([]);
    setDismissedAttentionIds(new Set());
    setHandledAttentionIds(new Set());

    try {
      // 1. Fetch sample emails from this specific category (up to 100 threads)
      const listRes = await fetchGmailAPI(`/threads?q=${encodeURIComponent(config.query)}&maxResults=100`);
      if (!listRes || !listRes.threads || listRes.threads.length === 0) {
        setCategoryEmails([]);
        setDiagnostic({
          headline: `${config.name} is completely clear`,
          clutterPercentage: 0,
          importantPercentage: 100,
          relocatablePercentage: 0,
          overview: `There are no messages matching "${config.name}".`,
          practicalAdvice: `No cleanup needed for this category.`
        });
        setActionBundles([]);
        setAttentionItems([]);
        setScanLoading(false);
        return;
      }

      // 2. Fetch metadata details in efficient batches
      const sampledThreads = listRes.threads.slice(0, 100);
      const detailedEmails: EmailData[] = (await processInChunks(sampledThreads, 10, async (thread: any) => {
        try {
          const detail = await fetchGmailAPI(`/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`);
          if (!detail.messages || detail.messages.length === 0) return null;
          const firstMsg = detail.messages[0];
          const lastMsg = detail.messages[detail.messages.length - 1];
          const headers = firstMsg.payload?.headers || [];
          const lastHeaders = lastMsg.payload?.headers || headers;

          const sender = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
          const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
          const dateStr = lastHeaders.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

          return {
            id: thread.id,
            threadId: thread.id,
            snippet: lastMsg.snippet || thread.snippet || '',
            sender,
            subject,
            date: new Date(dateStr),
            labelIds: [...new Set(detail.messages.flatMap((m: any) => m.labelIds || []))] as string[],
            listUnsubscribe: detail.messages.flatMap((m: any) => m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'list-unsubscribe')?.value,
          } as EmailData;
        } catch {
          return null;
        }
      })).filter(Boolean) as EmailData[];

      setCategoryEmails(detailedEmails);

      if (detailedEmails.length === 0) {
        setDiagnostic({
          headline: `No Accessible Messages in ${config.name}`,
          clutterPercentage: 0,
          importantPercentage: 0,
          relocatablePercentage: 0,
          overview: `Could not retrieve message details for category ${config.name}.`,
          practicalAdvice: `Please check your network connection.`
        });
        setActionBundles([]);
        setAttentionItems([]);
        setScanLoading(false);
        return;
      }

      // 3. Check for AI API Key / Settings
      const hasAiKey = !!(aiSettings?.apiKey || sessionStorage.getItem('ai_quota_ok') !== 'false');
      let aiSucceeded = false;

      const catMeta = data.find(d => d.id === categoryId);
      const estTotal = catMeta ? catMeta.displayCount : detailedEmails.length;

      if (hasAiKey) {
        try {
          const payload = {
            categoryName: config.name,
            categoryQuery: config.query,
            estimatedTotal: estTotal,
            emails: detailedEmails.map(e => ({
              id: e.id,
              sender: e.sender,
              subject: e.subject,
              date: e.date.toISOString().split('T')[0],
              snippet: e.snippet
            })),
            userLabels: userLabels.map(l => ({ id: l.id, name: l.name })),
            settings: aiSettings
          };

          const res = await fetch('/api/analyze-category-cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (res.ok) {
            const result = await res.json();
            if (result && result.summary && result.actions && result.actions.length > 0) {
              setDiagnostic(result.summary);
              setActionBundles(result.actions);
              if (result.attentionEmails && Array.isArray(result.attentionEmails)) {
                setAttentionItems(result.attentionEmails);
              }
              aiSucceeded = true;
            }
          } else if (res.status === 429) {
            sessionStorage.setItem('ai_quota_ok', 'false');
          }
        } catch (aiErr) {
          console.warn("API Category Analysis failed, using local categorization:", aiErr);
        }
      }

      // 4. Fallback to Local Categorization if API is unavailable or failed
      if (!aiSucceeded) {
        const localResult = runLocalCategorization(detailedEmails, config.name, userLabels);
        setDiagnostic(localResult.summary);
        setActionBundles(localResult.actions);
        setAttentionItems(localResult.attentionItems);
      }

    } catch (err: any) {
      console.error('Failed to run category audit:', err);
      setScanError(err?.message || 'Failed to scan and analyze category.');
    } finally {
      setScanLoading(false);
    }
  }, [aiSettings, data, userLabels]);

  // Local Categorization Engine
  const runLocalCategorization = (
    emails: EmailData[], 
    categoryName: string, 
    folders: any[]
  ): { summary: CategoryDiagnostic; actions: ActionBundle[]; attentionItems: AttentionItem[] } => {
    const actions: ActionBundle[] = [];
    const availableFolderNames = (folders || []).map(f => f.name).filter(Boolean);

    const otpIds: string[] = [];
    const receiptIds: string[] = [];
    const buildAlertIds: string[] = [];
    const marketingIds: string[] = [];
    const importantIds: string[] = [];
    const localAttention: AttentionItem[] = [];
    const senderClusterMap = new Map<string, string[]>();

    emails.forEach(e => {
      const subject = (e.subject || '').toLowerCase();
      const sender = (e.sender || '').toLowerCase();
      const snippet = (e.snippet || '').toLowerCase();
      const text = `${subject} ${snippet}`;

      const senderMatch = sender.match(/<([^>]+)>/);
      const senderAddr = senderMatch ? senderMatch[1] : sender;
      if (!senderClusterMap.has(senderAddr)) senderClusterMap.set(senderAddr, []);
      senderClusterMap.get(senderAddr)!.push(e.id);

      // Autonomous Attention Item Spotter (Security, Payments, Travel, Direct Action, Renewals)
      if (
        subject.includes('security alert') || 
        text.includes('unauthorized') || 
        text.includes('suspicious activity') || 
        text.includes('password reset') || 
        text.includes('security code') || 
        text.includes('verify your account')
      ) {
        if (!localAttention.some(a => a.id === e.id)) {
          localAttention.push({
            id: e.id,
            sender: e.sender,
            subject: e.subject,
            reason: 'Security or authorization verification that may require confirmation.',
            urgencyLevel: 'high',
            tag: 'Security Alert',
            date: e.date ? e.date.toLocaleDateString() : undefined,
            snippet: e.snippet
          });
        }
      } else if (
        text.includes('payment due') || 
        text.includes('past due') || 
        text.includes('bill is due') || 
        text.includes('invoice due') || 
        text.includes('autopay failed') || 
        text.includes('payment required') || 
        text.includes('action required: payment')
      ) {
        if (!localAttention.some(a => a.id === e.id)) {
          localAttention.push({
            id: e.id,
            sender: e.sender,
            subject: e.subject,
            reason: 'Upcoming invoice or payment deadline requiring timely attention.',
            urgencyLevel: 'high',
            tag: 'Payment Due',
            date: e.date ? e.date.toLocaleDateString() : undefined,
            snippet: e.snippet
          });
        }
      } else if (
        text.includes('flight') || 
        text.includes('boarding pass') || 
        text.includes('check-in is open') || 
        text.includes('itinerary') || 
        text.includes('reservation confirmed') || 
        text.includes('hotel booking')
      ) {
        if (!localAttention.some(a => a.id === e.id)) {
          localAttention.push({
            id: e.id,
            sender: e.sender,
            subject: e.subject,
            reason: 'Travel booking or upcoming check-in notification.',
            urgencyLevel: 'medium',
            tag: 'Travel',
            date: e.date ? e.date.toLocaleDateString() : undefined,
            snippet: e.snippet
          });
        }
      } else if (
        text.includes('action required') || 
        text.includes('action needed') || 
        text.includes('time sensitive') || 
        text.includes('please confirm') || 
        text.includes('signature requested') || 
        text.includes('docusign') || 
        text.includes('response needed') || 
        text.includes('rsvp')
      ) {
        if (!localAttention.some(a => a.id === e.id)) {
          localAttention.push({
            id: e.id,
            sender: e.sender,
            subject: e.subject,
            reason: 'Direct action, confirmation, or signature requested.',
            urgencyLevel: 'high',
            tag: 'Action Required',
            date: e.date ? e.date.toLocaleDateString() : undefined,
            snippet: e.snippet
          });
        }
      } else if (
        text.includes('expiring soon') || 
        text.includes('subscription will renew') || 
        text.includes('auto-renew') || 
        text.includes('membership renewal') || 
        text.includes('expires on')
      ) {
        if (!localAttention.some(a => a.id === e.id)) {
          localAttention.push({
            id: e.id,
            sender: e.sender,
            subject: e.subject,
            reason: 'Upcoming subscription renewal or account expiration notice.',
            urgencyLevel: 'medium',
            tag: 'Renewal Notice',
            date: e.date ? e.date.toLocaleDateString() : undefined,
            snippet: e.snippet
          });
        }
      }

      // Critical / Keep
      if (
        subject.includes('tax') || 
        subject.includes('w-2') || 
        subject.includes('1099') || 
        subject.includes('flight') || 
        subject.includes('boarding pass') || 
        subject.includes('itinerary') || 
        subject.includes('reservation confirmed') || 
        subject.includes('court') || 
        subject.includes('legal notice') || 
        subject.includes('security alert') || 
        subject.includes('password changed')
      ) {
        importantIds.push(e.id);
      }
      // Verification OTPs
      else if (
        subject.includes('verification code') || 
        subject.includes('security code') || 
        subject.includes('one-time password') || 
        subject.includes('your otp') || 
        subject.includes('login code') || 
        subject.includes('confirm your email') ||
        subject.includes('action required: verify')
      ) {
        otpIds.push(e.id);
      }
      // Receipts / Invoices / Orders
      else if (
        subject.includes('receipt') || 
        subject.includes('invoice') || 
        subject.includes('order confirmation') || 
        subject.includes('payment received') || 
        subject.includes('statement is ready') || 
        subject.includes('subscription renewal') || 
        subject.includes('billed') || 
        subject.includes('your order from')
      ) {
        receiptIds.push(e.id);
      }
      // Build alerts / Dev logs
      else if (
        subject.includes('build failed') || 
        subject.includes('build succeeded') || 
        subject.includes('pipeline') || 
        subject.includes('deployment') || 
        subject.includes('cron job') || 
        subject.includes('github: [') || 
        subject.includes('jira: [') || 
        subject.includes('automated alert')
      ) {
        buildAlertIds.push(e.id);
      }
      // Newsletters & Promotions
      else if (
        e.listUnsubscribe || 
        subject.includes('% off') || 
        subject.includes('sale') || 
        subject.includes('deal') || 
        subject.includes('discount') || 
        subject.includes('newsletter') || 
        subject.includes('exclusive offer')
      ) {
        marketingIds.push(e.id);
      }
    });

    // 1. Expired login codes
    if (otpIds.length > 0) {
      actions.push({
        id: 'action_otp',
        title: `Trash ${otpIds.length} expired verification codes`,
        actionType: 'trash',
        emailIds: otpIds,
        urgency: 'safe_to_delete',
        categoryTag: 'Expired Codes',
        description: 'Single-use login codes and verification tokens that have already expired.'
      });
    }

    // 2. Receipts & orders
    if (receiptIds.length > 0) {
      const matchedFolder = availableFolderNames.find(f => {
        const lower = f.toLowerCase();
        return lower.includes('receipt') || lower.includes('finance') || lower.includes('invoice') || lower.includes('bill') || lower.includes('order');
      });

      actions.push({
        id: 'action_receipts',
        title: matchedFolder 
          ? `Move ${receiptIds.length} receipts to "${matchedFolder}"`
          : `Archive ${receiptIds.length} order confirmations and receipts`,
        actionType: matchedFolder ? 'move_to_label' : 'archive',
        suggestedLabel: matchedFolder || undefined,
        emailIds: receiptIds,
        urgency: matchedFolder ? 'relocate_to_folder' : 'safe_to_archive',
        categoryTag: 'Receipts',
        description: matchedFolder 
          ? `Move purchase records into your "${matchedFolder}" label so they stay organized.`
          : `Archive completed purchase confirmations so they stay searchable without crowding your inbox.`
      });
    }

    // 3. Automated build notifications
    if (buildAlertIds.length > 0) {
      actions.push({
        id: 'action_builds',
        title: `Archive ${buildAlertIds.length} build and status alerts`,
        actionType: 'archive',
        emailIds: buildAlertIds,
        urgency: 'safe_to_archive',
        categoryTag: 'Build Alerts',
        description: 'Automated CI/CD and deployment notifications that have already been resolved.'
      });
    }

    // 4. Senders with heavy email volume
    senderClusterMap.forEach((ids, senderEmail) => {
      if (ids.length >= 3 && !senderEmail.includes(userEmail || '')) {
        const senderName = senderEmail.split('@')[0];
        const isMarketing = marketingIds.some(id => ids.includes(id));
        actions.push({
          id: `action_cluster_${senderName.replace(/[^a-zA-Z0-9]/g, '_')}`,
          title: isMarketing 
            ? `Trash ${ids.length} promotional emails from ${senderEmail}`
            : `Archive ${ids.length} notifications from ${senderEmail}`,
          actionType: isMarketing ? 'trash' : 'archive',
          emailIds: ids,
          urgency: isMarketing ? 'safe_to_delete' : 'safe_to_archive',
          categoryTag: isMarketing ? 'Promotions' : 'Notifications',
          description: `Frequent automated updates from ${senderEmail}.`,
          suggestFilterRule: {
            senderQuery: `from:${senderEmail} category:${categoryName.toLowerCase()}`,
            description: `Auto-${isMarketing ? 'trash' : 'archive'} future emails from ${senderEmail}`
          }
        });
      }
    });

    // 5. Star important emails
    if (importantIds.length > 0) {
      actions.push({
        id: 'action_important',
        title: `Protect ${importantIds.length} travel and tax documents`,
        actionType: 'star_keep',
        emailIds: importantIds,
        urgency: 'critical_keep',
        categoryTag: 'Important',
        description: 'Flight itineraries, tax notices, and account security alerts.'
      });
    }

    // Fallback if empty
    if (actions.length === 0 && emails.length > 0) {
      const topBatch = emails.slice(0, Math.min(30, emails.length)).map(e => e.id);
      actions.push({
        id: 'action_general_archive',
        title: `Archive ${topBatch.length} older messages`,
        actionType: 'archive',
        emailIds: topBatch,
        urgency: 'safe_to_archive',
        categoryTag: 'General',
        description: `Stale notifications and updates in ${categoryName}.`
      });
    }

    const totalClutter = actions.filter(a => a.actionType === 'trash' || a.actionType === 'archive').reduce((acc, a) => acc + a.emailIds.length, 0);
    const totalRelocate = actions.filter(a => a.actionType === 'move_to_label').reduce((acc, a) => acc + a.emailIds.length, 0);
    const totalSampled = Math.max(emails.length, 1);

    const clutterPct = Math.min(100, Math.round((totalClutter / totalSampled) * 100));
    const relocPct = Math.min(100 - clutterPct, Math.round((totalRelocate / totalSampled) * 100));
    const impPct = Math.max(0, 100 - clutterPct - relocPct);

    return {
      summary: {
        headline: `${categoryName} Summary`,
        clutterPercentage: clutterPct,
        importantPercentage: impPct,
        relocatablePercentage: relocPct,
        overview: `Sampled ${emails.length} messages in "${categoryName}". Found ${actions.length} recommended cleanup actions and ${localAttention.length} attention items.`,
        practicalAdvice: categoryName.toLowerCase() === 'updates' 
          ? 'Most items in Updates are automated notifications, OTP codes, and order updates that can be safely archived once seen.'
          : categoryName.toLowerCase() === 'promotions'
          ? 'Promotional newsletters can be deleted or filtered in bulk to keep your inbox clean.'
          : 'Archive stale notifications to keep your search history intact without cluttering your daily view.'
      },
      actions: actions.slice(0, 6),
      attentionItems: localAttention.slice(0, 8)
    };
  };

  // Star & Protect Single Attention Item
  const handleStarAttention = async (item: AttentionItem) => {
    setHandlingAttentionId(item.id);
    try {
      await batchModifyEmails([item.id], ['STARRED', 'INBOX'], []);
      setHandledAttentionIds(prev => new Set(prev).add(item.id));
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error('Failed to star attention item:', err);
      alert(`Action failed: ${err.message || 'Error starring email'}`);
    } finally {
      setHandlingAttentionId(null);
    }
  };

  // Move Attention Item to Label / Action Items
  const handleLabelAttention = async (item: AttentionItem, labelName = 'Action Items') => {
    setHandlingAttentionId(item.id);
    try {
      let targetLabel = userLabels.find(l => l.name.toLowerCase() === labelName.toLowerCase());
      let labelId = targetLabel?.id;
      if (!labelId) {
        const created = await createLabel(labelName);
        if (created && created.id) labelId = created.id;
      }
      if (labelId) {
        await batchModifyEmails([item.id], [labelId, 'INBOX'], []);
      }
      setHandledAttentionIds(prev => new Set(prev).add(item.id));
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error('Failed to label attention item:', err);
      alert(`Action failed: ${err.message || 'Error labeling email'}`);
    } finally {
      setHandlingAttentionId(null);
    }
  };

  // Batch Protect All Spotted Attention Items
  const handleProtectAllAttention = async () => {
    const activeItems = attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id));
    if (activeItems.length === 0) return;

    setProtectingAllAttention(true);
    try {
      const ids = activeItems.map(i => i.id);
      await batchModifyEmails(ids, ['STARRED', 'INBOX'], []);
      setHandledAttentionIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.add(id));
        return next;
      });
      if (onRefresh) onRefresh();
    } catch (err: any) {
      console.error('Failed to protect attention items:', err);
      alert(`Batch protect failed: ${err.message || 'Error starring emails'}`);
    } finally {
      setProtectingAllAttention(false);
    }
  };

  // Toggle Email Selection inside an Action Bundle
  const toggleEmailInBundle = (bundleId: string, emailId: string) => {
    setActionBundles(prev => prev.map(bundle => {
      if (bundle.id !== bundleId) return bundle;
      const deselected = new Set(bundle.deselectedEmailIds || []);
      if (deselected.has(emailId)) {
        deselected.delete(emailId);
      } else {
        deselected.add(emailId);
      }
      return { ...bundle, deselectedEmailIds: Array.from(deselected) };
    }));
  };

  // Execute a Single Action Bundle
  const handleExecuteBundle = async (bundle: ActionBundle) => {
    const activeEmailIds = bundle.emailIds.filter(id => !(bundle.deselectedEmailIds || []).includes(id));
    if (activeEmailIds.length === 0) return;

    setExecutingBundleId(bundle.id);
    try {
      if (bundle.actionType === 'trash') {
        await batchTrashEmails(activeEmailIds);
      } else if (bundle.actionType === 'archive') {
        await batchArchiveEmails(activeEmailIds);
      } else if (bundle.actionType === 'move_to_label') {
        let labelId = userLabels.find(l => l.name.toLowerCase() === (bundle.suggestedLabel || '').toLowerCase())?.id;
        if (!labelId && bundle.suggestedLabel) {
          const newLabel = await createLabel(bundle.suggestedLabel);
          if (newLabel && newLabel.id) labelId = newLabel.id;
        }
        if (labelId) {
          await batchModifyEmails(activeEmailIds, [labelId], ['INBOX']);
        } else {
          await batchArchiveEmails(activeEmailIds);
        }
      } else if (bundle.actionType === 'star_keep') {
        await batchModifyEmails(activeEmailIds, ['STARRED'], []);
      } else if (bundle.actionType === 'mark_read') {
        await batchModifyEmails(activeEmailIds, [], ['UNREAD']);
      }

      setCompletedBundleIds(prev => new Set(prev).add(bundle.id));
      setTotalCleanedInSession(prev => prev + activeEmailIds.length);
      
      if (onRefresh) onRefresh();

    } catch (err: any) {
      console.error('Failed to execute action bundle:', err);
      alert(`Action failed: ${err.message || 'Error communicating with Gmail'}`);
    } finally {
      setExecutingBundleId(null);
    }
  };

  // Execute All Recommended Action Bundles
  const handleExecuteAll = async () => {
    const uncompletedBundles = actionBundles.filter(b => !completedBundleIds.has(b.id));
    if (uncompletedBundles.length === 0) return;

    setExecutingAll(true);
    let processedTotal = 0;

    try {
      for (let i = 0; i < uncompletedBundles.length; i++) {
        const bundle = uncompletedBundles[i];
        const activeEmailIds = bundle.emailIds.filter(id => !(bundle.deselectedEmailIds || []).includes(id));
        
        setExecutionProgress({
          current: i + 1,
          total: uncompletedBundles.length,
          message: `Applying "${bundle.title}" (${activeEmailIds.length} items)...`
        });

        if (activeEmailIds.length > 0) {
          if (bundle.actionType === 'trash') {
            await batchTrashEmails(activeEmailIds);
          } else if (bundle.actionType === 'archive') {
            await batchArchiveEmails(activeEmailIds);
          } else if (bundle.actionType === 'move_to_label') {
            let labelId = userLabels.find(l => l.name.toLowerCase() === (bundle.suggestedLabel || '').toLowerCase())?.id;
            if (!labelId && bundle.suggestedLabel) {
              const newLabel = await createLabel(bundle.suggestedLabel);
              if (newLabel && newLabel.id) labelId = newLabel.id;
            }
            if (labelId) {
              await batchModifyEmails(activeEmailIds, [labelId], ['INBOX']);
            } else {
              await batchArchiveEmails(activeEmailIds);
            }
          } else if (bundle.actionType === 'star_keep') {
            await batchModifyEmails(activeEmailIds, ['STARRED'], []);
          } else if (bundle.actionType === 'mark_read') {
            await batchModifyEmails(activeEmailIds, [], ['UNREAD']);
          }
          processedTotal += activeEmailIds.length;
        }

        setCompletedBundleIds(prev => new Set(prev).add(bundle.id));
        await new Promise(r => setTimeout(r, 150));
      }

      setTotalCleanedInSession(prev => prev + processedTotal);
      if (onRefresh) onRefresh();

    } catch (err: any) {
      console.error('Failed executing batch cleanup:', err);
      alert(`Batch execution error: ${err.message || 'Failed to complete all actions.'}`);
    } finally {
      setExecutingAll(false);
      setExecutionProgress({ current: 0, total: 0, message: '' });
    }
  };

  // Create Automated Filter Rule
  const handleCreateRule = async (bundle: ActionBundle) => {
    if (!bundle.suggestFilterRule) return;
    setCreatingFilterId(bundle.id);
    try {
      const { senderQuery } = bundle.suggestFilterRule;
      let addLabels: string[] = [];
      let removeLabels: string[] = ['INBOX'];

      if (bundle.actionType === 'move_to_label' && bundle.suggestedLabel) {
        const existing = userLabels.find(l => l.name.toLowerCase() === bundle.suggestedLabel!.toLowerCase());
        if (existing) addLabels.push(existing.id);
      } else if (bundle.actionType === 'trash') {
        addLabels.push('TRASH');
      }

      await createFilter(senderQuery, addLabels, removeLabels);
      setCreatedFilterIds(prev => new Set(prev).add(bundle.id));
    } catch (err: any) {
      console.error('Failed to create filter rule:', err);
      alert(`Failed to create rule: ${err.message || 'Error communicating with Gmail'}`);
    } finally {
      setCreatingFilterId(null);
    }
  };

  // Filtered Action Bundles
  const filteredBundles = useMemo(() => {
    if (actionFilter === 'all') return actionBundles;
    if (actionFilter === 'trash') return actionBundles.filter(b => b.actionType === 'trash');
    if (actionFilter === 'move') return actionBundles.filter(b => b.actionType === 'move_to_label');
    if (actionFilter === 'archive') return actionBundles.filter(b => b.actionType === 'archive');
    if (actionFilter === 'keep') return actionBundles.filter(b => b.actionType === 'star_keep');
    return actionBundles;
  }, [actionBundles, actionFilter]);

  // Keyboard navigation & body lock
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentCategoryConfig = CATEGORY_CONFIG.find(c => c.id === selectedCategory) || CATEGORY_CONFIG[0];
  const currentCategoryData = data.find(d => d.id === selectedCategory);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 lg:p-6 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-distribution-title"
    >
      <div
        className="bg-white w-full max-w-5xl shadow-xl flex flex-col overflow-hidden border border-slate-200 h-full sm:h-[90vh] sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap justify-between items-center bg-white shrink-0 gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 text-slate-700 rounded-lg shrink-0">
              <PieChartIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 id="category-distribution-title" className="font-semibold text-slate-900 text-base sm:text-lg">
                Category Breakdown
              </h2>
              <p className="text-xs text-slate-500">
                View volume across categories and review recommended cleanups.
              </p>
            </div>
          </div>

          {/* Tab Selector */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200/60">
              <button
                onClick={() => setActiveTab('breakdown')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
                  activeTab === 'breakdown'
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <PieChartIcon className="w-3.5 h-3.5" />
                <span>Overview</span>
              </button>

              <button
                onClick={() => {
                  setActiveTab('cleanup');
                  if (!diagnostic && !scanLoading) {
                    runCategoryAudit(selectedCategory);
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors",
                  activeTab === 'cleanup'
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Clean Up Category</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              title="Close modal"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6 flex flex-col">
          
          {/* TAB 1: OVERVIEW & DONUT BREAKDOWN */}
          {activeTab === 'breakdown' && (
            <div className="flex flex-col gap-5 max-w-4xl mx-auto w-full">
              {loadingDistribution ? (
                <div className="h-80 flex flex-col items-center justify-center gap-2 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-600" />
                  <p className="text-sm font-medium text-slate-700">Loading category counts...</p>
                </div>
              ) : distributionError ? (
                <div className="h-80 flex flex-col items-center justify-center gap-3 text-center p-4">
                  <div className="p-2.5 bg-red-50 text-red-600 rounded-full border border-red-100">
                    <AlertCircle className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-slate-800">{distributionError}</p>
                  <button
                    onClick={fetchCategoryData}
                    className="mt-1 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                </div>
              ) : data.length > 0 ? (
                <>
                  {/* Visual Donut Chart Card */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="w-full md:w-1/2 h-56 sm:h-64 flex items-center justify-center relative">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius="48%"
                            outerRadius="72%"
                            paddingAngle={3}
                            dataKey="value"
                            cursor="pointer"
                            onMouseEnter={(_, index) => setActiveIndex(index)}
                            onMouseLeave={() => setActiveIndex(null)}
                            onClick={(_, index) => {
                              if (data[index]) {
                                runCategoryAudit(data[index].id);
                              }
                            }}
                          >
                            {data.map((entry, index) => (
                              <Cell
                                key={`cell-${entry.id}`}
                                fill={entry.color}
                                opacity={activeIndex === null || activeIndex === index ? 1 : 0.65}
                                stroke="#ffffff"
                                strokeWidth={2}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            content={({ active, payload }) => {
                              if (active && payload && payload.length) {
                                const item = payload[0].payload as CategoryItem;
                                const percent =
                                  totalCount > 0
                                    ? ((item.value / totalCount) * 100).toFixed(1)
                                    : '0';
                                return (
                                  <div className="bg-slate-900 text-white px-3 py-2 rounded-lg shadow-lg border border-slate-800 text-xs flex flex-col gap-0.5 pointer-events-none">
                                    <div className="flex items-center gap-1.5 font-semibold">
                                      <span
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: item.color }}
                                      />
                                      <span>{item.name}</span>
                                    </div>
                                    <div className="text-slate-300 text-[11px]">
                                      {item.displayCount} emails ({percent}%)
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>

                      {/* Donut Center Display */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        {activeIndex !== null && data[activeIndex] ? (
                          <>
                            <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                              {data[activeIndex].displayCount}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              {data[activeIndex].name}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                              {totalCount.toLocaleString()}
                            </span>
                            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Total Emails
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Category Summary Description */}
                    <div className="w-full md:w-1/2 flex flex-col justify-center gap-3">
                      <h3 className="text-base sm:text-lg font-semibold text-slate-900">
                        Category Breakdown Summary
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                        Categories like <strong className="text-emerald-700 font-semibold">Updates</strong> and <strong className="text-amber-700 font-semibold">Promotions</strong> typically hold the largest volume of automated notifications and marketing messages.
                      </p>
                      <div className="pt-2 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => runCategoryAudit('updates')}
                          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors"
                        >
                          <span>Review Updates</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => runCategoryAudit('promotions')}
                          className="flex items-center gap-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors"
                        >
                          <span>Review Promotions</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Category Grid */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 ml-0.5">
                      All Categories
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {data.map((cat) => {
                        const percent = totalCount > 0 ? Math.round((cat.value / totalCount) * 100) : 0;
                        const config = CATEGORY_CONFIG.find(c => c.id === cat.id);

                        return (
                          <div
                            key={cat.id}
                            className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-4 shadow-xs transition-colors flex flex-col justify-between gap-3 group"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-3 h-3 rounded-full shrink-0"
                                  style={{ backgroundColor: cat.color }}
                                />
                                <h4 className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                                  {cat.name}
                                  <span className="text-xs font-normal text-slate-500">
                                    • {cat.displayCount} ({percent}%)
                                  </span>
                                </h4>
                              </div>

                              {onApplyCategory && (
                                <button
                                  onClick={() => {
                                    onClose();
                                    onApplyCategory(cat.query, cat.filter);
                                  }}
                                  className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
                                  title={`View emails in ${cat.name}`}
                                >
                                  <span>View</span>
                                  <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            <p className="text-xs text-slate-500 leading-relaxed">
                              {config?.desc || 'Category emails'}
                            </p>

                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                              <button
                                onClick={() => runCategoryAudit(cat.id)}
                                className="w-full flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                              >
                                <span>Clean Up {cat.name}</span>
                                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* TAB 2: CLEANUP RECOMMENDATIONS */}
          {activeTab === 'cleanup' && (
            <div className="flex flex-col gap-4 max-w-4xl mx-auto w-full">
              
              {/* Category Segment Selector */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                {CATEGORY_CONFIG.map(cat => {
                  const isSelected = selectedCategory === cat.id;
                  const catItem = data.find(d => d.id === cat.id);

                  return (
                    <button
                      key={cat.id}
                      onClick={() => runCategoryAudit(cat.id)}
                      disabled={scanLoading && isSelected}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 border",
                        isSelected
                          ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                      <span>{cat.name}</span>
                      {catItem && (
                        <span className={cn(
                          "text-[11px] px-1.5 py-0.2 rounded-full",
                          isSelected ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-500"
                        )}>
                          {catItem.displayCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Scanner Loader */}
              {scanLoading ? (
                <div className="bg-white border border-slate-200 rounded-xl p-12 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-slate-700" />
                  <div>
                    <h3 className="text-sm sm:text-base font-semibold text-slate-800">
                      Reviewing emails in "{currentCategoryConfig.name}"...
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Checking for expired login codes, receipts, and repetitive notifications.
                    </p>
                  </div>
                </div>
              ) : scanError ? (
                <div className="bg-white border border-red-200 rounded-xl p-8 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
                  <AlertCircle className="w-6 h-6 text-red-500" />
                  <p className="text-sm font-medium text-slate-800">{scanError}</p>
                  <button
                    onClick={() => runCategoryAudit(selectedCategory)}
                    className="mt-1 flex items-center gap-1.5 bg-slate-900 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg shadow-xs hover:bg-slate-800 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                </div>
              ) : diagnostic ? (
                <>
                  {/* Priority Review Card */}
                  {attentionItems.filter(i => !dismissedAttentionIds.has(i.id)).length > 0 && (
                    <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-200/90 rounded-xl p-4 sm:p-5 shadow-xs">
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-3.5">
                        <div className="flex items-center gap-3">
                          <div className="p-2.5 bg-amber-100 text-amber-800 rounded-lg shrink-0 shadow-2xs">
                            <AlertCircle className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-slate-900 text-sm sm:text-base">
                                Attention Required in {currentCategoryConfig.name} ({attentionItems.filter(i => !dismissedAttentionIds.has(i.id)).length})
                              </h4>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white text-slate-700 px-2 py-0.5 rounded-full border border-amber-200 shadow-2xs">
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Zero Data Spills • In-Memory Scanner</span>
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5">
                              Review urgent bills, security notices, flight itineraries, or actionable items detected in this category.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                          <button
                            onClick={handleProtectAllAttention}
                            disabled={protectingAllAttention || attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id)).length === 0}
                            className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                          >
                            {protectingAllAttention ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Bookmark className="w-3.5 h-3.5 fill-current" />
                            )}
                            <span>Protect All ({attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id)).length})</span>
                          </button>
                        </div>
                      </div>

                      {/* Attention Items Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {attentionItems.filter(i => !dismissedAttentionIds.has(i.id)).map(item => {
                          const isHandled = handledAttentionIds.has(item.id);
                          const isHandling = handlingAttentionId === item.id;

                          return (
                            <div
                              key={item.id}
                              className={cn(
                                "bg-white border rounded-xl p-3.5 shadow-2xs flex flex-col justify-between gap-3 transition-all",
                                isHandled ? "border-emerald-200 bg-emerald-50/30 opacity-70" : "border-amber-200/90 hover:border-amber-300"
                              )}
                            >
                              <div>
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                  <span className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded-md border",
                                    item.urgencyLevel === 'high'
                                      ? "bg-rose-50 text-rose-700 border-rose-200"
                                      : "bg-amber-50 text-amber-700 border-amber-200"
                                  )}>
                                    {item.tag || 'Action Required'}
                                  </span>
                                  {item.date && (
                                    <span className="text-[10px] text-slate-400">
                                      {item.date}
                                    </span>
                                  )}
                                </div>

                                <h5 className="font-semibold text-slate-900 text-xs sm:text-sm truncate">
                                  {item.subject || '(No Subject)'}
                                </h5>
                                <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                  {item.sender.replace(/<.*>/, '').trim() || item.sender}
                                </p>
                                <p className="text-xs text-amber-900 bg-amber-50/80 rounded-lg p-2 mt-2 font-medium border border-amber-100 leading-relaxed">
                                  💡 {item.reason}
                                </p>
                              </div>

                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                                {isHandled ? (
                                  <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Protected & Starred
                                  </span>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => handleStarAttention(item)}
                                        disabled={isHandling}
                                        className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white px-2.5 py-1 rounded-md text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50"
                                        title="Star and protect in inbox"
                                      >
                                        {isHandling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bookmark className="w-3 h-3 fill-current" />}
                                        <span>Protect</span>
                                      </button>
                                      <button
                                        onClick={() => handleLabelAttention(item, 'Action Items')}
                                        disabled={isHandling}
                                        className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
                                        title="Move to Action Items label"
                                      >
                                        <FolderInput className="w-3 h-3" />
                                        <span>Action Items</span>
                                      </button>
                                    </div>

                                    <button
                                      onClick={() => setDismissedAttentionIds(prev => new Set(prev).add(item.id))}
                                      className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                                      title="Dismiss"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Summary Card */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-slate-700">
                            {currentCategoryConfig.name} Category
                          </span>
                          <span className="text-xs text-slate-400">
                            (~{currentCategoryData?.displayCount || 'thousands'} emails)
                          </span>
                        </div>
                        <h3 className="text-base sm:text-lg font-semibold text-slate-900">
                          {diagnostic.headline}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed max-w-2xl">
                          {diagnostic.overview}
                        </p>
                        {diagnostic.practicalAdvice && (
                          <p className="text-xs text-slate-500 mt-1.5 italic">
                            {diagnostic.practicalAdvice}
                          </p>
                        )}
                      </div>

                      {/* Apply All Button */}
                      {actionBundles.length > 0 && (
                        <div className="shrink-0 flex flex-col items-start sm:items-end gap-1 w-full sm:w-auto">
                          <button
                            onClick={handleExecuteAll}
                            disabled={executingAll || completedBundleIds.size === actionBundles.length}
                            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50 disabled:pointer-events-none"
                          >
                            {executingAll ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Applying...</span>
                              </>
                            ) : completedBundleIds.size === actionBundles.length ? (
                              <>
                                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                                <span>All Done</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Apply All ({actionBundles.length})</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Multi-Color Ratio Bar */}
                    <div className="mt-4 pt-3.5 border-t border-slate-100">
                      <div className="flex items-center justify-between text-xs font-medium mb-1.5 text-slate-600">
                        <span>Category Breakdown</span>
                        <div className="flex items-center gap-3 text-[11px]">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-rose-500" />
                            Clutter ({diagnostic.clutterPercentage}%)
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-blue-600" />
                            Organize ({diagnostic.relocatablePercentage}%)
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            Keep ({diagnostic.importantPercentage}%)
                          </span>
                        </div>
                      </div>

                      <div className="w-full bg-slate-100 rounded-full h-2 flex overflow-hidden">
                        <div style={{ width: `${diagnostic.clutterPercentage}%` }} className="bg-rose-500 transition-all duration-300" />
                        <div style={{ width: `${diagnostic.relocatablePercentage}%` }} className="bg-blue-600 transition-all duration-300" />
                        <div style={{ width: `${diagnostic.importantPercentage}%` }} className="bg-emerald-500 transition-all duration-300" />
                      </div>
                    </div>
                  </div>

                  {/* Execution In-Progress Banner */}
                  {executingAll && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 shadow-xs flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5">
                        <Loader2 className="w-4 h-4 animate-spin text-emerald-600 shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-emerald-900">
                            Applying Cleanups ({executionProgress.current}/{executionProgress.total})
                          </p>
                          <p className="text-xs text-emerald-700">{executionProgress.message}</p>
                        </div>
                      </div>
                      <div className="w-24 bg-emerald-200 rounded-full h-1.5">
                        <div 
                          className="bg-emerald-600 h-1.5 rounded-full transition-all"
                          style={{ width: `${(executionProgress.current / Math.max(executionProgress.total, 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Session Impact Banner */}
                  {totalCleanedInSession > 0 && (
                    <div className="bg-white border border-emerald-200 rounded-lg p-3 shadow-xs flex items-center justify-between text-xs text-emerald-800">
                      <div className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>Cleaned up <strong>{totalCleanedInSession} messages</strong> in this session.</span>
                      </div>
                      <button
                        onClick={() => runCategoryAudit(selectedCategory)}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 underline flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Rescan
                      </button>
                    </div>
                  )}

                  {/* Action Recommendations Section */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-0.5">
                        Recommendations ({actionBundles.length})
                      </h3>

                      {/* Filter Action Types */}
                      <div className="flex items-center gap-1 bg-white border border-slate-200 p-0.5 rounded-lg text-xs">
                        <button
                          onClick={() => setActionFilter('all')}
                          className={cn("px-2 py-0.5 rounded font-medium transition-colors", actionFilter === 'all' ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50")}
                        >
                          All ({actionBundles.length})
                        </button>
                        <button
                          onClick={() => setActionFilter('trash')}
                          className={cn("px-2 py-0.5 rounded font-medium transition-colors", actionFilter === 'trash' ? "bg-rose-600 text-white" : "text-slate-600 hover:bg-slate-50")}
                        >
                          Trash
                        </button>
                        <button
                          onClick={() => setActionFilter('move')}
                          className={cn("px-2 py-0.5 rounded font-medium transition-colors", actionFilter === 'move' ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50")}
                        >
                          Move
                        </button>
                        <button
                          onClick={() => setActionFilter('archive')}
                          className={cn("px-2 py-0.5 rounded font-medium transition-colors", actionFilter === 'archive' ? "bg-slate-700 text-white" : "text-slate-600 hover:bg-slate-50")}
                        >
                          Archive
                        </button>
                      </div>
                    </div>

                    {filteredBundles.length === 0 ? (
                      <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500 text-xs font-medium">
                        No actions matching current filter.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredBundles.map((bundle) => {
                          const isCompleted = completedBundleIds.has(bundle.id);
                          const isExecuting = executingBundleId === bundle.id;
                          const isFilterCreated = createdFilterIds.has(bundle.id);
                          const isFilterCreating = creatingFilterId === bundle.id;
                          const isExpanded = expandedBundleIds.has(bundle.id);
                          const activeEmailCount = bundle.emailIds.length - (bundle.deselectedEmailIds?.length || 0);

                          const matchingEmails = categoryEmails.filter(e => bundle.emailIds.includes(e.id));

                          return (
                            <div
                              key={bundle.id}
                              className={cn(
                                "bg-white border rounded-xl p-4 shadow-xs flex flex-col justify-between transition-colors",
                                isCompleted
                                  ? "border-emerald-200 bg-emerald-50/20 opacity-80"
                                  : "border-slate-200 hover:border-slate-300"
                              )}
                            >
                              <div>
                                {/* Header Badge */}
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className={cn(
                                      "text-[10px] font-semibold px-2 py-0.5 rounded-md border",
                                      bundle.actionType === 'trash' ? "bg-rose-50 text-rose-700 border-rose-200" :
                                      bundle.actionType === 'move_to_label' ? "bg-blue-50 text-blue-700 border-blue-200" :
                                      bundle.actionType === 'star_keep' ? "bg-amber-50 text-amber-700 border-amber-200" :
                                      "bg-slate-100 text-slate-700 border-slate-200"
                                    )}>
                                      {bundle.categoryTag || 'General'}
                                    </span>

                                    <span className="text-[11px] font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                                      {activeEmailCount} emails
                                    </span>
                                  </div>

                                  {isCompleted && (
                                    <span className="flex items-center gap-1 text-emerald-600 text-xs font-semibold bg-emerald-50 px-2 py-0.5 rounded-md">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      Done
                                    </span>
                                  )}
                                </div>

                                {/* Title & Description */}
                                <h4 className="font-semibold text-slate-900 text-sm leading-snug">
                                  {bundle.title}
                                </h4>

                                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                                  {bundle.description}
                                </p>

                                {/* Expand/Collapse Email Preview */}
                                <div className="mt-2.5">
                                  <button
                                    onClick={() => {
                                      setExpandedBundleIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(bundle.id)) next.delete(bundle.id);
                                        else next.add(bundle.id);
                                        return next;
                                      });
                                    }}
                                    className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 transition-colors"
                                  >
                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    <span>{isExpanded ? "Hide sample list" : `Review ${matchingEmails.length} sample items`}</span>
                                  </button>

                                  {isExpanded && (
                                    <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-2 max-h-36 overflow-y-auto custom-scrollbar flex flex-col gap-1 text-xs">
                                      {matchingEmails.map(e => {
                                        const isChecked = !(bundle.deselectedEmailIds || []).includes(e.id);
                                        return (
                                          <div
                                            key={e.id}
                                            onClick={() => !isCompleted && toggleEmailInBundle(bundle.id, e.id)}
                                            className={cn(
                                              "flex items-start gap-2 p-1.5 rounded border transition-colors cursor-pointer",
                                              isChecked ? "bg-white border-slate-200 text-slate-800" : "bg-slate-100 border-transparent text-slate-400 line-through opacity-60"
                                            )}
                                          >
                                            <input
                                              type="checkbox"
                                              checked={isChecked}
                                              readOnly
                                              disabled={isCompleted}
                                              className="mt-0.5 rounded text-slate-900 border-slate-300 focus:ring-slate-500 pointer-events-none shrink-0"
                                            />
                                            <div className="min-w-0 flex-1">
                                              <p className="font-medium truncate text-xs">{e.sender.replace(/<.*>/, '').trim() || e.sender}</p>
                                              <p className="text-[11px] text-slate-500 truncate">{e.subject}</p>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="mt-3.5 pt-3 border-t border-slate-100 flex flex-col gap-1.5">
                                {!isCompleted ? (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => handleExecuteBundle(bundle)}
                                      disabled={isExecuting || activeEmailCount === 0}
                                      className={cn(
                                        "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50",
                                        bundle.actionType === 'trash'
                                          ? "bg-rose-600 hover:bg-rose-700 text-white"
                                          : bundle.actionType === 'move_to_label'
                                          ? "bg-blue-600 hover:bg-blue-700 text-white"
                                          : bundle.actionType === 'star_keep'
                                          ? "bg-amber-600 hover:bg-amber-700 text-white"
                                          : "bg-slate-800 hover:bg-slate-900 text-white"
                                      )}
                                    >
                                      {isExecuting ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : bundle.actionType === 'trash' ? (
                                        <Trash2 className="w-3.5 h-3.5" />
                                      ) : bundle.actionType === 'move_to_label' ? (
                                        <FolderInput className="w-3.5 h-3.5" />
                                      ) : bundle.actionType === 'star_keep' ? (
                                        <Bookmark className="w-3.5 h-3.5" />
                                      ) : (
                                        <Archive className="w-3.5 h-3.5" />
                                      )}
                                      <span>
                                        {bundle.actionType === 'trash'
                                          ? `Trash ${activeEmailCount} Emails`
                                          : bundle.actionType === 'move_to_label'
                                          ? `Move ${activeEmailCount} to ${bundle.suggestedLabel || 'Folder'}`
                                          : bundle.actionType === 'star_keep'
                                          ? `Protect (${activeEmailCount})`
                                          : `Archive ${activeEmailCount} Emails`}
                                      </span>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg border border-emerald-200">
                                    <span className="flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                      Completed
                                    </span>
                                    
                                    {bundle.suggestFilterRule && !isFilterCreated && (
                                      <button
                                        onClick={() => handleCreateRule(bundle)}
                                        disabled={isFilterCreating}
                                        className="flex items-center gap-1 bg-emerald-200 hover:bg-emerald-300 text-emerald-900 px-2 py-0.5 rounded text-[11px] font-semibold transition-colors disabled:opacity-50"
                                      >
                                        {isFilterCreating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Filter className="w-3 h-3" />}
                                        <span>Create Filter</span>
                                      </button>
                                    )}

                                    {isFilterCreated && (
                                      <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                                        Filter Created
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
