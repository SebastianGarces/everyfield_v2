// Re-export database types for convenience
export type {
  // Tables
  Location,
  NewLocation,
  ChurchMeeting,
  NewChurchMeeting,
  MeetingAttendanceRecord,
  NewMeetingAttendanceRecord,
  Invitation,
  NewInvitation,
  MeetingEvaluation,
  NewMeetingEvaluation,
  MeetingChecklistItem,
  NewMeetingChecklistItem,
  // Enums
  MeetingType,
  MeetingStatus,
  MeetingSubtype,
  AttendanceType,
  AttendanceStatus,
  ResponseStatus,
  InvitationStatus,
  ChecklistCategory,
} from "@/db/schema";

// Re-export enum arrays for use in components
export {
  meetingTypes,
  meetingStatuses,
  meetingSubtypes,
  attendanceTypes,
  attendanceStatuses,
  responseStatuses,
  invitationStatuses,
  checklistCategories,
} from "@/db/schema";

// ============================================================================
// Extended Types
// ============================================================================

import type {
  ChurchMeeting,
  MeetingAttendanceRecord,
  Location,
} from "@/db/schema";

/**
 * Meeting with attendance counts for list views
 */
export type MeetingWithCounts = ChurchMeeting & {
  totalAttendees: number;
  newAttendees: number;
  returningAttendees: number;
  location: Location | null;
  teamName?: string | null;
};

/**
 * Attendance record with person details joined
 */
export type AttendanceWithPerson = MeetingAttendanceRecord & {
  person: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
  invitedBy: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
};

/**
 * Attendance summary counts
 */
export type AttendanceSummary = {
  total: number;
  firstTime: number;
  returning: number;
  coreGroup: number;
};

// ============================================================================
// List & Filter Types
// ============================================================================

import type { MeetingType } from "@/db/schema";

/**
 * Options for listing meetings
 */
export type ListMeetingsOptions = {
  status?: "upcoming" | "past" | "all";
  meetingStatus?: string;
  type?: MeetingType;
  teamId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Options for getting a single meeting
 */
export type GetMeetingOptions = {
  includeAttendance?: boolean;
};

// ============================================================================
// Analytics Types
// ============================================================================

/**
 * Single meeting attendance data point for trend charts
 */
export type AttendanceTrendPoint = {
  meetingId: string;
  meetingNumber: number | null;
  datetime: Date;
  totalAttendance: number;
  newAttendees: number;
  returningAttendees: number;
  coreGroupAttendees: number;
};

/**
 * Summary statistics for all meetings
 */
export type MeetingSummaryStats = {
  totalMeetings: number;
  totalAttendees: number;
  avgAttendance: number;
  lastMeetingAttendance: number | null;
  growthPercent: number | null;
};

/**
 * Invitation leaderboard entry
 */
export type InvitationLeaderboardEntry = {
  person: {
    id: string;
    firstName: string;
    lastName: string;
  };
  invitedCount: number;
  confirmedCount: number;
  attendedCount: number;
};

/**
 * Invitation summary for a meeting
 */
export type InvitationSummary = {
  total: number;
  confirmed: number;
  maybe: number;
  declined: number;
  attended: number;
  noShow: number;
};

// ============================================================================
// Form State Types
// ============================================================================

/**
 * Server action result type
 */
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };
