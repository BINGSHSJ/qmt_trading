export type DisplayDensity = 'comfortable' | 'compact' | 'dense';

export interface DensityToken {
  fontSize: number;
  fontSizeSM: number;
  controlHeight: number;
  controlHeightSM: number;
  borderRadius: number;
  cardPadding: number;
  tableCellPaddingBlock: number;
  tableCellPaddingInline: number;
}

export const defaultDisplayDensity: DisplayDensity = 'compact';
export const DISPLAY_DENSITY_STORAGE_KEY = 'lqc_display_density';

export const densityTokens: Record<DisplayDensity, DensityToken> = {
  comfortable: {
    fontSize: 14,
    fontSizeSM: 12,
    controlHeight: 30,
    controlHeightSM: 28,
    borderRadius: 10,
    cardPadding: 14,
    tableCellPaddingBlock: 8,
    tableCellPaddingInline: 10,
  },
  compact: {
    fontSize: 13,
    fontSizeSM: 12,
    controlHeight: 30,
    controlHeightSM: 28,
    borderRadius: 8,
    cardPadding: 12,
    tableCellPaddingBlock: 6,
    tableCellPaddingInline: 9,
  },
  dense: {
    fontSize: 12,
    fontSizeSM: 11,
    controlHeight: 28,
    controlHeightSM: 28,
    borderRadius: 8,
    cardPadding: 10,
    tableCellPaddingBlock: 5,
    tableCellPaddingInline: 8,
  },
};

export function isDisplayDensity(value: string | null | undefined): value is DisplayDensity {
  return value === 'comfortable' || value === 'compact' || value === 'dense';
}

export function getStoredDisplayDensity(): DisplayDensity {
  try {
    const stored = window.localStorage.getItem(DISPLAY_DENSITY_STORAGE_KEY);
    return isDisplayDensity(stored) ? stored : defaultDisplayDensity;
  } catch {
    return defaultDisplayDensity;
  }
}

export function setStoredDisplayDensity(density: DisplayDensity) {
  try {
    window.localStorage.setItem(DISPLAY_DENSITY_STORAGE_KEY, density);
  } catch {
    // localStorage may be blocked in restricted browser profiles.
  }
}

export function applyDisplayDensity(density: DisplayDensity = defaultDisplayDensity) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = density;
}
