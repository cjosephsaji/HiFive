export type AccountStatus =
  | "WAITING" | "RESET_DUE" | "TRIGGERING" | "MESSAGE_SENT"
  | "VERIFYING_RESET" | "SUCCESS" | "LOGIN_REQUIRED"
  | "WORK_NOT_AVAILABLE" | "USAGE_PAGE_NOT_FOUND" | "USAGE_PARSE_FAILED"
  | "MESSAGE_SEND_FAILED" | "RESET_VERIFICATION_PENDING"
  | "RESET_DID_NOT_CHANGE" | "NETWORK_FAILURE" | "CHROMIUM_CRASH"
  | "DISABLED_REPEATED_ERRORS" | "UNKNOWN_ERROR";

export type AlertEvent =
  | "LOGIN_REQUIRED" | "WORK_NOT_AVAILABLE" | "USAGE_PARSE_FAILED"
  | "MESSAGE_SEND_FAILED" | "RESET_VERIFICATION_PENDING"
  | "RESET_DID_NOT_CHANGE" | "CHROMIUM_CRASH"
  | "REPEATED_NETWORK_FAILURES" | "ACCOUNT_DISABLED_REPEATED_ERRORS";

export interface AccountSummary {
  id: string;
  name: string;
  status: AccountStatus;
  enabled: boolean;
  timezone: string;
  fiveHourReset: string | null;
  lastError: string | null;
}

export interface AlertInput {
  accountId: string;
  event: AlertEvent;
  message?: string;
  error?: string;
}

export interface SuccessInput {
  accountId: string;
  event: "WORK_STARTED";
  message?: string;
  oldReset: string;
  newReset: string;
  /** Stable unique identifier for one reset cycle, typically the old UTC reset. */
  cycleKey: string;
}
