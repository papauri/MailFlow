import { countEmails, searchEmails, scanFolderMetadata, estimateQuerySize, fetchGmailAPI, processInChunks, listMessageIds, fetchMessagesMetadataBatch, fetchMailboxComposition } from './gmail';
import {
  extractSenderDetails, GENERIC_FREEMAIL_DOMAINS, HEALTH_SCORE_QUERIES, INBOX_STAT_QUERIES
} from './emailUtils';

/**
 * Shared Inbox Health data fetchers.
 *
 * Extracted out of InboxHealth so the Sender Analytics page can render the same
 * clusters without recomputing them — both views read one cached result via
 * useCachedResource, so the ~30-request analysis runs once per invalidation
 * instead of once per navigation.
 */

export interface SenderCluster {
  email: string;
  name: string;
  count: number;
}

export interface DomainCluster {
  domain: string;
  count: number;
  /** Distinct addresses seen at this domain in the sample. The UI shows this. */
  senders: number;
}

export interface SenderClusters {
  topSenders: SenderCluster[];
  topDomains: DomainCluster[];
  recentEmails: any[];
}

export const senderClustersKey = (userEmail?: string) => `sender-clusters:${userEmail || 'anon'}`;
export const inboxStatsKey = (userEmail?: string) => `inbox-stats:${userEmail || 'anon'}`;
export const routingSampleKey = (userEmail?: string) => `routing-sample:${userEmail || 'anon'}`;

export interface RoutingSample {
  emails: any[];
  /** Messages carrying a user label — the evidence the routing model learns from. */
  filedCount: number;
}

/**
 * Sample for the routing model: training data plus candidates.
 *
 * The training signal is mail the user has *already filed*, which by definition is
 * not in the inbox — so an inbox-scoped sample contains almost none of it and the
 * model has nothing to learn from. `has:userlabels` is the query that actually finds
 * it, and nothing else in the app was asking for it.
 *
 * The second half is recent inbox mail: the candidates a rule would act on. Both are
 * needed — filed mail alone shows where things go but not what is still loose.
 */
export async function fetchRoutingSample(): Promise<RoutingSample> {
  const [filed, recent] = await Promise.all([
    scanFolderMetadata('has:userlabels -in:trash -in:spam -in:chats').catch(() => []),
    scanFolderMetadata('in:inbox -in:chats -is:draft').catch(() => []),
  ]);

  // A message can appear in both halves; keep one copy so counts stay honest.
  const byId = new Map<string, any>();
  for (const e of [...filed, ...recent]) {
    if (e?.id) byId.set(e.id, e);
  }

  return {
    emails: Array.from(byId.values()),
    filedCount: filed.length,
  };
}

/**
 * Sender clustering over the whole mailbox.
 *
 * Expensive by nature: it reads metadata for every message, which is the only way
 * to rank senders across the entire account rather than a sample of it. That is
 * the right trade on the Sender Analytics page, which exists to show the result.
 *
 * It is the wrong trade anywhere else. Inbox Health used to await this on mount to
 * render one summary line — "You have 6 frequent senders" — so a page whose whole
 * job is choosing where to go next waited on a full-mailbox scan to draw a label
 * over two numbers that are capped at six either way.
 */
