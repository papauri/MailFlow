import React, { useState, useEffect, useMemo } from 'react';
import { 
  Loader2, 
  Settings, 
  CheckCircle, 
  SlidersHorizontal, 
  Filter, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  ArrowRight, 
  ExternalLink, 
  Tag, 
  Archive, 
  Mail, 
  Check, 
  AlertTriangle, 
  RefreshCw, 
  ShieldCheck, 
  Plus, 
  Search,
  Trash2,
  Bookmark,
  TrendingUp,
  Inbox,
  Eye
} from 'lucide-react';
import { cn } from '../lib/utils';
import { searchEmails, createFilter, createLabel } from '../lib/gmail';
import { 
  extractSenderDetails, 
  calculateBayesianConfidence, 
  sanitizeGmailSearchQuery, 
  GENERIC_FREEMAIL_DOMAINS,
  KNOWN_BRAND_MAP 
} from '../lib/emailUtils';

export interface RuleProposal {
  id: string;
  sender: string;
  senderName?: string;
  domain: string;
  rootDomain: string;
  isDomainRuleCandidate: boolean;
  query: string;
  suggestedLabel: string;
  existingLabelId?: string;
  categoryTag: 'Folders' | 'Finance' | 'Alerts' | 'Newsletters' | 'Purchases' | 'Dev';
  title: string;
  reason: string;
  consistencyScore: number; // 0 to 1.0 (e.g. 0.95 = 95% Bayesian routing confidence)
  monthlyVolumeEst: number;
  sampleSubjects: string[];
  actionType: 'move_archive' | 'label_only';
  markRead: boolean;
  star: boolean;
  neverSpam: boolean;
}

export interface CreatedRuleRecord {
  id: string;
  query: string;
  labelName: string;
  actionType: 'move_archive' | 'label_only';
  markRead: boolean;
  createdAt: string;
}

interface RuleSuggesterProps {
  userLabels: any[];
  recentEmails?: any[];
  onApplyQuery?: (query: string, filter?: string) => void;
  aiSettings?: any;
  isAiWorking?: boolean;
}

const SAVED_RULES_STORAGE_KEY = 'inbox_created_rules_log_v1';
const DISMISSED_RULES_STORAGE_KEY = 'inbox_dismissed_rules_v1';

