import { TypingLoader } from "./TypingLoader";
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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
  ExternalLink,
  Search,
  ArrowLeft
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
import { 
  tokenizeText, 
  buildTFIDFMatrix, 
  computeCosineSimilarity 
} from '../lib/emailUtils';

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
  isOpen?: boolean;
  onClose: () => void;
  onApplyCategory?: (query: string, filter?: string, sortOption?: "date" | "size" | "sender") => void;
  userLabels?: any[];
  aiSettings?: any;
  userEmail?: string;
  onRefresh?: () => void;
  isPage?: boolean;
  isWidget?: boolean;
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

// Density-Based Clustering (DBSCAN / TF-IDF Cosine Similarity) with adaptive threshold
function clusterByCosineSimilarity(emails: EmailData[], similarityThreshold = 0.70): any[] {
  if (emails.length < 2) return [];
  const docs = emails.map(e => tokenizeText(`${e.subject || ''} ${e.snippet || ''}`));
  const { vocab, vectors } = buildTFIDFMatrix(docs);
  if (vocab.length === 0) return [];

  const n = emails.length;
  const visited = new Set<number>();
  const clusters: { emailIndices: number[], topKeywords: string[] }[] = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;
    
    // Find neighbors with high cosine similarity
    const neighbors: number[] = [i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const sim = computeCosineSimilarity(vectors[i], vectors[j]);
      if (sim >= similarityThreshold) {
        neighbors.push(j);
      }
    }

    if (neighbors.length >= 2) {
      neighbors.forEach(idx => visited.add(idx));
      
      // Extract high-significance centroid keywords
      const clusterTermScores: Record<string, number> = {};
      neighbors.forEach(idx => {
        docs[idx].forEach(t => {
          clusterTermScores[t] = (clusterTermScores[t] || 0) + 1;
        });
      });

      const sortedTerms = Object.entries(clusterTermScores)
        .sort((a, b) => b[1] - a[1])
        .map(e => e[0].replace(/_/g, ' '))
        .slice(0, 3);
        
      clusters.push({
        emailIndices: neighbors,
        topKeywords: sortedTerms
      });
    }
  }

  return clusters.map(c => {
    const matchedEmails = c.emailIndices.map(idx => emails[idx]);
    const leadKeyword = c.topKeywords[0] ? c.topKeywords[0].charAt(0).toUpperCase() + c.topKeywords[0].slice(1) : 'Topic';
    const subKeyword = c.topKeywords[1] ? ` & ${c.topKeywords[1].charAt(0).toUpperCase() + c.topKeywords[1].slice(1)}` : '';
    const labelTitle = `${leadKeyword}${subKeyword}`;
    
    return {
      suggestedLabel: leadKeyword,
      title: `${labelTitle} Cluster`,
      categoryTag: 'Smart Group',
      emailIds: matchedEmails.map(e => e.id),
      reason: `TF-IDF statistical vector match across ${matchedEmails.length} correlated subject threads.`
    };
  });
}

