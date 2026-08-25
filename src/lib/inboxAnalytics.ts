import { countEmails, searchEmails, estimateQuerySize } from './gmail';
import { extractSenderDetails, GENERIC_FREEMAIL_DOMAINS } from './emailUtils';

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
    searchEmails('has:userlabels -in:trash -in:spam -in:chats', 300).catch(() => []),
    searchEmails('in:inbox -in:chats -is:draft', 200).catch(() => []),
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

export async function fetchSenderClusters(userEmail?: string): Promise<SenderClusters> {
  const normalizedUser = (userEmail || '').toLowerCase().trim();
  const userDomain = normalizedUser.includes('@') ? normalizedUser.split('@')[1] : null;

  const recentEmails = await searchEmails("in:anywhere -in:trash -in:spam -in:sent -is:draft", 250);

  const senderCounts = new Map<string, SenderCluster>();
  const domainCounts = new Map<string, DomainCluster>();

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
      if (!domainCounts.has(rootDomain)) domainCounts.set(rootDomain, { domain: rootDomain, count: 0 });
      domainCounts.get(rootDomain)!.count++;
    }
  });

  const rawSenders = Array.from(senderCounts.values())
    .filter(s => s.email.includes('@') && (!normalizedUser || s.email !== normalizedUser))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const exactSenders = await Promise.all(rawSenders.map(async (s) => {
    const exactCount = await countEmails(`from:(${s.email}) -in:trash`);
    return { ...s, count: typeof exactCount === 'number' ? exactCount : s.count };
  }));

  const rawDomains = Array.from(domainCounts.values())
    .filter(d => d.domain !== 'unknown' && !GENERIC_FREEMAIL_DOMAINS.has(d.domain))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const exactDomains = await Promise.all(rawDomains.map(async (d) => {
    const exactCount = await countEmails(`from:(${d.domain}) -in:trash`);
    return { ...d, count: typeof exactCount === 'number' ? exactCount : d.count };
  }));

  return {
    recentEmails,
    topSenders: exactSenders.filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 6),
    topDomains: exactDomains.filter(d => d.count > 0).sort((a, b) => b.count - a.count).slice(0, 6),
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
}

export interface InboxStatsResult {
  stats: InboxStats;
  sizes: Record<string, number>;
}

export async function fetchInboxStats(): Promise<InboxStatsResult> {
  const [unread, oldPromo, large, spamAndTrash, importantUnread, updatesAndSocial, withAttachments, oldMail] = await Promise.all([
    countEmails("is:unread in:inbox"),
    countEmails("category:promotions older_than:6m -in:trash"),
    countEmails("larger:5M -in:trash"),
    countEmails("in:spam OR in:trash"),
    countEmails("is:unread is:important -category:promotions -in:trash"),
    countEmails("category:updates OR category:social -in:trash"),
    countEmails("has:attachment -in:trash"),
    countEmails("older_than:1y -in:trash")
  ]);

  const stats: InboxStats = {
    unread, oldPromo, large, spamAndTrash,
    importantUnread, updatesAndSocial, withAttachments, oldMail
  };

  const [oldPromoSize, largeSize, spamAndTrashSize, attachmentsSize, oldMailSize, updatesAndSocialSize] = await Promise.all([
    estimateQuerySize("category:promotions older_than:6m -in:trash", oldPromo),
    estimateQuerySize("larger:5M -in:trash", large),
    estimateQuerySize("in:spam OR in:trash", spamAndTrash),
    estimateQuerySize("has:attachment -in:trash", withAttachments),
    estimateQuerySize("older_than:1y -in:trash", oldMail),
    estimateQuerySize("category:updates OR category:social -in:trash", updatesAndSocial)
  ]);

  return {
    stats,
    sizes: {
      oldPromo: oldPromoSize,
      large: largeSize,
      spamAndTrash: spamAndTrashSize,
      withAttachments: attachmentsSize,
      oldMail: oldMailSize,
      updatesAndSocial: updatesAndSocialSize,
    },
  };
}