export async function fetchSenderClusters(userEmail?: string): Promise<SenderClusters> {
  const normalizedUser = (userEmail || '').toLowerCase().trim();
  const userDomain = normalizedUser.includes('@') ? normalizedUser.split('@')[1] : null;

  /**
   * One sample, and every figure on the page derived from it.
   *
   * Counts used to come from a second pass of per-sender `countEmails` calls whose
   * query was scoped differently from the sample that ranked them — so a sender was
   * ranked on their non-spam volume and then displayed with their spam included.
   * Deriving both from this one scan removes the disagreement by construction, and
   * costs N fewer round trips.
   *
   * `-in:chats` because Hangouts/Chat records are not mail and would otherwise
   * appear as senders; the rest of Inbox Health already excludes them.
   */
  const recentEmails = await scanFolderMetadata(
    "in:anywhere -in:trash -in:spam -in:sent -is:draft -in:chats"
  );

  const senderCounts = new Map<string, SenderCluster>();
  const domainCounts = new Map<string, DomainCluster>();
  /** Distinct addresses per domain, so the "N unique senders" line has a source. */
  const domainSenders = new Map<string, Set<string>>();

  recentEmails.forEach((e: any) => {
    const details = extractSenderDetails(e.sender);
    const email = details.emailAddr;
    const rootDomain = details.rootDomain;

    if (!senderCounts.has(email)) {
      senderCounts.set(email, { email, name: details.displayName, count: 0 });
    }
    senderCounts.get(email)!.count++;

    // Only track organization / company / service domains for Domain Clusters
    // (exclude generic public webmail providers and self)
    if (rootDomain && rootDomain !== 'unknown' && !GENERIC_FREEMAIL_DOMAINS.has(rootDomain) && rootDomain !== userDomain) {
      if (!domainCounts.has(rootDomain)) domainCounts.set(rootDomain, { domain: rootDomain, count: 0, senders: 0 });
      domainCounts.get(rootDomain)!.count++;
      if (!domainSenders.has(rootDomain)) domainSenders.set(rootDomain, new Set());
      domainSenders.get(rootDomain)!.add(email);
    }
  });

  const topSenders = Array.from(senderCounts.values())
    .filter(s => s.email.includes('@') && (!normalizedUser || s.email !== normalizedUser))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const topDomains = Array.from(domainCounts.values())
    .filter(d => d.domain !== 'unknown' && !GENERIC_FREEMAIL_DOMAINS.has(d.domain))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    // The UI renders "N unique senders" per domain, so the count has to be carried
    // through rather than left at its zero initialiser.
    .map(d => ({ ...d, senders: domainSenders.get(d.domain)?.size ?? 0 }));

  return {
    recentEmails,
    topSenders: topSenders.filter(s => s.count > 0),
    topDomains: topDomains.filter(d => d.count > 0),
  };
}

export interface InboxStats {
  unread: number;
  oldPromo: number;
  large: number;
  spamAndTrash: number;
  importantUnread: number;
  updatesAndSocial: number;
  withAttachments: number;
  oldMail: number;
  /** Measured populations the score divides each metric by. */
  mailboxTotal: number;
  inboxTotal: number;
}

export interface InboxStatsResult {
  stats: InboxStats;
  sizes: Record<string, number>;
}

/**
 * The exact query behind every number Inbox Health displays.
 *
 * The five scoring metrics come straight from HEALTH_SCORE_QUERIES rather than being
 * respelled here. They used to be respelled, and two of them had drifted: unread was
 * missing `-in:chats` and old mail was missing `-in:spam`. The consequence was not
 * cosmetic — the "Start here" card ranks its recommendations by running the real
 * scoring model over *these* counts, so it was ranking a different inbox than the one
 * the Inbox Score modal showed the user.
 */
export const INBOX_HEALTH_QUERIES = {
  unread: HEALTH_SCORE_QUERIES.unread,
  oldPromo: HEALTH_SCORE_QUERIES.oldPromotions,
  large: HEALTH_SCORE_QUERIES.largeFiles,
  spamAndTrash: HEALTH_SCORE_QUERIES.spamAndTrash,
  oldMail: HEALTH_SCORE_QUERIES.oldMail,
  importantUnread: INBOX_STAT_QUERIES.importantUnread,
  updatesAndSocial: INBOX_STAT_QUERIES.updatesAndSocial,
  withAttachments: INBOX_STAT_QUERIES.withAttachments,
} as const;

export const inboxSizesKey = (userEmail?: string) => `inbox-sizes:${userEmail || 'anon'}`;

/**
 * The counts every Inbox Health card needs, and nothing else.
 *
 * Sizes used to be fetched in the same call, so the page could not show a single
 * number until six storage samples had also come back. They are split out into
 * `fetchInboxSizes` because they are needed by two byte badges and a tie-breaker,
 * not by the cards themselves — the page should not wait on them.
 */
export async function fetchInboxStats(): Promise<InboxStatsResult> {
  const Q = INBOX_HEALTH_QUERIES;

  const [size, unread, oldPromo, large, spamAndTrash, importantUnread, updatesAndSocial, withAttachments, oldMail] = await Promise.all([
    fetchMailboxComposition(),
    countEmails(Q.unread),
    countEmails(Q.oldPromo),
    countEmails(Q.large),
    countEmails(Q.spamAndTrash),
    countEmails(Q.importantUnread),
    countEmails(Q.updatesAndSocial),
    countEmails(Q.withAttachments),
    countEmails(Q.oldMail),
  ]);

  const stats: InboxStats = {
    unread, oldPromo, large, spamAndTrash,
    importantUnread, updatesAndSocial, withAttachments, oldMail,
    mailboxTotal: size.mailboxTotal,
    inboxTotal: size.inboxTotal,
  };

  return { stats, sizes: {} };
}