export function CategoryDistributionModal({
  isOpen = true,
  onClose,
  onApplyCategory,
  userLabels = [],
  aiSettings,
  userEmail,
  onRefresh,
  isPage = false,
  isWidget = false
}: CategoryDistributionModalProps) {
  // Navigation & View Mode
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
  const [dismissedAttentionIds, setDismissedAttentionIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('mf_dismissed_attention');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [dismissedBundleIds, setDismissedBundleIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('mf_dismissed_bundles');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const handleDismissAttention = (id: string) => {
    setDismissedAttentionIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('mf_dismissed_attention', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const handleDismissBundle = (id: string) => {
    setDismissedBundleIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('mf_dismissed_bundles', JSON.stringify(Array.from(next)));
      return next;
    });
  };
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

  // Helper to ensure guaranteed unique keys for bundles
  const ensureUniqueActionIds = (list: ActionBundle[]): ActionBundle[] => {
    const seen = new Set<string>();
    return list.map((item, idx) => {
      let baseId = item.id || `action_${idx}`;
      let uniqueId = baseId;
      let counter = 1;
      while (seen.has(uniqueId)) {
        uniqueId = `${baseId}_${counter++}`;
      }
      seen.add(uniqueId);
      return { ...item, id: uniqueId };
    });
  };

  // Helper to ensure guaranteed unique keys for attention items
  const ensureUniqueAttentionIds = (list: AttentionItem[]): AttentionItem[] => {
    const seen = new Set<string>();
    return list.map((item, idx) => {
      let baseId = item.id || `attention_${idx}`;
      let uniqueId = baseId;
      let counter = 1;
      while (seen.has(uniqueId)) {
        uniqueId = `${baseId}_${counter++}`;
      }
      seen.add(uniqueId);
      return { ...item, id: uniqueId };
    });
  };

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
    setScanLoading(true);
    setScanError(null);
    setCompletedBundleIds(new Set());
    setCreatedFilterIds(new Set());
    setExpandedBundleIds(new Set());
    setAttentionItems([]);
    
    setHandledAttentionIds(new Set());

    // Scroll to the cleanup section if it exists
    setTimeout(() => {
      const el = document.getElementById('cleanup-recommendations');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);

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
              setActionBundles(ensureUniqueActionIds(result.actions));
              if (result.attentionEmails && Array.isArray(result.attentionEmails)) {
                setAttentionItems(ensureUniqueAttentionIds(result.attentionEmails));
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
        setActionBundles(ensureUniqueActionIds(localResult.actions));
        setAttentionItems(ensureUniqueAttentionIds(localResult.attentionItems));
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
    
    // New Smart Categories
    const coldEmailIds: string[] = [];
    const shippingIds: string[] = [];
    const calendarIds: string[] = [];

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

      // --- 1. Attention Items (Security, Payments, Travel, Direct Action, Renewals) ---
      if (
        subject.includes('security alert') || 
        text.includes('unauthorized') || 
        text.includes('suspicious activity') || 
        text.includes('password reset') || 
        text.includes('security code') || 
        text.includes('verify your account')
      ) {
        if (!localAttention.some(a => a.id === e.id)) {
          localAttention.push({ id: e.id, sender: e.sender, subject: e.subject, reason: 'Security or authorization verification that may require confirmation.', urgencyLevel: 'high', tag: 'Security Alert', date: e.date ? e.date.toLocaleDateString() : undefined, snippet: e.snippet });
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
          localAttention.push({ id: e.id, sender: e.sender, subject: e.subject, reason: 'Upcoming invoice or payment deadline requiring timely attention.', urgencyLevel: 'high', tag: 'Payment Due', date: e.date ? e.date.toLocaleDateString() : undefined, snippet: e.snippet });
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
          localAttention.push({ id: e.id, sender: e.sender, subject: e.subject, reason: 'Travel booking or upcoming check-in notification.', urgencyLevel: 'medium', tag: 'Travel', date: e.date ? e.date.toLocaleDateString() : undefined, snippet: e.snippet });
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
          localAttention.push({ id: e.id, sender: e.sender, subject: e.subject, reason: 'Direct action, confirmation, or signature requested.', urgencyLevel: 'high', tag: 'Action Required', date: e.date ? e.date.toLocaleDateString() : undefined, snippet: e.snippet });
        }
      } else if (
        text.includes('expiring soon') || 
        text.includes('subscription will renew') || 
        text.includes('auto-renew') || 
        text.includes('membership renewal') || 
        text.includes('expires on')
      ) {
        if (!localAttention.some(a => a.id === e.id)) {
          localAttention.push({ id: e.id, sender: e.sender, subject: e.subject, reason: 'Upcoming subscription renewal or account expiration notice.', urgencyLevel: 'medium', tag: 'Renewal', date: e.date ? e.date.toLocaleDateString() : undefined, snippet: e.snippet });
        }
      }

      // --- 2. Action Bundles Classification ---
      
      // Expired OTPs
      if (
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
      // Calendar Invites
      else if (
        subject.startsWith('invitation:') ||
        subject.startsWith('accepted:') ||
        subject.startsWith('declined:') ||
        subject.startsWith('tentative:') ||
        subject.startsWith('canceled event:') ||
        subject.startsWith('updated invitation:')
      ) {
        calendarIds.push(e.id);
      }
      // Shipping Updates
      else if (
        subject.includes('shipped') ||
        subject.includes('out for delivery') ||
        subject.includes('has been delivered') ||
        subject.includes('package arriving') ||
        subject.includes('shipment') ||
        subject.includes('tracking number')
      ) {
        shippingIds.push(e.id);
      }
      // Cold Emails / Pitches
      else if (
        text.includes('quick question') ||
        text.includes('15 minutes') ||
        text.includes('following up on my last') ||
        text.includes('hoping to connect') ||
        text.includes('touch base') ||
        text.includes('just circling back') ||
        text.includes('wanted to bump this')
      ) {
        coldEmailIds.push(e.id);
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

    // --- 3. Build Action Bundles ---

    // 1. Expired login codes
    if (otpIds.length > 0) {
      actions.push({ id: 'action_otp', title: `Trash ${otpIds.length} expired verification codes`, actionType: 'trash', emailIds: otpIds, urgency: 'safe_to_delete', categoryTag: 'Expired Codes', description: 'Single-use login codes and verification tokens that have already expired.' });
    }

    // 2. Receipts & orders
    if (receiptIds.length > 0) {
      const matchedFolder = availableFolderNames.find(f => {
        const lower = f.toLowerCase();
        return lower.includes('receipt') || lower.includes('finance') || lower.includes('invoice') || lower.includes('bill') || lower.includes('order');
      });
      actions.push({
        id: 'action_receipts',
        title: matchedFolder ? `Move ${receiptIds.length} receipts to "${matchedFolder}"` : `Archive ${receiptIds.length} order confirmations and receipts`,
        actionType: matchedFolder ? 'move_to_label' : 'archive',
        suggestedLabel: matchedFolder || undefined,
        emailIds: receiptIds,
        urgency: matchedFolder ? 'relocate_to_folder' : 'safe_to_archive',
        categoryTag: 'Receipts',
        description: matchedFolder ? `Move purchase records into your "${matchedFolder}" label so they stay organized.` : `Archive completed purchase confirmations so they stay searchable without crowding your inbox.`
      });
    }

    // 3. Shipping Updates
    if (shippingIds.length > 0) {
      actions.push({ id: 'action_shipping', title: `Archive ${shippingIds.length} shipping and delivery updates`, actionType: 'archive', emailIds: shippingIds, urgency: 'safe_to_archive', categoryTag: 'Shipping', description: 'Package tracking and delivery confirmations for completed orders.' });
    }

    // 4. Calendar Invites
    if (calendarIds.length > 0) {
      actions.push({ id: 'action_calendar', title: `Trash ${calendarIds.length} processed calendar invites`, actionType: 'trash', emailIds: calendarIds, urgency: 'safe_to_delete', categoryTag: 'Calendar', description: 'Past meeting invitations, acceptances, and declines that clutter the inbox.' });
    }

    // 5. Cold Emails
    if (coldEmailIds.length > 0) {
      actions.push({ id: 'action_cold', title: `Trash ${coldEmailIds.length} unsolicited cold emails`, actionType: 'trash', emailIds: coldEmailIds, urgency: 'safe_to_delete', categoryTag: 'Cold Outreach', description: 'Sales pitches, follow-ups, and cold outreach emails that require no action.' });
    }

    // 6. Automated build notifications
    if (buildAlertIds.length > 0) {
      actions.push({ id: 'action_builds', title: `Archive ${buildAlertIds.length} build and status alerts`, actionType: 'archive', emailIds: buildAlertIds, urgency: 'safe_to_archive', categoryTag: 'Build Alerts', description: 'Automated CI/CD and deployment notifications that have already been resolved.' });
    }

    // 7. Senders with heavy email volume
    senderClusterMap.forEach((ids, senderEmail) => {
      if (ids.length >= 3 && !senderEmail.includes(userEmail || '')) {
        const isMarketing = marketingIds.some(id => ids.includes(id));
        actions.push({
          id: `action_cluster_${senderEmail.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_')}`,
          title: isMarketing ? `Trash ${ids.length} promotional emails from ${senderEmail}` : `Archive ${ids.length} notifications from ${senderEmail}`,
          actionType: isMarketing ? 'trash' : 'archive',
          emailIds: ids,
          urgency: isMarketing ? 'safe_to_delete' : 'safe_to_archive',
          categoryTag: isMarketing ? 'Promotions' : 'Notifications',
          description: `Frequent automated updates from ${senderEmail}.`,
          suggestFilterRule: { senderQuery: `from:${senderEmail} category:${categoryName.toLowerCase()}`, description: `Auto-${isMarketing ? 'trash' : 'archive'} future emails from ${senderEmail}` }
        });
      }
    });

    // 8. Algorithmic ML models (TF-IDF Cosine Similarity) for unclustered emails
    const clusteredEmailIds = new Set<string>();
    actions.forEach(a => a.emailIds.forEach(id => clusteredEmailIds.add(id)));
    const unclusteredEmails = emails.filter(e => !clusteredEmailIds.has(e.id));
    
    if (unclusteredEmails.length >= 4) {
      const nlpClusters = clusterByCosineSimilarity(unclusteredEmails, 0.72);
      nlpClusters.forEach((nlpRec, idx) => {
        if (nlpRec.emailIds.length >= 2) {
          actions.push({ id: `action_nlp_${idx}`, title: `Archive ${nlpRec.emailIds.length} related emails about "${nlpRec.suggestedLabel || 'Topic'}"`, actionType: 'archive', emailIds: nlpRec.emailIds, urgency: 'safe_to_archive', categoryTag: nlpRec.categoryTag || 'Topic Cluster', description: nlpRec.reason || 'Semantic cluster found via machine learning.' });
        }
      });
    }

    // 9. Star important emails
    if (importantIds.length > 0) {
      actions.push({ id: 'action_important', title: `Protect ${importantIds.length} travel and tax documents`, actionType: 'star_keep', emailIds: importantIds, urgency: 'critical_keep', categoryTag: 'Important', description: 'Flight itineraries, tax notices, and account security alerts.' });
    }

    // Fallback if empty
    if (actions.length === 0 && emails.length > 0) {
      const topBatch = emails.slice(0, Math.min(30, emails.length)).map(e => e.id);
      actions.push({ id: 'action_general_archive', title: `Archive ${topBatch.length} older messages`, actionType: 'archive', emailIds: topBatch, urgency: 'safe_to_archive', categoryTag: 'General', description: `Stale notifications and updates in ${categoryName}.` });
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
  const handleExecuteBundle = async (bundle: ActionBundle, overrideAction?: ActionBundle['actionType']) => {
    const activeEmailIds = bundle.emailIds.filter(id => !(bundle.deselectedEmailIds || []).includes(id));
    if (activeEmailIds.length === 0) return;

    const actionToTake = overrideAction || bundle.actionType;
    setExecutingBundleId(bundle.id);
    try {
      if (actionToTake === 'trash') {
        await batchTrashEmails(activeEmailIds);
      } else if (actionToTake === 'archive') {
        await batchArchiveEmails(activeEmailIds);
      } else if (actionToTake === 'move_to_label') {
        let labelId = userLabels?.find((l:any) => l.name.toLowerCase() === (bundle.suggestedLabel || '').toLowerCase())?.id;
        if (!labelId && bundle.suggestedLabel) {
          const newLabel = await createLabel(bundle.suggestedLabel);
          if (newLabel && newLabel.id) labelId = newLabel.id;
        }
        if (labelId) {
          await batchModifyEmails(activeEmailIds, [labelId], ['INBOX']);
        } else {
          await batchArchiveEmails(activeEmailIds);
        }
      } else if (actionToTake === 'star_keep') {
        await batchModifyEmails(activeEmailIds, ['STARRED'], []);
      } else if (actionToTake === 'mark_read') {
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
    const visible = actionBundles.filter(b => !dismissedBundleIds.has(b.id));
    if (actionFilter === 'all') return visible;
    if (actionFilter === 'trash') return visible.filter(b => b.actionType === 'trash');
    if (actionFilter === 'move') return visible.filter(b => b.actionType === 'move_to_label');
    if (actionFilter === 'archive') return visible.filter(b => b.actionType === 'archive');
    if (actionFilter === 'keep') return visible.filter(b => b.actionType === 'star_keep');
    return visible;
  }, [actionBundles, actionFilter, dismissedBundleIds]);

  // Keyboard navigation & body lock
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    
    let originalOverflow = '';
    if (!isPage && !isWidget) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (!isPage && !isWidget) document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose, isPage, isWidget]);

  if (!isPage && !isOpen) return null;

  const currentCategoryConfig = CATEGORY_CONFIG.find(c => c.id === selectedCategory) || CATEGORY_CONFIG[0];
  const currentCategoryData = data.find(d => d.id === selectedCategory);

  const headerContent = (
    <div className={cn(
      "flex flex-col sm:flex-row sm:items-center justify-between bg-white shrink-0 gap-4",
      isPage ? "p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs mb-4" : "px-5 py-4 border-b border-slate-200"
    )}>
      <div className="flex items-center gap-3">
        {isPage && (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shrink-0"
            title="Back to Inbox Health"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h2 id="category-distribution-title" className="font-bold text-slate-900 text-base sm:text-lg">
              Category Breakdown
            </h2>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              Overview
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            View volume across categories and review recommended cleanups.
          </p>
        </div>
      </div>

      {/* Tab Selector Removed - unified layout */}
      <div className="flex items-center gap-2">
        {!isPage && (
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="Close modal"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );

  const bodyContent = (
    <div className="flex flex-col gap-6 w-full pb-10">
      {/* Top Bento Grid: Donut + Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 w-full">
        
        {/* Left: Donut Chart */}
        <div className="col-span-1 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col items-center justify-center">
          <h3 className="w-full text-sm font-bold text-slate-900 mb-6 text-center">Volume Distribution</h3>
          {loadingDistribution ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400 mb-2" />
              <span className="text-xs text-slate-500">Analyzing...</span>
            </div>
          ) : distributionError ? (
             <div className="flex-1 flex items-center justify-center min-h-[200px] text-center text-xs text-red-500">
               {distributionError}
             </div>
          ) : data.length > 0 ? (
            <div className="w-full aspect-square relative flex items-center justify-center max-w-[220px] mx-auto mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius="65%"
                    outerRadius="85%"
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                    onMouseEnter={(_, index) => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onClick={(_, index) => {
                      if (data[index]) runCategoryAudit(data[index].id);
                    }}
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${entry.id}`} fill={entry.color} opacity={activeIndex === null || activeIndex === index ? 1 : 0.4} className="cursor-pointer" />
                    ))}
                  </Pie>
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        const percent = totalCount > 0 ? ((item.value / totalCount) * 100).toFixed(1) : '0';
                        return (
                          <div className="bg-slate-900 text-white px-3 py-2 rounded-lg shadow-lg border border-slate-800 text-xs flex flex-col gap-0.5 pointer-events-none">
                            <div className="flex items-center gap-1.5 font-semibold">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                              <span>{item.name}</span>
                            </div>
                            <div className="text-slate-300 text-[11px]">{item.displayCount} emails ({percent}%)</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {activeIndex !== null && data[activeIndex] ? (
                  <>
                    <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{data[activeIndex].displayCount}</span>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{data[activeIndex].name}</span>
                  </>
                ) : (
                  <>
                    <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{totalCount.toLocaleString()}</span>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total</span>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: Categories List */}
        <div className="col-span-1 lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">Category Scanner</h3>
              <p className="text-xs text-slate-500 mt-0.5">Select a category to audit unneeded emails.</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[350px] custom-scrollbar">
            {data.map(cat => {
              const isSelected = selectedCategory === cat.id;
              const percent = totalCount > 0 ? Math.round((cat.value / totalCount) * 100) : 0;
              return (
                <div 
                  key={cat.id} 
                  className={cn(
                    "p-3 sm:p-4 border-b border-slate-100 last:border-0 flex items-center justify-between gap-4 cursor-pointer transition-colors group", 
                    isSelected ? "bg-indigo-50/50" : "hover:bg-slate-50"
                  )} 
                  onClick={() => runCategoryAudit(cat.id)}
                >
                   <div className="flex items-center gap-3">
                     <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: cat.color }} />
                     <div>
                       <h4 className={cn("font-semibold text-sm transition-colors", isSelected ? "text-indigo-900" : "text-slate-900")}>{cat.name}</h4>
                       <p className="text-xs text-slate-500">{cat.displayCount} emails ({percent}%)</p>
                     </div>
                   </div>
                   <div className="flex items-center gap-2 shrink-0">
                     {onApplyCategory && (
                       <button 
                         onClick={(e) => { e.stopPropagation(); onClose(); onApplyCategory(cat.query, cat.filter); }} 
                         className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors" 
                         title={`View emails in ${cat.name}`}
                       >
                         <Search className="w-4 h-4" />
                       </button>
                     )}
                     <button className={cn(
                       "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs", 
                       isSelected ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-700 group-hover:border-slate-300"
                     )}>
                       {scanLoading && isSelected ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Scan</span>}
                     </button>
                   </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Bottom: Scanner Results */}
      <div id="cleanup-recommendations" className="w-full mt-2">
         {scanLoading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
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
            <div className="bg-white border border-red-200 rounded-2xl p-8 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
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
            <div className="flex flex-col gap-6">
              {/* Priority Review Card */}
              {attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id)).length > 0 && (
                <div className="bg-white border border-amber-200 rounded-2xl p-4 sm:p-5 shadow-xs">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl shrink-0 shadow-2xs">
                        <AlertCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-slate-900 text-sm sm:text-base">
                            Attention Required in {currentCategoryConfig.name} ({attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id)).length})
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
                        type="button"
                        onClick={(e) => { e.preventDefault(); handleProtectAllAttention(); }}
                        disabled={protectingAllAttention || attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id)).length === 0}
                        className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
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
                    {attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id)).map(item => {
                      const isHandled = handledAttentionIds.has(item.id);
                      const isHandling = handlingAttentionId === item.id;

                      return (
                        <div key={item.id} className="bg-white border border-amber-200/60 rounded-xl p-3.5 sm:p-4 flex flex-col justify-between shadow-xs relative overflow-hidden group">
                          {isHandled && (
                            <div className="absolute inset-0 bg-white/80 backdrop-blur-xs flex items-center justify-center z-10">
                              <span className="flex items-center gap-1.5 text-emerald-700 font-semibold text-sm bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 shadow-xs">
                                <CheckCircle className="w-4 h-4" />
                                Protected
                              </span>
                            </div>
                          )}

                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                                  {item.tag}
                                </span>
                                {item.date && (
                                  <span className="text-[10px] text-slate-500 font-medium">{item.date}</span>
                                )}
                              </div>
                              <h4 className="font-semibold text-slate-900 text-sm truncate" title={item.subject}>{item.subject}</h4>
                              <p className="text-xs text-slate-500 truncate" title={item.sender}>{item.sender}</p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); handleDismissAttention(item.id); }}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors shrink-0"
                              title="Dismiss"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          
                          <p className="text-[11px] text-slate-600 bg-amber-50/50 p-2 rounded-lg border border-amber-100/50 mb-3">
                            {item.reason}
                          </p>
                          
                          <div className="flex items-center gap-2 mt-auto">
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); handleStarAttention(item); }}
                              disabled={isHandling}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                            >
                              {isHandling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bookmark className="w-3 h-3" />}
                              <span>Protect</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); handleLabelAttention(item, 'Action Items'); }}
                              disabled={isHandling}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                            >
                              {isHandling ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
                              <span>To Action</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action Bundles Card */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl shadow-2xs">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-slate-900 text-base">Suggested Cleanups</h4>
                        <span className="text-[11px] font-semibold bg-white text-slate-700 px-2 py-0.5 rounded-full border border-slate-200 shadow-2xs">
                          {actionBundles.length} Bundles Found
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Bulk actions recommended for {currentCategoryConfig.name}.
                      </p>
                    </div>
                  </div>

                  {actionBundles.filter(b => !completedBundleIds.has(b.id)).length > 0 && (
                    <button
                      onClick={handleExecuteAll}
                      disabled={executingAll}
                      className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                    >
                      {executingAll ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Executing...</span>
                        </>
                      ) : (
                        <>
                          <span>Apply All Pending</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  )}
                </div>
                
                {/* Filters */}
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 overflow-x-auto custom-scrollbar">
                  {[
                    { id: 'all', label: 'All Actions' },
                    { id: 'trash', label: 'Trash' },
                    { id: 'archive', label: 'Archive' },
                    { id: 'move', label: 'Move' }
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setActionFilter(f.id as any)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap",
                        actionFilter === f.id
                          ? "bg-slate-800 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Bundle Grid */}
                <div className="p-4 sm:p-5 bg-slate-50/50">
                  {filteredBundles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-3">
                        <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                      </div>
                      <h4 className="font-semibold text-slate-900 text-sm">No pending cleanups</h4>
                      <p className="text-xs text-slate-500 mt-1">This category is well-maintained.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredBundles.map(bundle => {
                        const isCompleted = completedBundleIds.has(bundle.id);
                        const isExecuting = executingBundleId === bundle.id;
                        const isFilterCreated = createdFilterIds.has(bundle.id);
                        const isFilterCreating = creatingFilterId === bundle.id;
                        const activeEmailCount = bundle.emailIds.length - (bundle.deselectedEmailIds?.length || 0);

                        return (
                          <div key={bundle.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between shadow-xs transition-all hover:shadow-md hover:border-slate-300 relative group">
                            {!isCompleted && !isExecuting && (
                              <button
                                onClick={() => handleDismissBundle(bundle.id)}
                                className="absolute top-3 right-3 p-1 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                                title="Dismiss suggestion"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-3">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    "p-1.5 rounded-lg border",
                                    bundle.actionType === 'trash' ? "bg-rose-50 border-rose-100 text-rose-600" :
                                    bundle.actionType === 'archive' ? "bg-slate-100 border-slate-200 text-slate-700" :
                                    bundle.actionType === 'move_to_label' ? "bg-blue-50 border-blue-100 text-blue-600" :
                                    "bg-amber-50 border-amber-100 text-amber-600"
                                  )}>
                                    {bundle.actionType === 'trash' ? <Trash2 className="w-4 h-4" /> :
                                     bundle.actionType === 'move_to_label' ? <FolderInput className="w-4 h-4" /> :
                                     bundle.actionType === 'star_keep' ? <Bookmark className="w-4 h-4" /> :
                                     <Archive className="w-4 h-4" />}
                                  </span>
                                  <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
                                    {bundle.categoryTag}
                                  </span>
                                </div>
                                {isCompleted ? (
                                  <span className="flex items-center gap-1 text-emerald-600 text-xs font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                    <CheckCircle2 className="w-3 h-3" /> Done
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200 pr-5 group-hover:pr-2 transition-all">
                                    {activeEmailCount} items
                                  </span>
                                )}
                              </div>
                              <h4 className="font-bold text-slate-900 text-sm leading-snug pr-4">{bundle.title}</h4>
                              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed line-clamp-2">{bundle.description}</p>
                            </div>
                            
                            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-2">
                              {!isCompleted && (
                                <div className="flex flex-col w-full">
                                  <button
                                    type="button"
                                    onClick={(e) => { 
                                      e.preventDefault(); 
                                      setExpandedBundleIds(prev => { 
                                        const next = new Set(prev); 
                                        if (next.has(bundle.id)) next.delete(bundle.id); 
                                        else next.add(bundle.id); 
                                        return next; 
                                      });
                                    }}
                                    className="self-start flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors mb-1"
                                  >
                                    {expandedBundleIds.has(bundle.id) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                    <span>{expandedBundleIds.has(bundle.id) ? 'Hide emails' : `Review ${activeEmailCount} emails`}</span>
                                  </button>
                                  
                                  <AnimatePresence>
                                    {expandedBundleIds.has(bundle.id) && (
                                      <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden w-full"
                                      >
                                        <div className="flex flex-col gap-1 mt-1 mb-2 max-h-40 overflow-y-auto custom-scrollbar pr-1 border border-slate-100 rounded-lg bg-slate-50/50 p-1">
                                          {bundle.emailIds.map(id => {
                                            const email = categoryEmails.find(e => e.id === id);
                                            if (!email) return null;
                                            const isDeselected = (bundle.deselectedEmailIds || []).includes(id);
                                            return (
                                              <div key={id} className={cn("flex items-start gap-2 p-1.5 rounded-md group transition-colors", isDeselected ? "opacity-50" : "bg-white border border-slate-100 shadow-2xs hover:border-slate-200")}>
                                                <button
                                                  type="button"
                                                  onClick={(e) => { e.preventDefault(); toggleEmailInBundle(bundle.id, id); }}
                                                  className="mt-0.5 shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
                                                >
                                                  {isDeselected ? <div className="w-3.5 h-3.5 rounded border border-slate-300" /> : <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />}
                                                </button>
                                                <div className="flex-1 min-w-0">
                                                  <p className={cn("text-[11px] font-medium truncate", isDeselected ? "text-slate-500 line-through" : "text-slate-700")}>{email.subject || '(No Subject)'}</p>
                                                  <p className="text-[10px] text-slate-500 truncate">{email.sender}</p>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              )}
                              {!isCompleted ? (
                                isExecuting ? (
                                  <div className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-500">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1.5 w-full">
                                    {bundle.actionType === 'star_keep' ? (
                                      <button 
                                        type="button"
                                        onClick={(e) => { e.preventDefault(); handleExecuteBundle(bundle, 'star_keep'); }} 
                                        disabled={activeEmailCount === 0}
                                        className="flex-1 flex items-center justify-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 px-2 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                                      >
                                        <Bookmark className="w-3.5 h-3.5" /> Protect
                                      </button>
                                    ) : (
                                      <>
                                        <button 
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); handleExecuteBundle(bundle, 'trash'); }} 
                                          disabled={activeEmailCount === 0}
                                          className="flex-1 flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 px-2 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" /> Trash
                                        </button>
                                        <button 
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); handleExecuteBundle(bundle, 'archive'); }} 
                                          disabled={activeEmailCount === 0}
                                          className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                                        >
                                          <Archive className="w-3.5 h-3.5" /> Archive
                                        </button>
                                      </>
                                    )}
                                    {bundle.suggestedLabel && (
                                      <button 
                                        type="button"
                                        onClick={(e) => { e.preventDefault(); handleExecuteBundle(bundle, 'move_to_label'); }} 
                                        disabled={activeEmailCount === 0}
                                        className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2 py-2 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                                      >
                                        <FolderInput className="w-3.5 h-3.5" /> Move
                                      </button>
                                    )}
                                  </div>
                                )
                              ) : (
                                bundle.suggestFilterRule && !isFilterCreated ? (
                                  <button
                                    onClick={() => handleCreateRule(bundle)}
                                    disabled={isFilterCreating}
                                    className="w-full flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                                  >
                                    {isFilterCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
                                    <span>Create Filter Rule</span>
                                  </button>
                                ) : isFilterCreated ? (
                                  <div className="w-full flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-500 px-3 py-2 rounded-lg text-xs font-semibold">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Filter Active
                                  </div>
                                ) : (
                                  <div className="w-full flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-400 px-3 py-2 rounded-lg text-xs font-semibold">
                                    Done
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
      </div>

    </div>
  );

  if (isWidget) {
    return (
      <div className="w-full flex flex-col gap-4 animate-in fade-in duration-150">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-4 sm:p-5 overflow-hidden flex flex-col relative">
           <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
             <PieChartIcon className="w-5 h-5 text-indigo-600" />
             <h2 className="font-bold text-slate-900 text-base">Category Breakdown</h2>
           </div>
          {bodyContent}
        </div>
      </div>
    );
  }

  if (isPage) {
    return (
      <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-150">
        {headerContent}
        {bodyContent}
      </div>
    );
  }

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
        {headerContent}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6 flex flex-col relative">
          {bodyContent}
        </div>
      </div>
    </div>
  );
}
