// ================================================================
// Core domain types — single source of truth for the entire extension
// ================================================================

/** One row from a Measurement Book Excel sheet */
export interface MBRow {
  Particulars?: string;
  N1?: string;
  N2?: string;
  N3?: string;
  K?: string;
  L?: string;
  B?: string;
  H?: string;
  Sign?: string;
}

/** One row from a Variation Statement Excel sheet */
export interface VSRow {
  ItemNo: string;
  ProposedQty: string;
  Description?: string;
  Unit?: string;
  AgmtQty?: string;
}

export type ParsedRow = MBRow | VSRow;
export type DataType = 'mb' | 'vs';
export type SpeedLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type FormType = 'measurement' | 'variation' | 'none';

/**
 * Named index map for MB form inputs.
 * Replaces all magic numbers like inputs[7] throughout the codebase.
 */
export const MB_FIELD_INDEX = {
  Particulars: 0,
  N1: 1,
  N2: 2,
  N3: 3,
  K: 4,
  L: 5,
  B: 6,
  H: 7,
} as const;

export type MBFieldName = keyof typeof MB_FIELD_INDEX;

/** Per-fill usage counters returned by the license server */
export interface UsageData {
  is_unlimited: boolean;
  is_personal: boolean;
  is_railway: boolean;
  is_superuser: boolean;
  cycle_spend?: number;
  fills_this_cycle: number;
  today_fills: number;
  cycle_end?: string;
  credit_balance: number;
  agreement_no: string | null;
  used_contractors: string[];
  max_contractors: number;
  is_trial: boolean;
  trial_active: boolean;
  trial_days_remaining: number;
  free_fills_remaining?: number;
}

/** Shape of what chrome.storage.local holds for the license */
export interface StoredLicense {
  licenseKey?: string;
  licenseVerified?: boolean;
  licenseUses?: number;
  is_personal?: boolean;
  is_railway?: boolean;
  is_superuser?: boolean;
  contractor_name?: string | null;
  loginEmail?: string;
  sessionToken?: string;
  deviceId?: string;
  usageData?: UsageData;
  creditBalance?: number;
  railway_official_name?: string;
  railway_official_designation?: string;
}

/** Union of everything the license server can return */
export interface ServerResponse extends Partial<UsageData> {
  success: boolean;
  message?: string;
  license_key?: string;
  activations_used?: number;
  session_token?: string;
  session_expired?: boolean;
  contractor_name?: string | null;
  auto_captured_name?: string;
  verified_contractor?: string;
  email_verified?: boolean;
  verified_email?: string;
  verification_required?: boolean;
  contractor_name_duplicate?: boolean;
  trial_restriction?: boolean;
  need_onboarding?: boolean;
  support_email?: string;
  download_url?: string;
  latest_version?: string;
}

/** Result returned from a fill operation */
export interface FillResult {
  success: boolean;
  message: string;
  filled: number;
  notFound: string[];
  found?: string[];
  stopped?: boolean;
}

/** Data extracted from the IRWCMS page header */
export interface PageInfo {
  agreementNo?: string;
  measurementNo?: string;
  irwcmsEmail?: string;
  contractorName?: string;
  railwayOfficialName?: string;
  railwayOfficialDesignation?: string;
  userText?: string;
  pageTitle?: string;
}

/** Result of form-type detection */
export interface FormTypeResult {
  formType: FormType;
  hasProposedQty: boolean;
  hasScheduleTabs: boolean;
  hasItemNo: boolean;
  hasAddRow: boolean;
  hasParticulars: boolean;
  hasContractVariation: boolean;
  hasVariationDetails: boolean;
}

// ----------------------------------------------------------------
// Discriminated union of all messages sent TO content.ts
// ----------------------------------------------------------------
export type ContentMessage =
  | { action: 'fillForm';        data: MBRow[]; appendMode: boolean; delayMs: number }
  | { action: 'fillVariation';   data: VSRow[] }
  | { action: 'stopFill' }
  | { action: 'getMeasurementNo' }
  | { action: 'checkFormPage' }
  | { action: 'checkVariationForm' }
  | { action: 'getFormType' }
  | { action: 'getExistingRowCount' }
  | { action: 'detectPageInfo' }
  | { action: 'detectFormType' };

// ----------------------------------------------------------------
// Discriminated union of responses FROM content.ts
// ----------------------------------------------------------------
export type ContentResponse =
  | { measurementNo: string | null }
  | { isOnForm: boolean }
  | { isOnVariation: boolean }
  | { formType: FormType }
  | { existingRows: number }
  | { pageInfo: PageInfo }
  | { formTypeResult: FormTypeResult }
  | FillResult
  | { success: boolean };
