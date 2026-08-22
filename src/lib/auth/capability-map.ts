/**
 * WHICH CAPABILITY EVERY ENDPOINT WAS GUARDED WITH — checked in, asserted
 * exactly.
 *
 * The walk above proves a guard is CALLED and called first. It cannot prove the
 * guard was called with the right capability, and that is where this change is
 * easiest to get wrong: `requireSeat("read")` on a write compiles, passes the
 * export-walk, and silently hands the whole people directory to a Member. #498's
 * review found three such rows — the five church-wide ministry-team writes and
 * the meeting RSVP sitting on a `SEATED` capability whose subject half could not
 * be checked, and `previewImportAction` reading an uploaded file under `"read"`.
 *
 * With the mapping checked in, none of those is a judgement call a reviewer has
 * to make by opening 30 action modules: a wrong capability is a DIFF, in one
 * file, beside the endpoint it belongs to. Adding an endpoint means adding a
 * line here and saying out loud who may call it.
 */
export const CAPABILITY_BY_EXPORT: Readonly<Record<string, string>> = {
  "src/app/(dashboard)/communication/actions.ts → createTemplateAction":
    "communication.send",
  "src/app/(dashboard)/communication/actions.ts → deleteTemplateAction":
    "communication.send",
  "src/app/(dashboard)/communication/actions.ts → forkTemplateAction":
    "communication.send",
  "src/app/(dashboard)/communication/actions.ts → getTemplatesAction": "read",
  "src/app/(dashboard)/communication/actions.ts → resendToNonOpenersAction":
    "communication.send",
  "src/app/(dashboard)/communication/actions.ts → resolveGroupAction": "read",
  "src/app/(dashboard)/communication/actions.ts → searchPeopleAction": "read",
  "src/app/(dashboard)/communication/actions.ts → sendMessageAction":
    "communication.send",
  "src/app/(dashboard)/communication/actions.ts → updateTemplateAction":
    "communication.send",
  "src/app/(dashboard)/dashboard/actions.ts → completeOnboarding":
    "church.create",
  "src/app/(dashboard)/dashboard/actions.ts → confirmLeadership":
    "church.claim",
  "src/app/(dashboard)/dashboard/actions.ts → createChurchBasics":
    "church.create",
  "src/app/(dashboard)/dashboard/actions.ts → declareJourney": "church.create",
  "src/app/(dashboard)/documents/actions.ts → getGeneratedDocumentDownloadUrlAction":
    "read",
  "src/app/(dashboard)/feedback/actions.ts → submitFeedbackAction":
    "self.write",
  "src/app/(dashboard)/launch/actions.ts → completeMilestoneAction":
    "launch.milestone",
  "src/app/(dashboard)/launch/actions.ts → recordLaunchOutcomeAction":
    "launch.schedule",
  "src/app/(dashboard)/launch/actions.ts → reopenMilestoneAction":
    "launch.milestone",
  "src/app/(dashboard)/launch/actions.ts → scheduleLaunchAction":
    "launch.schedule",
  "src/app/(dashboard)/launch/actions.ts → setLaunchTaskCompleteAction":
    "launch.milestone",
  "src/app/(dashboard)/launch/actions.ts → updateLaunchOutcomeAction":
    "launch.schedule",
  "src/app/(dashboard)/meetings/actions.ts → addAttendeeAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → addAttendeeNoteAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → addToGuestListAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → addWalkInAttendeeAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → clearResponseCardAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → createEvaluationAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → createLocationAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → createMeetingAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → deleteMeetingAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → finalizeAttendanceAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → quickAddAttendeeAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → quickAddPersonToGuestListAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → quickAddWalkInAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → recordAttendanceBatchAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → recordResponseCardAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → removeAttendeeAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → removeFromGuestListAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → saveAgendaAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → toggleAttendanceStatusAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → toggleChecklistItemAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → updateChecklistItemAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → updateLocationAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → updateMeetingAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → updateMeetingStatusAction":
    "meetings.write",
  "src/app/(dashboard)/meetings/actions.ts → updateRsvpStatusAction":
    "meetings.write",
  "src/app/(dashboard)/notifications/actions.ts → loadMoreNotificationsAction":
    "read",
  "src/app/(dashboard)/notifications/actions.ts → markAllNotificationsReadAction":
    "self.write",
  "src/app/(dashboard)/notifications/actions.ts → markNotificationReadAction":
    "self.write",
  "src/app/(dashboard)/oversight/invitations/actions.ts → createInvitationAction":
    "org.invitation.manage",
  "src/app/(dashboard)/oversight/invitations/actions.ts → resendInvitationEmailAction":
    "org.invitation.manage",
  "src/app/(dashboard)/oversight/invitations/actions.ts → revokeInvitationAction":
    "org.invitation.manage",
  "src/app/(dashboard)/oversight/plants/[id]/actions.ts → removePlantFromOrg":
    "org.association.sever",
  "src/app/(dashboard)/people/actions.ts → changeStatusAction": "people.write",
  "src/app/(dashboard)/people/actions.ts → changeStatusWithReasonAction":
    "people.write",
  "src/app/(dashboard)/people/actions.ts → checkForDuplicatesAction": "read",
  "src/app/(dashboard)/people/actions.ts → createPersonAction": "people.write",
  "src/app/(dashboard)/people/actions.ts → deletePersonAction": "people.write",
  "src/app/(dashboard)/people/actions.ts → loadMorePeopleAction": "read",
  "src/app/(dashboard)/people/actions.ts → quickAddPersonAction":
    "people.write",
  "src/app/(dashboard)/people/actions.ts → removePersonPhotoAction":
    "people.write",
  "src/app/(dashboard)/people/actions.ts → updatePersonAction": "people.write",
  "src/app/(dashboard)/people/actions.ts → uploadPersonPhotoAction":
    "people.write",
  "src/app/(dashboard)/people/activity-actions.ts → addNoteAction":
    "people.write",
  "src/app/(dashboard)/people/activity-actions.ts → editNoteAction":
    "people.write",
  "src/app/(dashboard)/people/activity-actions.ts → deleteNoteAction":
    "people.write",
  "src/app/(dashboard)/people/activity-actions.ts → getMoreActivitiesAction":
    "read",
  "src/app/(dashboard)/people/assessment-actions.ts → createAssessmentAction":
    "people.write",
  "src/app/(dashboard)/people/assessment-actions.ts → createCommitmentAction":
    "people.write",
  "src/app/(dashboard)/people/assessment-actions.ts → createInterviewAction":
    "people.write",
  "src/app/(dashboard)/people/assessment-actions.ts → getCommitmentDownloadUrlAction":
    "read",
  "src/app/(dashboard)/people/household-actions.ts → addToHouseholdAction":
    "people.write",
  "src/app/(dashboard)/people/household-actions.ts → createHouseholdWithHeadAction":
    "people.write",
  "src/app/(dashboard)/people/household-actions.ts → deleteHouseholdAction":
    "people.write",
  "src/app/(dashboard)/people/household-actions.ts → getHouseholdMembersAction":
    "read",
  "src/app/(dashboard)/people/household-actions.ts → listHouseholdsAction":
    "read",
  "src/app/(dashboard)/people/household-actions.ts → propagateAddressAction":
    "people.write",
  "src/app/(dashboard)/people/household-actions.ts → removeFromHouseholdAction":
    "people.write",
  "src/app/(dashboard)/people/household-actions.ts → updateHouseholdAction":
    "people.write",
  "src/app/(dashboard)/people/import-export-actions.ts → downloadCsvTemplateAction":
    "read",
  "src/app/(dashboard)/people/import-export-actions.ts → executeBulkImportAction":
    "people.write",
  "src/app/(dashboard)/people/import-export-actions.ts → exportPeopleAction":
    "read",
  "src/app/(dashboard)/people/import-export-actions.ts → previewImportAction":
    "people.write",
  "src/app/(dashboard)/people/pipeline-actions.ts → reorderPipelineAction":
    "people.write",
  "src/app/(dashboard)/people/skill-actions.ts → addSkillAction":
    "people.write",
  "src/app/(dashboard)/people/skill-actions.ts → getPersonSkillsAction": "read",
  "src/app/(dashboard)/people/skill-actions.ts → removeSkillAction":
    "people.write",
  "src/app/(dashboard)/people/skill-actions.ts → updateSkillAction":
    "people.write",
  "src/app/(dashboard)/people/tag-actions.ts → assignTagAction": "people.write",
  "src/app/(dashboard)/people/tag-actions.ts → createTagAction": "people.write",
  "src/app/(dashboard)/people/tag-actions.ts → deleteTagAction": "people.write",
  "src/app/(dashboard)/people/tag-actions.ts → listTagsAction": "read",
  "src/app/(dashboard)/people/tag-actions.ts → removeTagAction": "people.write",
  "src/app/(dashboard)/people/tag-actions.ts → updateTagAction": "people.write",
  "src/app/(dashboard)/phase/checkin-actions.ts → saveCheckinAction":
    "phase.signal",
  "src/app/(dashboard)/phase/actions.ts → transitionPhaseAction":
    "phase.declare",
  "src/app/(dashboard)/phase/feedback-actions.ts → submitInsightFeedbackAction":
    "self.write",
  "src/app/(dashboard)/phase/signals-actions.ts → setManualSignalAction":
    "phase.signal",
  "src/app/(dashboard)/settings/account/actions.ts → changePasswordAction":
    "self.write",
  "src/app/(dashboard)/settings/account/actions.ts → confirmEmailChangeAction":
    "self.write",
  "src/app/(dashboard)/settings/account/actions.ts → removeAvatarAction":
    "self.write",
  "src/app/(dashboard)/settings/account/actions.ts → requestEmailChangeAction":
    "self.write",
  "src/app/(dashboard)/settings/account/actions.ts → uploadAvatarAction":
    "self.write",
  "src/app/(dashboard)/settings/actions.ts → clearMyEmailSuppressionAction":
    "self.write",
  "src/app/(dashboard)/settings/actions.ts → setChurchDigestScheduleAction":
    "church.profile",
  "src/app/(dashboard)/settings/actions.ts → setChurchInactivityThresholdsAction":
    "church.profile",
  "src/app/(dashboard)/settings/actions.ts → setChurchProfileFieldAction":
    "church.profile",
  "src/app/(dashboard)/settings/actions.ts → setChurchTimeZoneAction":
    "church.profile",
  "src/app/(dashboard)/settings/actions.ts → setDigestCadenceAction":
    "self.write",
  "src/app/(dashboard)/settings/actions.ts → setNotificationPreferenceAction":
    "self.write",
  "src/app/(dashboard)/settings/association/actions.ts → acceptAssociationInvitation":
    "association.answer",
  "src/app/(dashboard)/settings/association/actions.ts → declineAssociationInvitation":
    "association.answer",
  "src/app/(dashboard)/settings/association/actions.ts → leaveNetwork":
    "org.association.leave",
  "src/app/(dashboard)/settings/association/actions.ts → leaveOversightOrg":
    "association.leave",
  "src/app/(dashboard)/settings/sharing/actions.ts → setOversightSharingAction":
    "sharing.toggle",
  "src/app/(dashboard)/settings/team/actions.ts → appointAdminAction":
    "seat.manage",
  "src/app/(auth)/coach-invitation/actions.ts → acceptCoachInvitationAction":
    "coach.invitation.answer",
  "src/app/(dashboard)/settings/team/actions.ts → createCoachInvitationAction":
    "coach.assignment.manage",
  "src/app/(dashboard)/settings/team/actions.ts → createSeatInvitationAction":
    "seat.invitation.manage",
  "src/app/(dashboard)/settings/team/actions.ts → demoteToMemberAction":
    "seat.manage",
  "src/app/(dashboard)/settings/team/actions.ts → endCoachAssignmentAction":
    "coach.assignment.manage",
  "src/app/(dashboard)/settings/team/actions.ts → removeSeatAction":
    "seat.manage",
  "src/app/(dashboard)/settings/team/actions.ts → resendSeatInvitationEmailAction":
    "seat.invitation.manage",
  "src/app/(dashboard)/settings/team/actions.ts → revokeSeatInvitationAction":
    "seat.invitation.manage",
  "src/app/(dashboard)/tasks/actions.ts → addSubtaskAction": "tasks.own",
  "src/app/(dashboard)/tasks/actions.ts → bulkCompleteTasksAction": "tasks.own",
  "src/app/(dashboard)/tasks/actions.ts → bulkRescheduleTasksAction":
    "tasks.write",
  "src/app/(dashboard)/tasks/actions.ts → completeTaskAction": "tasks.own",
  "src/app/(dashboard)/tasks/actions.ts → createTaskAction": "tasks.write",
  "src/app/(dashboard)/tasks/actions.ts → deleteTaskAction": "tasks.write",
  "src/app/(dashboard)/tasks/actions.ts → importTaskTemplateAction":
    "tasks.write",
  "src/app/(dashboard)/tasks/actions.ts → loadMoreTasksAction": "read",
  "src/app/(dashboard)/tasks/actions.ts → quickAddTaskAction": "tasks.write",
  "src/app/(dashboard)/tasks/actions.ts → reopenTaskAction": "tasks.own",
  "src/app/(dashboard)/tasks/actions.ts → setSubtaskCompletionAction":
    "tasks.own",
  "src/app/(dashboard)/tasks/actions.ts → updateTaskAction": "tasks.write",
  "src/app/(dashboard)/tasks/actions.ts → updateTaskStatusAction": "tasks.own",
  "src/app/(dashboard)/tasks/follow-up-actions.ts → assignFollowUpAction":
    "tasks.write",
  "src/app/(dashboard)/tasks/follow-up-actions.ts → createAndAssignFollowUpAction":
    "tasks.write",
  "src/app/(dashboard)/tasks/follow-up-actions.ts → handOffFollowUpsAction":
    "tasks.write",
  "src/app/(dashboard)/tasks/phase-prompt-actions.ts → dismissPhaseTemplatePromptAction":
    "phase.signal",
  "src/app/(dashboard)/tasks/phase-prompt-actions.ts → importPhaseTemplatesAction":
    "tasks.write",
  "src/app/(dashboard)/teams/actions.ts → assignMemberAction": "teams.write",
  "src/app/(dashboard)/teams/actions.ts → assignTeamLeaderAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → createMeetingAction": "teams.write",
  "src/app/(dashboard)/teams/actions.ts → createResponsibilityAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → createRoleAction": "teams.write",
  "src/app/(dashboard)/teams/actions.ts → createTeamAction": "teams.write",
  "src/app/(dashboard)/teams/actions.ts → createTrainingProgramAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → deleteResponsibilityAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → deleteRoleAction": "teams.write",
  "src/app/(dashboard)/teams/actions.ts → importRoleTemplatesAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → initializeTeamsAction": "teams.write",
  "src/app/(dashboard)/teams/actions.ts → initializeTeamsWithRolesAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → listTeamsAction": "read",
  "src/app/(dashboard)/teams/actions.ts → markTrainingCompleteAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → removeMemberAction": "teams.write",
  "src/app/(dashboard)/teams/actions.ts → searchTeamCandidatesAction": "read",
  "src/app/(dashboard)/teams/actions.ts → setResponsibilityCompleteAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → updateResponsibilityAction":
    "teams.write",
  "src/app/(dashboard)/teams/actions.ts → updateRoleAction": "teams.write",
  "src/app/(dashboard)/teams/actions.ts → updateTeamAction": "teams.write",
  "src/app/(dashboard)/wiki/actions.ts → searchWikiArticles": "read",
  "src/app/(dashboard)/wiki/actions.ts → submitArticleFeedbackAction":
    "self.write",
  "src/lib/invitations/service.ts → acceptInvitation": "association.answer",
  "src/lib/invitations/service.ts → createInvitation": "org.invitation.manage",
  "src/lib/invitations/service.ts → declineInvitation": "association.answer",
  "src/lib/invitations/service.ts → resendInvitationEmail":
    "org.invitation.manage",
  "src/lib/invitations/service.ts → revokeInvitation": "org.invitation.manage",
  "src/lib/wiki/bookmarks.ts → toggleBookmark": "self.write",
  "src/lib/wiki/progress.ts → recordView": "self.write",
  "src/lib/wiki/progress.ts → updateProgress": "self.write",
};
