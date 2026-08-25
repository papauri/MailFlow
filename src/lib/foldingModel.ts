import { extractSenderDetails } from './emailUtils';
import { patternKey, priorFor, isSuppressed } from './suggestionMemory';

/**
 * Routing model for folders and filter rules.
 *
 * Learns from filing the user has already done. Every message they have labelled is
 * a training example, so the mailbox already contains the answer to "where does mail
 * from this sender belong" — no keyword table required, and it works in any language.
 *
 * The important correction over the previous implementation is which conditional gets
 * measured. That version scored a sender by `matchesInFolder / folderSize`, i.e.
 * P(sender | folder) — "how much of this folder came from them". A routing rule needs
 * P(folder | sender) — "of everything this sender sends, how much belongs here".
 * Those diverge badly for high-volume senders: someone who puts 20 messages in
 * Receipts but sends 500 elsewhere scored highly under the old measure and would have
 * misfiled the other 480.
 */

/** Gmail's own labels carry no filing intent, so they are never treated as targets. */
const SYSTEM_LABEL_PREFIXES = [
  'INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'UNREAD', 'STARRED', 'IMPORTANT',
  'CHAT', 'CATEGORY_', 'YELLOW_', 'RED_', 'BLUE_', 'GREEN_', 'ORANGE_', 'PURPLE_',
];

function isUserLabel(labelId: string): boolean {
  return !SYSTEM_LABEL_PREFIXES.some(p => labelId === p || labelId.startsWith(p));
}

export interface RoutingSuggestion {
  id: string;
  kind: 'route_existing' | 'new_folder';
  senderKey: string;
  senderName: string;
  /** Rule targets the domain when it is company-owned, otherwise the exact address. */
  matchTarget: string;
  isDomainRule: boolean;
  labelName: string;
  labelId?: string;
  /** Messages from this sender in the sample. */
  volume: number;
  /** Messages already filed in the target label. */
  filed: number;
  /** Not yet filed — what the rule would tidy up on creation. */
  unfiled: number;
  /** P(label | sender), Laplace-smoothed. The number that actually justifies a rule. */
  purity: number;
  confidence: number;
  rationale: string;
  evidence: string[];
  query: string;
  ids: string[];
  score: number;
  memoryKey: string;
}

interface SenderStats {
  key: string;
  name: string;
  domain: string;
  isGenericFreemail: boolean;
  total: number;
  labelCounts: Map<string, number>;
  ids: string[];
  unlabelledIds: string[];
}

/**
 * Laplace-smoothed P(label | sender).
 *
 * Smoothing matters here because raw ratios are wildly overconfident on small
 * samples: 2 of 2 messages filed in a folder is not the same evidence as 60 of 60,
 * but both are 100% undivided. Alpha pulls sparse senders toward neutral so they
 * cannot outrank well-evidenced ones.
 */
function smoothedPurity(filed: number, total: number, distinctLabels: number, alpha = 1): number {
  const classes = Math.max(2, distinctLabels + 1); // +1 for "unfiled"
  return (filed + alpha) / (total + alpha * classes);
}

function collectSenderStats(emails: any[], labelIdToName: Map<string, string>): Map<string, SenderStats> {
  const stats = new Map<string, SenderStats>();

  for (const email of emails) {
    const details = extractSenderDetails(email.sender || '');
    const key = details.emailAddr;
    if (!key || !key.includes('@')) continue;

    let entry = stats.get(key);
    if (!entry) {
      entry = {
        key,
        name: details.displayName || details.brand || key,
        domain: details.rootDomain,
        isGenericFreemail: details.isGenericFreemail,
        total: 0,
        labelCounts: new Map(),
        ids: [],
        unlabelledIds: [],
      };
      stats.set(key, entry);
    }

    entry.total += 1;
    if (email.id) entry.ids.push(email.id);

    const userLabels = (email.labelIds || []).filter((id: string) => isUserLabel(id) && labelIdToName.has(id));
    if (userLabels.length === 0) {
      if (email.id) entry.unlabelledIds.push(email.id);
    } else {
      for (const id of userLabels) {
        entry.labelCounts.set(id, (entry.labelCounts.get(id) || 0) + 1);
      }
    }
  }

  return stats;
}

export interface RoutingOptions {
  /** Minimum messages from a sender before any rule is considered. */
  minVolume?: number;
  /** Minimum smoothed P(label|sender) to propose routing. */
  minPurity?: number;
  /** Minimum volume before proposing a brand-new folder. */
  minNewFolderVolume?: number;
}

