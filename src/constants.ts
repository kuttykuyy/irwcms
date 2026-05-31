import type { SpeedLevel } from './types';

export const LICENSE_SERVER_URL = 'https://irwcms.primerp.in' as const;
export const CURRENT_VERSION   = '12.1' as const;

/** Fixed delay for Department/Railway accounts (speed slider hidden) */
export const DEPARTMENT_FIXED_DELAY_MS = 500;

export const SPEED_SETTINGS: Record<SpeedLevel, { delay: number; labelKey: string }> = {
  1: { delay: 500, labelKey: 'verySlow' },
  2: { delay: 200, labelKey: 'slow'     },
  3: { delay: 100, labelKey: 'medium'   },
  4: { delay: 50,  labelKey: 'fast'     },
  5: { delay: 20,  labelKey: 'veryFast' },
  6: { delay: 1,   labelKey: 'instant'  },
};

export const DEFAULT_SPEED: SpeedLevel = 3;

/** Only recognize these two hosts — prevents injection into random gov.in pages */
export const IRWCMS_HOSTS = ['ircep.gov.in', 'irwcms.primerp.in'] as const;

export function isIrwcmsUrl(url: string | undefined): boolean {
  if (!url) return false;
  return IRWCMS_HOSTS.some(h => url.includes(h));
}