export function RuleSuggester({ userLabels, recentEmails = [], onApplyQuery, aiSettings, isAiWorking }: RuleSuggesterProps) {
  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<RuleProposal[]>([]);
  const [activeTab, setActiveTab] = useState<'suggestions' | 'active_rules'>('suggestions');
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all');
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [creatingRuleId, setCreatingRuleId] = useState<string | null>(null);
  const [createdRulesLog, setCreatedRulesLog] = useState<CreatedRuleRecord[]>([]);
  const [dismissedRuleIds, setDismissedRuleIds] = useState<Set<string>>(new Set());
  const [hasScanned, setHasScanned] = useState(false);

  // Editable custom rule config state per proposal
  const [customConfigs, setCustomConfigs] = useState<Record<string, {
    query: string;
    targetLabel: string;
    actionType: 'move_archive' | 'label_only';
    markRead: boolean;
    star: boolean;
    neverSpam: boolean;
  }>>({});

  // Load created rules log and dismissed rules from storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_RULES_STORAGE_KEY);
      if (saved) setCreatedRulesLog(JSON.parse(saved));
      
      const dismissed = localStorage.getItem(DISMISSED_RULES_STORAGE_KEY);
      if (dismissed) setDismissedRuleIds(new Set(JSON.parse(dismissed)));
    } catch (e) {
      console.error(e);
    }
  }, []);

  // Save created rule to history
  const persistCreatedRule = (record: CreatedRuleRecord) => {
    try {
      const next = [record, ...createdRulesLog.filter(r => r.id !== record.id)].slice(0, 50);
      setCreatedRulesLog(next);
      localStorage.setItem(SAVED_RULES_STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.error(e);
    }
  };

  const dismissProposal = (id: string) => {
    const next = new Set(dismissedRuleIds).add(id);
    setDismissedRuleIds(next);
    try {
      localStorage.setItem(DISMISSED_RULES_STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch (e) {
      console.error(e);
    }
  };

  // Run the full statistical discovery engine
  const runRuleAnalysis = async () => {
    setLoading(true);
    setHasScanned(true);
    setProposals([]);

    try {
      const discoveredProposals: RuleProposal[] = [];
      const seenSenderSignatures = new Set<string>();

      // 1. HISTORICAL FOLDER ROUTING SCAN (Bayesian Probability Modeling)
      const customLabels = userLabels.filter(l => l.type === 'user');
      
      for (const label of customLabels.slice(0, 15)) {
        try {
          const safeLabel = label.name.includes(' ') ? `"${label.name}"` : label.name;
          const folderEmails = await searchEmails(`label:${safeLabel} -in:inbox`, 40);
          if (!folderEmails || folderEmails.length === 0) continue;

          // Compute frequency per sender
          const senderFreq = new Map<string, { count: number, sampleSubjects: string[], name: string }>();
          
          folderEmails.forEach(e => {
            const info = extractSenderDetails(e.sender);
            if (!info.emailAddr || !info.emailAddr.includes('@')) return;
            
            const cur = senderFreq.get(info.emailAddr) || { count: 0, sampleSubjects: [], name: info.displayName || info.brand };
            cur.count += 1;
            if (e.subject && cur.sampleSubjects.length < 3 && !cur.sampleSubjects.includes(e.subject)) {
              cur.sampleSubjects.push(e.subject);
            }
            senderFreq.set(info.emailAddr, cur);
          });

          // For senders with high recurrence in this folder (count >= 3)
          for (const [senderAddr, data] of senderFreq.entries()) {
            if (data.count >= 3) {
              const info = extractSenderDetails(senderAddr);
              const signatureKey = `folder-${senderAddr}-${label.name}`;
              if (seenSenderSignatures.has(signatureKey)) continue;
              seenSenderSignatures.add(signatureKey);

              const isDomainCandidate = !info.isGenericFreemail && !!info.rootDomain;
              const query = isDomainCandidate ? `from:${info.rootDomain}` : `from:${senderAddr}`;
              
              // Calibrated Bayesian confidence
              const consistencyScore = calculateBayesianConfidence({
                folderMatchCount: data.count,
                totalSample: folderEmails.length,
                senderTotalInInbox: data.count,
                isDomainCandidate
              });
              const monthlyVolumeEst = Math.round(data.count * 2.2);

              discoveredProposals.push({
                id: signatureKey,
                sender: senderAddr,
                senderName: data.name,
                domain: info.domain,
                rootDomain: info.rootDomain,
                isDomainRuleCandidate: isDomainCandidate,
                query: sanitizeGmailSearchQuery(query),
                suggestedLabel: label.name,
                existingLabelId: label.id,
                categoryTag: 'Folders',
                title: `${info.brand || data.name} Routing Rule`,
                reason: `${data.count} recent emails consistently filed in "${label.name}". Automated routing will bypass inbox clutter.`,
                consistencyScore,
                monthlyVolumeEst,
                sampleSubjects: data.sampleSubjects,
                actionType: 'move_archive',
                markRead: false,
                star: false,
                neverSpam: true
              });
            }
          }
        } catch (folderErr) {
          console.warn("Folder scan error for", label.name, folderErr);
        }
      }

      // 2. INBOX INFLOW PATTERN SCAN (Transaction, Alert & Newsletter Signatures)
      if (recentEmails && recentEmails.length > 0) {
        const inboxSenderGroups = new Map<string, { count: number, emails: any[] }>();
        
        recentEmails.forEach(e => {
          const info = extractSenderDetails(e.sender);
          if (!info.emailAddr) return;
          const groupKey = (!info.isGenericFreemail && info.rootDomain) ? info.rootDomain : info.emailAddr;
          const cur = inboxSenderGroups.get(groupKey) || { count: 0, emails: [] };
          cur.count += 1;
          cur.emails.push(e);
          inboxSenderGroups.set(groupKey, cur);
        });

        for (const [groupKey, group] of inboxSenderGroups.entries()) {
          if (group.count >= 3) {
            const sampleEmail = group.emails[0];
            const info = extractSenderDetails(sampleEmail.sender);
            
            const brandEntry = KNOWN_BRAND_MAP[info.rootDomain] || KNOWN_BRAND_MAP[info.domain];
            const isDomainCandidate = !info.isGenericFreemail && !!info.rootDomain;
            const query = isDomainCandidate ? `from:${info.rootDomain}` : `from:${info.emailAddr}`;
            const signatureKey = `inbox-${query}`;

            if (seenSenderSignatures.has(signatureKey)) continue;
            seenSenderSignatures.add(signatureKey);

            let labelName = brandEntry?.brand || info.brand || info.displayName;
            let category: RuleProposal['categoryTag'] = (brandEntry?.category as any) || 'Alerts';

            // Check if user already has an existing label matching this
            const matchingUserLabel = userLabels.find(l => l.name.toLowerCase() === labelName.toLowerCase());

            const sampleSubjects = group.emails.map(e => e.subject || '').filter(Boolean).slice(0, 3);
            const monthlyVolumeEst = Math.round(group.count * 2.5);

            const consistencyScore = calculateBayesianConfidence({
              folderMatchCount: group.count,
              totalSample: recentEmails.length,
              senderTotalInInbox: group.count,
              isDomainCandidate
            });

            discoveredProposals.push({
              id: signatureKey,
              sender: info.emailAddr,
              senderName: info.brand || info.displayName,
              domain: info.domain,
              rootDomain: info.rootDomain,
              isDomainRuleCandidate: isDomainCandidate,
              query: sanitizeGmailSearchQuery(query),
              suggestedLabel: matchingUserLabel ? matchingUserLabel.name : labelName,
              existingLabelId: matchingUserLabel?.id,
              categoryTag: category,
              title: `${info.brand || info.domain} Automatic Organizer`,
              reason: `High recurring inflow (${group.count} emails in current batch). Auto-tag and organize future incoming threads.`,
              consistencyScore: 0.94,
              monthlyVolumeEst,
              sampleSubjects,
              actionType: category === 'Newsletters' || category === 'Purchases' ? 'move_archive' : 'label_only',
              markRead: false,
              star: false,
              neverSpam: true
            });
          }
        }
      }

      // Initialize customizable configs for each proposal
      const initialConfigs: Record<string, any> = {};
      discoveredProposals.forEach(p => {
        initialConfigs[p.id] = {
          query: p.query,
          targetLabel: p.suggestedLabel,
          actionType: p.actionType,
          markRead: p.markRead,
          star: p.star,
          neverSpam: p.neverSpam
        };
      });
      setCustomConfigs(initialConfigs);

      // Sort by consistency score & volume
      setProposals(discoveredProposals.sort((a, b) => (b.consistencyScore * b.monthlyVolumeEst) - (a.consistencyScore * a.monthlyVolumeEst)));
    } catch (err) {
      console.error("Rule analysis failed", err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyRule = async (proposal: RuleProposal) => {
    const config = customConfigs[proposal.id] || {
      query: proposal.query,
      targetLabel: proposal.suggestedLabel,
      actionType: proposal.actionType,
      markRead: proposal.markRead,
      star: proposal.star,
      neverSpam: proposal.neverSpam
    };

    setCreatingRuleId(proposal.id);
    try {
      // 1. Resolve or Create Target Label in Gmail
      let labelId = proposal.existingLabelId;
      const targetLabelName = config.targetLabel.trim();
      
      const foundLabel = userLabels.find(l => l.name.toLowerCase() === targetLabelName.toLowerCase());
      if (foundLabel) {
        labelId = foundLabel.id;
      } else {
        const created = await createLabel(targetLabelName);
        if (created && created.id) {
          labelId = created.id;
        }
      }

      if (!labelId) {
        throw new Error("Could not create or resolve label.");
      }

      // 2. Configure Action Flags for Gmail Filter API
      const addLabelIds: string[] = [labelId];
      const removeLabelIds: string[] = [];

      if (config.actionType === 'move_archive') {
        removeLabelIds.push('INBOX');
      }
      if (config.markRead) {
        removeLabelIds.push('UNREAD');
      }
      if (config.star) {
        addLabelIds.push('STARRED');
      }

      // 3. Create Filter via Gmail API
      await createFilter(config.query, addLabelIds, removeLabelIds);

      // 4. Save to Created Rules Log
      persistCreatedRule({
        id: proposal.id,
        query: config.query,
        labelName: targetLabelName,
        actionType: config.actionType,
        markRead: config.markRead,
        createdAt: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      });

      // Dismiss from suggestions
      dismissProposal(proposal.id);
    } catch (e: any) {
      console.error(e);
      alert(e.message || "Failed to create rule in Gmail. You may have reached Gmail's filter limits.");
    } finally {
      setCreatingRuleId(null);
    }
  };

  const updateConfig = (ruleId: string, partial: Partial<typeof customConfigs[string]>) => {
    setCustomConfigs(prev => ({
      ...prev,
      [ruleId]: { ...prev[ruleId], ...partial }
    }));
  };

  const filteredProposals = useMemo(() => {
    return proposals
      .filter(p => !dismissedRuleIds.has(p.id) && !createdRulesLog.some(r => r.id === p.id))
      .filter(p => activeCategoryFilter === 'all' || p.categoryTag.toLowerCase() === activeCategoryFilter.toLowerCase());
  }, [proposals, dismissedRuleIds, createdRulesLog, activeCategoryFilter]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-xs mt-6 sm:mt-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-slate-100 text-slate-700">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-slate-800">
                Automated Sorting Rules
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full uppercase tracking-wider">
                Statistical Routing
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Derives recurring sender & folder patterns to automatically file incoming emails in Gmail
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          {/* Tabs switch */}
          <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-xs font-semibold">
            <button
              onClick={() => setActiveTab('suggestions')}
              className={cn(
                "px-3 py-1.5 rounded-md transition-all",
                activeTab === 'suggestions' ? "bg-white text-slate-800 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              )}
            >
              Suggestions ({filteredProposals.length})
            </button>
            <button
              onClick={() => setActiveTab('active_rules')}
              className={cn(
                "px-3 py-1.5 rounded-md transition-all",
                activeTab === 'active_rules' ? "bg-white text-slate-800 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              )}
            >
              Created Rules ({createdRulesLog.length})
            </button>
          </div>

          {hasScanned ? (
            <button
              onClick={runRuleAnalysis}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
              title="Scan folders and inbox for rule patterns"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              <span className="hidden md:inline">Re-Scan</span>
            </button>
          ) : (
            <button
              onClick={runRuleAnalysis}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
              title="Scan for rule patterns"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Discover Rules</span>
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Pills (Suggestions tab only) */}
      {hasScanned && activeTab === 'suggestions' && !loading && filteredProposals.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 sm:px-6 py-2.5 bg-white border-b border-slate-100 overflow-x-auto no-scrollbar">
          <span className="text-xs font-medium text-slate-400 mr-1 shrink-0">Category:</span>
          {['all', 'Folders', 'Finance', 'Alerts', 'Newsletters', 'Purchases', 'Dev'].map(cat => {
            const count = cat === 'all' 
              ? proposals.filter(p => !dismissedRuleIds.has(p.id) && !createdRulesLog.some(r => r.id === p.id)).length
              : proposals.filter(p => !dismissedRuleIds.has(p.id) && !createdRulesLog.some(r => r.id === p.id) && p.categoryTag.toLowerCase() === cat.toLowerCase()).length;
            if (cat !== 'all' && count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategoryFilter(cat)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-full transition-colors whitespace-nowrap shrink-0",
                  activeCategoryFilter === cat 
                    ? "bg-slate-800 text-white font-semibold" 
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                {cat === 'all' ? 'All Suggestions' : cat} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Main Content Body */}
      <div className="p-4 sm:p-6 bg-slate-50/30">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">Analyzing historical folder routing & inflow statistics...</p>
              <p className="text-xs text-slate-500 mt-1">Calculating Bayesian consistency scores and isolating recurring domain patterns.</p>
            </div>
          </div>
        ) : activeTab === 'active_rules' ? (
          /* ACTIVE RULES TAB */
          createdRulesLog.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-500">
              <Inbox className="w-8 h-8 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">No Automated Rules Created Yet</p>
              <p className="text-xs text-center max-w-sm">Switch to the Suggestions tab and apply recommended routing rules with a single click.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1 px-1">
                <span>Rules active in your Gmail account:</span>
                <span className="font-semibold">{createdRulesLog.length} filter rules</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {createdRulesLog.map(rule => (
                  <div key={rule.id} className="bg-white border border-emerald-200/80 rounded-xl p-4 shadow-2xs flex flex-col justify-between">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold bg-slate-100 text-slate-800 px-2 py-0.5 rounded border border-slate-200 truncate max-w-[200px]" title={rule.query}>
                            {rule.query}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <CheckCircle className="w-3 h-3" /> Active
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-2">
                          Routes to label <strong className="text-slate-800 font-semibold">"{rule.labelName}"</strong>
                          {rule.actionType === 'move_archive' && " & skips Inbox"}
                          {rule.markRead && ", marks as read"}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">{rule.createdAt}</span>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 mt-2">
                      {onApplyQuery && (
                        <button
                          onClick={() => onApplyQuery(rule.query)}
                          className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors"
                        >
                          <Search className="w-3.5 h-3.5" /> Test Filter in Search
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : (
          /* SUGGESTIONS TAB */
          !hasScanned ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
              <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-2xs mb-3 text-slate-700">
                <SlidersHorizontal className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-sm sm:text-base font-bold text-slate-800 mb-1">
                Discover Automated Sorting Rules
              </h3>
              <p className="text-xs text-slate-500 max-w-md mb-4 leading-relaxed">
                Analyze recurring inflow, folder patterns, and sender behavior to generate precise auto-routing rules that keep your inbox organized automatically.
              </p>
              <button
                onClick={runRuleAnalysis}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs sm:text-sm font-semibold rounded-xl transition-colors shadow-2xs disabled:opacity-50"
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>Discover Sorting Rules</span>
              </button>
            </div>
          ) : filteredProposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-500">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
              <p className="text-sm font-medium text-slate-700">All Set! No Pending Rule Recommendations</p>
              <p className="text-xs text-center max-w-sm">Your folders and inbox have no recurring unrouted pattern outliers right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredProposals.map((proposal) => {
                const isExpanded = expandedRuleId === proposal.id;
                const isCreating = creatingRuleId === proposal.id;
                const config = customConfigs[proposal.id] || {
                  query: proposal.query,
                  targetLabel: proposal.suggestedLabel,
                  actionType: proposal.actionType,
                  markRead: proposal.markRead,
                  star: proposal.star,
                  neverSpam: proposal.neverSpam
                };

                return (
                  <div 
                    key={proposal.id}
                    className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 transition-all shadow-2xs hover:shadow-xs flex flex-col justify-between"
                  >
                    {/* Card Top: Header, Title, Consistency Badge */}
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h4 className="font-bold text-slate-800 text-sm sm:text-base truncate" title={proposal.title}>
                              {proposal.title}
                            </h4>
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full">
                              ~{proposal.monthlyVolumeEst} emails/mo
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-500">
                            <span className="font-mono text-[11px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                              {proposal.query}
                            </span>
                            <span className="text-emerald-700 font-semibold text-[11px] bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                              {Math.round(proposal.consistencyScore * 100)}% Consistency
                            </span>
                          </div>
                        </div>

                        {/* Dismiss button */}
                        <button
                          onClick={() => dismissProposal(proposal.id)}
                          className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors"
                          title="Dismiss this suggestion"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed mb-3">
                        {proposal.reason}
                      </p>

                      {/* Sample subjects preview */}
                      {proposal.sampleSubjects.length > 0 && (
                        <div className="bg-slate-50/80 rounded-lg p-2.5 border border-slate-200/70 mb-3.5">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                            Recent Matching Threads:
                          </span>
                          <ul className="text-xs text-slate-600 space-y-1">
                            {proposal.sampleSubjects.map((sub, i) => (
                              <li key={i} className="truncate flex items-center gap-1.5 text-slate-700">
                                <span className="w-1 h-1 rounded-full bg-slate-400 shrink-0" />
                                <span className="truncate">{sub}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* Rule Configuration Panel (Expandable / Inline) */}
                    <div className="mt-auto pt-3 border-t border-slate-100 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => setExpandedRuleId(isExpanded ? null : proposal.id)}
                          className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {isExpanded ? 'Hide Rule Customization' : 'Customize Rule Actions'}
                        </button>

                        {onApplyQuery && (
                          <button
                            onClick={() => onApplyQuery(config.query)}
                            className="text-xs font-medium text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors"
                            title="Preview matching emails in main dashboard search"
                          >
                            <Eye className="w-3.5 h-3.5" /> Test Query
                          </button>
                        )}
                      </div>

                      {/* Expanded Customizer */}
                      {isExpanded && (
                        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-3 animate-in fade-in duration-150 text-xs">
                          {/* Search Query Override */}
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">Filter Query Criteria:</label>
                            <input
                              type="text"
                              value={config.query}
                              onChange={(e) => updateConfig(proposal.id, { query: e.target.value })}
                              className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-700"
                            />
                          </div>

                          {/* Target Label */}
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1">Assign Label:</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={config.targetLabel}
                                onChange={(e) => updateConfig(proposal.id, { targetLabel: e.target.value })}
                                placeholder="Label name..."
                                className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-700 font-medium"
                              />
                            </div>
                          </div>

                          {/* Action Type Radio */}
                          <div>
                            <label className="block text-[11px] font-bold text-slate-600 mb-1.5">Inbox Routing Action:</label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => updateConfig(proposal.id, { actionType: 'move_archive' })}
                                className={cn(
                                  "p-2 rounded-lg border text-left transition-all",
                                  config.actionType === 'move_archive'
                                    ? "bg-white border-slate-800 text-slate-900 shadow-2xs font-semibold"
                                    : "bg-white/60 border-slate-200 text-slate-600 hover:bg-white"
                                )}
                              >
                                <div className="flex items-center gap-1.5">
                                  <Archive className="w-3.5 h-3.5 text-slate-700" />
                                  <span>Move & Archive</span>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-0.5">Skips Inbox automatically</p>
                              </button>

                              <button
                                type="button"
                                onClick={() => updateConfig(proposal.id, { actionType: 'label_only' })}
                                className={cn(
                                  "p-2 rounded-lg border text-left transition-all",
                                  config.actionType === 'label_only'
                                    ? "bg-white border-slate-800 text-slate-900 shadow-2xs font-semibold"
                                    : "bg-white/60 border-slate-200 text-slate-600 hover:bg-white"
                                )}
                              >
                                <div className="flex items-center gap-1.5">
                                  <Tag className="w-3.5 h-3.5 text-slate-700" />
                                  <span>Tag Only</span>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-0.5">Keeps email in Inbox</p>
                              </button>
                            </div>
                          </div>

                          {/* Additional Flags */}
                          <div className="flex items-center gap-4 pt-1">
                            <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                              <input
                                type="checkbox"
                                checked={config.markRead}
                                onChange={(e) => updateConfig(proposal.id, { markRead: e.target.checked })}
                                className="rounded text-slate-800 focus:ring-slate-700 border-slate-300"
                              />
                              <span className="text-[11px] font-medium">Mark as read</span>
                            </label>

                            <label className="flex items-center gap-1.5 cursor-pointer text-slate-700">
                              <input
                                type="checkbox"
                                checked={config.star}
                                onChange={(e) => updateConfig(proposal.id, { star: e.target.checked })}
                                className="rounded text-slate-800 focus:ring-slate-700 border-slate-300"
                              />
                              <span className="text-[11px] font-medium">Star</span>
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Create Rule Primary CTA */}
                      <button
                        onClick={() => handleApplyRule(proposal)}
                        disabled={isCreating}
                        className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-950 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Creating Gmail Rule...</span>
                          </>
                        ) : (
                          <>
                            <Filter className="w-3.5 h-3.5" />
                            <span>
                              {config.actionType === 'move_archive'
                                ? `Auto-Route to [${config.targetLabel}] & Skip Inbox`
                                : `Auto-Tag with [${config.targetLabel}]`}
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>
    </div>
  );
}
