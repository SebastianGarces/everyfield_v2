// Re-export database types for convenience
export type {
  AttendanceType,
  ChecklistCategory,
  Invitation,
  InvitationStatus,
  // Tables
  Location,
  MeetingChecklistItem,
  MeetingEvaluation,
  // Enums
  MeetingStatus,
  NewInvitation,
  NewLocation,
  NewMeetingChecklistItem,
  NewMeetingEvaluation,
  NewVisionMeeting,
  NewVisionMeetingAttendance,
  ResponseStatus,
  VisionMeeting,
  VisionMeetingAttendance,
} from "@/db/schema/vision-meetings";

// Re-export enum arrays for use in components
export {
  attendanceTypes,
  checklistCategories,
  invitationStatuses,
  meetingStatuses,
  responseStatuses,
} from "@/db/schema/vision-meetings";

// ============================================================================
// Extended Types
// ============================================================================

import type {
  Location,
  VisionMeeting,
  VisionMeetingAttendance,
} from "@/db/schema/vision-meetings";

/**
 * Meeting with attendance counts for list views
 */
export type MeetingWithCounts = VisionMeeting & {
  totalAttendees: number;
  newAttendees: number;
  returningAttendees: number;
  location: Location | null;
};

/**
 * Attendance record with person details joined
 */
export type AttendanceWithPerson = VisionMeetingAttendance & {
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

/**
 * Options for listing meetings
 */
export type ListMeetingsOptions = {
  status?: "upcoming" | "past" | "all";
  meetingStatus?: string;
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
  meetingNumber: number;
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
 * Server action result type (reuse from people pattern)
 */
export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };
