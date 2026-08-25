/**
 * Single source of truth for hash routing.
 *
 * These lists were previously duplicated inline at four separate call sites in
 * Dashboard (route handling, the Health/Dashboard toggle, the breadcrumb, and the
 * dashboard visibility switch). Adding a route meant remembering all four — missing
 * one rendered two pages on top of each other. Add new routes here instead.
 */

/** Full-screen views that live under the Inbox Health section. */
export const HEALTH_SECTION_ROUTES = [
  'health',
  'sender-analytics',
  'category-distribution',
  'subscriptions',
  'smart-triage',
  'label-manager',
  'health-score',
  'manage-inbox',
  'smart-automations',
  'folder-optimizer',
  'rule-suggester',
  'rules',
  'export',
] as const;

/** Message-list views reached by drilling into a metric. */
export const FILTER_ROUTES = ['filter-view', 'inspect'] as const;

/** Every route that takes over the screen and must hide the dashboard. */
export const FULL_PAGE_ROUTES: readonly string[] = [
  ...HEALTH_SECTION_ROUTES,
  ...FILTER_ROUTES,
];

export function isFullPageRoute(hash: string): boolean {
  return FULL_PAGE_ROUTES.includes(hash);
}

export function isHealthSectionRoute(hash: string): boolean {
  return (HEALTH_SECTION_ROUTES as readonly string[]).includes(hash);
}

/**
 * Human-readable label for a route, used by breadcrumbs and Back buttons so a
 * "Back" control never points somewhere its label doesn't match.
 */
export const ROUTE_LABELS: Record<string, string> = {
  'health': 'Inbox Health',
  'sender-analytics': 'Sender Analytics',
  'category-distribution': 'Category Distribution',
  'subscriptions': 'Subscriptions',
  'smart-triage': 'Smart Triage',
  'label-manager': 'Label Manager',
  'health-score': 'Health Score',
  'manage-inbox': 'Manage Inbox',
  'smart-automations': 'Smart Automations',
  'folder-optimizer': 'Folder Optimizer',
  'rule-suggester': 'Automated Rules',
  'rules': 'Automated Rules',
  'export': 'Export Center',
  'dashboard': 'Dashboard',
};

export function routeLabel(hash?: string): string {
  if (!hash) return 'Inbox Health';
  return ROUTE_LABELS[hash] || 'Inbox Health';
}
