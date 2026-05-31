export function normalizeSyncSource(source: string | null | undefined): string {
  const normalized = String(source || '').trim().toLowerCase();
  if (normalized === 'mock' || normalized === 'mock_sync') {
    return 'test_sync';
  }
  return normalized;
}

export function normalizeQmtMode(mode: string | null | undefined): string {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'mock') {
    return 'test_isolation';
  }
  if (normalized === 'real_readonly' || normalized === 'real_qmt_data') {
    return 'real';
  }
  return normalized;
}

export function isTestIsolationMode(mode: string | null | undefined): boolean {
  return normalizeQmtMode(mode) === 'test_isolation';
}

export function isRealQmtMode(mode: string | null | undefined): boolean {
  return normalizeQmtMode(mode) === 'real';
}

export function formatQmtModeLabel(
  mode: string | null | undefined,
  labels: { testIsolation?: string; real?: string; unknown?: string } = {},
): string {
  const normalized = normalizeQmtMode(mode);
  if (normalized === 'test_isolation') {
    return labels.testIsolation ?? '测试隔离';
  }
  if (normalized === 'real') {
    return labels.real ?? '真实只读';
  }
  return labels.unknown ?? '未检测';
}

const TEST_ISOLATION_ACCOUNT_IDS = new Set([
  'test_isolation_account',
  // Legacy exact placeholder kept only so old isolated test rows are labelled correctly.
  'mock_account',
]);

export function isTestIsolationAccountId(accountId: string | null | undefined): boolean {
  const normalized = String(accountId || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    TEST_ISOLATION_ACCOUNT_IDS.has(normalized)
    || normalized.startsWith('test_isolation_')
  );
}