export function buildRoutingSuggestions(
  emails: any[],
  userLabels: { id: string; name: string; type?: string }[],
  options: RoutingOptions = {}
): RoutingSuggestion[] {
  const {
    minVolume = 3,
    minPurity = 0.5,
    // Tuned down from 12: against a real ~500-message sample spread over hundreds of
    // senders, very few clear a dozen, so the new-folder path almost never fired.
    // Smoothing and the confidence score already keep thin evidence ranked low, so
    // the threshold does not need to do that job as well.
    minNewFolderVolume = 6,
  } = options;

  const labelIdToName = new Map<string, string>();
  for (const label of userLabels) {
    if (label?.id && label?.name && label.type !== 'system') {
      labelIdToName.set(label.id, label.name);
    }
  }

  const stats = collectSenderStats(emails, labelIdToName);
  const suggestions: RoutingSuggestion[] = [];

  stats.forEach(sender => {
    if (sender.total < minVolume) return;

    // A company domain generalises to a rule; a freemail address never should,
    // or one gmail.com sender would route everyone else's mail with them.
    const isDomainRule = !sender.isGenericFreemail && !!sender.domain;
    const matchTarget = isDomainRule ? sender.domain : sender.key;

    // --- Case 1: the user already files this sender somewhere consistently ---
    let bestLabelId: string | null = null;
    let bestCount = 0;
    sender.labelCounts.forEach((count, labelId) => {
      if (count > bestCount) {
        bestCount = count;
        bestLabelId = labelId;
      }
    });

    if (bestLabelId && bestCount > 0) {
      const labelName = labelIdToName.get(bestLabelId)!;
      const purity = smoothedPurity(bestCount, sender.total, sender.labelCounts.size);

      if (purity >= minPurity) {
        const key = patternKey('route_existing', sender.key, labelName);
        if (!isSuppressed(key)) {
          const unfiled = sender.total - bestCount;
          // Confidence combines agreement (purity) with how much evidence backs it.
          const evidenceWeight = Math.min(1, Math.log10(1 + sender.total) / Math.log10(51));
          const confidence = Math.min(0.98, purity * 0.7 + evidenceWeight * 0.3);

          suggestions.push({
            id: `route:${sender.key}:${bestLabelId}`,
            kind: 'route_existing',
            senderKey: sender.key,
            senderName: sender.name,
            matchTarget,
            isDomainRule,
            labelName,
            labelId: bestLabelId,
            volume: sender.total,
            filed: bestCount,
            unfiled,
            purity,
            confidence,
            rationale: `You already file ${bestCount} of ${sender.total} messages from ${sender.name} into "${labelName}". A rule does that automatically from now on${unfiled > 0 ? `, and tidies the ${unfiled} still sitting loose` : ''}.`,
            evidence: [
              `${Math.round(purity * 100)}% of their mail belongs in "${labelName}"`,
              `${sender.total} messages seen from this sender`,
              unfiled > 0 ? `${unfiled} not yet filed` : 'All current mail already filed',
              isDomainRule ? `Rule matches the whole ${sender.domain} domain` : `Rule matches this address only`,
            ],
            query: isDomainRule ? `from:${sender.domain}` : `from:${sender.key}`,
            ids: sender.unlabelledIds,
            score: (purity * Math.log10(1 + sender.total)) * priorFor(key),
            memoryKey: key,
          });
        }
        return;
      }
    }

    // --- Case 2: high volume, never filed anywhere — propose a home for it ---
    if (sender.labelCounts.size === 0 && sender.total >= minNewFolderVolume) {
      const details = extractSenderDetails(sender.key);
      const folderName = details.brand && details.brand !== 'Unknown'
        ? details.brand
        : (sender.domain.split('.')[0] || sender.name);
      const labelName = folderName.charAt(0).toUpperCase() + folderName.slice(1);

      const key = patternKey('new_folder', sender.key, labelName);
      if (isSuppressed(key)) return;

      const evidenceWeight = Math.min(1, Math.log10(1 + sender.total) / Math.log10(51));
      const confidence = Math.min(0.9, 0.45 + evidenceWeight * 0.4);

      suggestions.push({
        id: `newfolder:${sender.key}`,
        kind: 'new_folder',
        senderKey: sender.key,
        senderName: sender.name,
        matchTarget,
        isDomainRule,
        labelName,
        volume: sender.total,
        filed: 0,
        unfiled: sender.total,
        purity: 1,
        confidence,
        rationale: `${sender.name} has sent ${sender.total} messages that live loose in your mailbox. Filing them under "${labelName}" gives them a home and keeps future mail out of the way.`,
        evidence: [
          `${sender.total} messages, none currently filed`,
          `No existing folder matches this sender`,
          isDomainRule ? `Rule matches the whole ${sender.domain} domain` : `Rule matches this address only`,
        ],
        query: isDomainRule ? `from:${sender.domain}` : `from:${sender.key}`,
        ids: sender.unlabelledIds,
        score: (0.6 * Math.log10(1 + sender.total)) * priorFor(key),
        memoryKey: key,
      });
    }
  });

  return suggestions.sort((a, b) => b.score - a.score);
}

export interface RoutingSummary {
  totalSuggestions: number;
  messagesCovered: number;
  routableToExisting: number;
  newFolders: number;
  sendersAnalysed: number;
}

export function summariseRouting(suggestions: RoutingSuggestion[], sendersAnalysed: number): RoutingSummary {
  return {
    totalSuggestions: suggestions.length,
    messagesCovered: suggestions.reduce((sum, s) => sum + s.unfiled, 0),
    routableToExisting: suggestions.filter(s => s.kind === 'route_existing').length,
    newFolders: suggestions.filter(s => s.kind === 'new_folder').length,
    sendersAnalysed,
  };
}

export { smoothedPurity as _smoothedPurityForTests };