/**
 * Storage estimates for the counts above.
 *
 * Deliberately a second request so the page paints on counts alone. Each estimate
 * is a list call plus a couple of batched metadata calls, and six of them in front
 * of the first render was most of the wait on a large mailbox.
 */
export async function fetchInboxSizes(stats: InboxStats): Promise<Record<string, number>> {
  const Q = INBOX_HEALTH_QUERIES;

  const [oldPromoSize, largeSize, spamAndTrashSize, attachmentsSize, oldMailSize, updatesAndSocialSize] = await Promise.all([
    estimateQuerySize(Q.oldPromo, stats.oldPromo),
    estimateQuerySize(Q.large, stats.large),
    estimateQuerySize(Q.spamAndTrash, stats.spamAndTrash),
    estimateQuerySize(Q.withAttachments, stats.withAttachments),
    estimateQuerySize(Q.oldMail, stats.oldMail),
    estimateQuerySize(Q.updatesAndSocial, stats.updatesAndSocial),
  ]);

  return {
    oldPromo: oldPromoSize,
    large: largeSize,
    spamAndTrash: spamAndTrashSize,
    withAttachments: attachmentsSize,
    oldMail: oldMailSize,
    updatesAndSocial: updatesAndSocialSize,
  };
}


/**
 * One page of a category, mapped to the shape the analysis models expect.
 *
 * Extracted so the initial load and the background deepening pass share exactly one
 * mapping. When these were separate the background copy could quietly omit a field —
 * sizeEstimate went missing that way once already, which silently disabled every
 * storage-based finding.
 */
export async function fetchCategoryPage(
  query: string,
  pageToken?: string | null,
  pageSize: number = 500
): Promise<{ emails: any[]; nextPageToken: string | null }> {
  let url = `/threads?q=${encodeURIComponent(query)}&maxResults=${pageSize}`;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

  const listRes = await fetchGmailAPI(url);
  const threads = listRes?.threads || [];
  if (threads.length === 0) return { emails: [], nextPageToken: null };

  const mapped = await processInChunks(threads, 10, async (thread: any) => {
    try {
      const detail = await fetchGmailAPI(
        `/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`
      );
      if (!detail?.messages?.length) return null;

      const firstMsg = detail.messages[0];
      const lastMsg = detail.messages[detail.messages.length - 1];
      const headers = firstMsg.payload?.headers || [];
      const lastHeaders = lastMsg.payload?.headers || headers;
      const find = (hs: any[], name: string) =>
        hs.find((h: any) => h.name?.toLowerCase() === name)?.value;

      return {
        id: thread.id,
        threadId: thread.id,
        messageIds: detail.messages.map((m: any) => m.id),
        snippet: lastMsg.snippet || thread.snippet || '',
        sender: find(headers, 'from') || 'Unknown Sender',
        subject: find(headers, 'subject') || '(No Subject)',
        date: new Date(find(lastHeaders, 'date') || Date.now()),
        sizeEstimate: detail.messages.reduce((sum: number, m: any) => sum + (m.sizeEstimate || 0), 0),
        labelIds: [...new Set(detail.messages.flatMap((m: any) => m.labelIds || []))] as string[],
        listUnsubscribe: detail.messages
          .flatMap((m: any) => m.payload?.headers || [])
          .find((h: any) => h.name?.toLowerCase() === 'list-unsubscribe')?.value,
      };
    } catch {
      return null;
    }
  });

  return {
    emails: mapped.filter(Boolean),
    nextPageToken: listRes?.nextPageToken || null,
  };
}


export const categoryScanKey = (categoryId: string, userEmail?: string) =>
  `category-scan:${categoryId}:${userEmail || 'anon'}`;

/**
 * No ceiling on a category scan.
 *
 * This was 3,000, justified as a cost bound. The cost is real — metadata is billed
 * per message — but the bound bought it by analysing a fraction of the category and
 * presenting the result as the category. Clustering that has not seen the mail
 * cannot find the sender responsible for it.
 *
 * The quota governor already paces the spend; a scan of a large category is slow,
 * not unsafe, and the progress bar says so.
 */
export const CATEGORY_SCAN_LIMIT = 0;

/**
 * Full metadata scan of one category.
 *
 * Cached per category so switching between them is instant. Re-scanning on every
 * click was both slow and pointless: the mailbox has not changed between two clicks,
 * and each scan costs real quota. Refreshing is now something the user asks for.
 */
export async function fetchCategoryScan(
  query: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<any[]> {
  const ids = await listMessageIds(query, undefined, signal);
  if (ids.length === 0) return [];
  return fetchMessagesMetadataBatch(ids, onProgress, signal);
}
