"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useHeader } from "@/components/header/header-context";
import { AuthenticatedNavigationIntentProvider } from "@/components/authenticated-navigation";

import type { PublicEvryConversation } from "./client-contract";
import {
  beginEvryConversationLoad,
  canApplyEvryConversationLoadResponse,
  cancelEvryConversationLoads,
  evryConversationRequestBody,
  evryConversationSubmissionEndpoint,
  evryDraftAfterSubmission,
  evrySubmissionMessage,
  finishEvryConversationLoad,
  initialEvryConversationLoadState,
  isEvryConversationLoading,
  isLatestEvryConversationLoad,
  pendingEvrySubmissionFor,
  pendingEvrySubmissionAfterConversation,
  type PendingEvrySubmission,
} from "./interaction-state";
import {
  evryPeopleFilePlanBody,
  pendingPeopleFileSubmissionFor,
  preparedEvryPeopleFileFromStage,
  type PendingPeopleFileSubmission,
  type PreparedEvryPeopleFile,
} from "./people-file-state";
import {
  visibleEvryPageContextFor,
  type VisibleEvryPageContext,
} from "./page-context";
import { evrySuggestionsForPathname } from "./suggestions/pathname";
import type { EligibleEvrySuggestion } from "./suggestions/types";
import { evryWorkStateForConversation } from "./streaming/conversation-state";
import type { EvryAcknowledgementTarget } from "./streaming/work-status";
import {
  EvryConversationStreamFailure,
  evryWorkStateForStreamEvent,
  readEvryConversationStream,
} from "@/lib/evry/streaming/conversation-wire";
import {
  applyEvrySequencedWork,
  beginEvrySequencedWork,
  type EvrySequencedWorkState,
  type EvryWorkState,
} from "@/lib/evry/streaming/state";
import {
  bindEvryRunRecoveryConversation,
  clearEvryRunRecoveryMarker,
  markerMatchesEvryLocation,
  readEvryRunRecoveryMarker,
  reconnectEvryRun,
  isEvryRecipeReuseRecoveryMarker,
  writeEvryRunRecoveryMarker,
  type EvryRecipeReuseRecoveryMarker,
  type EvryRunRecoveryMarker,
} from "./streaming/run-recovery";
import { requestEvryRecipeReuse } from "./artifacts/reuse-request";

const EvryPanel = dynamic(() =>
  import("./evry-panel").then((module) => module.EvryPanel)
);

type EvryShellValue = Readonly<{
  activeContext: VisibleEvryPageContext | null;
  acknowledgement: EvryAcknowledgementTarget | null;
  applyWorkConversation: (
    requestId: string,
    sequence: number,
    conversation: PublicEvryConversation
  ) => boolean;
  beginWork: (requestId: string, state: EvryWorkState) => void;
  canStopWatching: boolean;
  clearContext: () => void;
  closePanel: () => void;
  conversation: PublicEvryConversation | null;
  draft: string;
  error: string | null;
  expandToWorkspace: () => void;
  finishWork: (requestId: string, sequence: number) => boolean;
  isEnabled: boolean;
  isComposerBlocked: boolean;
  isLoading: boolean;
  isPanelOpen: boolean;
  isSending: boolean;
  isWorking: boolean;
  isWatchingDetached: boolean;
  loadConversation: (conversationId: string) => Promise<void>;
  acknowledgeConversationMounted: (conversationId: string | null) => void;
  startRecipeReuse: (input: {
    sourceConversationId: string;
    resultArtifactId: string;
    recipeIdentity: string;
  }) => Promise<"started" | "unavailable">;
  openPanel: (trigger: HTMLButtonElement) => void;
  observeWork: (requestId: string, controller: AbortController) => void;
  resetConversation: () => void;
  restoreLauncherFocus: () => void;
  resumeWatching: () => void;
  returnToPage: () => void;
  sendMessage: () => Promise<void>;
  setDraft: (draft: string) => void;
  stopWatching: () => void;
  updateWork: (
    requestId: string,
    sequence: number,
    state: EvryWorkState
  ) => boolean;
  suggestions: readonly EligibleEvrySuggestion[];
  submitPeopleFile: (
    input: EvryPeopleFileSubmission
  ) => Promise<EvryPeopleFileSubmissionResult>;
  workRequestId: string | null;
  workState: EvryWorkState;
}>;

export type EvryPeopleFileSubmission =
  | Readonly<{
      kind: "people_csv";
      file: File;
      prepared: PreparedEvryPeopleFile | null;
      duplicateResolutions: Readonly<
        Record<string, "skip" | "create" | "merge">
      > | null;
    }>
  | Readonly<{ kind: "person_photo"; file: File; personId: string }>
  | Readonly<{
      kind: "commitment_document";
      file: File;
      personId: string;
      commitmentType: "core_group" | "launch_team";
      signedDate: string;
      notes: string | null;
    }>;

export type EvryPeopleFileSubmissionResult =
  | Readonly<{ status: "submitted" }>
  | Readonly<{
      status: "needs_duplicate_resolution";
      prepared: PreparedEvryPeopleFile;
    }>
  | Readonly<{ status: "failed" }>;

const EvryShellContext = createContext<EvryShellValue | null>(null);

async function responseConversation(response: Response) {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error("Unable to update this conversation.");
  const { parseEvryConversationEnvelope } = await import("./client-contract");
  return parseEvryConversationEnvelope(body);
}

export function EvryShell({
  children,
  enabled,
  eligibleSuggestions,
}: {
  children: ReactNode;
  enabled: boolean;
  eligibleSuggestions: readonly EligibleEvrySuggestion[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locationSearch = searchParams.toString();
  const router = useRouter();
  const { replace: replaceRoute } = router;
  const { breadcrumbs } = useHeader();
  const visibleContext = useMemo(
    () => visibleEvryPageContextFor(pathname, breadcrumbs),
    [breadcrumbs, pathname]
  );
  const suggestions = useMemo(
    () => evrySuggestionsForPathname(pathname, eligibleSuggestions),
    [eligibleSuggestions, pathname]
  );
  const [activeContext, setActiveContext] =
    useState<VisibleEvryPageContext | null>(null);
  const [conversation, setConversation] =
    useState<PublicEvryConversation | null>(null);
  const [draft, setDraftState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [acknowledgement, setAcknowledgement] =
    useState<EvryAcknowledgementTarget | null>(null);
  const [sequencedWork, setSequencedWork] =
    useState<EvrySequencedWorkState | null>(null);
  const [pendingWorkRequestId, setPendingWorkRequestId] = useState<
    string | null
  >(null);
  const [detachedRequestId, setDetachedRequestId] = useState<string | null>(
    null
  );
  const [observedRequestId, setObservedRequestId] = useState<string | null>(
    null
  );
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [hasOpenedPanel, setHasOpenedPanel] = useState(false);
  const [isSending, setSending] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [requestedConversationId, setRequestedConversationId] = useState<
    string | null
  >(null);
  const [pendingRecipeReuse, setPendingRecipeReuse] =
    useState<EvryRecipeReuseRecoveryMarker | null>(null);
  const [pendingRouteDeparture, setPendingRouteDeparture] = useState(false);
  const [expandedFromPanel, setExpandedFromPanel] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const conversationLoadStateRef = useRef(initialEvryConversationLoadState());
  const conversationCacheRef = useRef(
    new Map<string, PublicEvryConversation>()
  );
  const pendingSubmissionRef = useRef<PendingEvrySubmission | null>(null);
  const pendingPeopleFileRef = useRef<PendingPeopleFileSubmission | null>(null);
  const pendingRecipeReuseRef = useRef(pendingRecipeReuse);
  const pendingRouteDepartureRef = useRef<Readonly<{
    pathname: string;
    search: string;
  }> | null>(null);
  const navigationHrefFenceRef = useRef<(href: string) => void>(() => {});
  const mountedConversationIdRef = useRef<string | null>(null);
  const sequencedWorkRef = useRef<EvrySequencedWorkState | null>(null);
  const pendingWorkRequestIdRef = useRef<string | null>(null);
  const workAbortRef = useRef<Readonly<{
    requestId: string;
    controller: AbortController;
  }> | null>(null);
  const intentionallyDetachedRef = useRef(new Set<string>());
  const previousPathnameRef = useRef(pathname);
  const routeLocation = useMemo(
    () => ({
      pathname,
      search: locationSearch.length === 0 ? "" : `?${locationSearch}`,
    }),
    [locationSearch, pathname]
  );
  const routeLocationRef = useRef(routeLocation);
  routeLocationRef.current = routeLocation;
  const draftRef = useRef(draft);
  const isWorking =
    pendingWorkRequestId !== null ||
    detachedRequestId !== null ||
    pendingRecipeReuse !== null ||
    pendingRouteDeparture;

  const setDraft = useCallback((nextDraft: string) => {
    draftRef.current = nextDraft;
    setDraftState(nextDraft);
  }, []);

  const presentWork = useCallback((requestId: string, state: EvryWorkState) => {
    const next = beginEvrySequencedWork(requestId, state);
    sequencedWorkRef.current = next;
    setSequencedWork(next);
  }, []);

  const beginWork = useCallback(
    (requestId: string, state: EvryWorkState) => {
      setAcknowledgement((current) =>
        current?.requestId === requestId ? current : null
      );
      setDetachedRequestId(null);
      presentWork(requestId, state);
      pendingWorkRequestIdRef.current = requestId;
      setPendingWorkRequestId(requestId);
    },
    [presentWork]
  );

  const updateWork = useCallback(
    (requestId: string, sequence: number, state: EvryWorkState) => {
      const current = sequencedWorkRef.current;
      if (!current) return false;
      const next = applyEvrySequencedWork(current, {
        requestId,
        sequence,
        state,
      });
      if (next === current) return false;
      sequencedWorkRef.current = next;
      setSequencedWork(next);
      return true;
    },
    []
  );

  const settleWork = useCallback(
    (requestId: string, sequence: number, state: EvryWorkState) => {
      const current = sequencedWorkRef.current;
      if (!current || pendingWorkRequestIdRef.current !== requestId) {
        return false;
      }
      const next = applyEvrySequencedWork(current, {
        requestId,
        sequence,
        state,
      });
      if (next === current) return false;
      sequencedWorkRef.current = next;
      pendingWorkRequestIdRef.current = null;
      if (workAbortRef.current?.requestId === requestId) {
        workAbortRef.current = null;
        setObservedRequestId(null);
      }
      setSequencedWork(next);
      setPendingWorkRequestId(null);
      return true;
    },
    []
  );

  const finishWork = useCallback(
    (requestId: string, sequence: number) => {
      const current = sequencedWorkRef.current;
      return current ? settleWork(requestId, sequence, current.state) : false;
    },
    [settleWork]
  );

  const clearWork = useCallback(() => {
    sequencedWorkRef.current = null;
    pendingWorkRequestIdRef.current = null;
    setSequencedWork(null);
    setPendingWorkRequestId(null);
    setDetachedRequestId(null);
    setObservedRequestId(null);
  }, []);

  const applyWorkConversation = useCallback(
    (
      requestId: string,
      sequence: number,
      nextConversation: PublicEvryConversation
    ) => {
      if (
        !updateWork(
          requestId,
          sequence,
          evryWorkStateForConversation(nextConversation)
        )
      ) {
        return false;
      }
      setConversation(nextConversation);
      setError(null);
      return true;
    },
    [updateWork]
  );

  const settleWorkConversation = useCallback(
    (
      requestId: string,
      sequence: number,
      nextConversation: PublicEvryConversation
    ) => {
      if (
        !settleWork(
          requestId,
          sequence,
          evryWorkStateForConversation(nextConversation)
        )
      ) {
        return false;
      }
      setConversation(nextConversation);
      setError(null);
      return true;
    },
    [settleWork]
  );

  const observeWith = useCallback(
    (requestId: string, controller: AbortController) => {
      workAbortRef.current?.controller.abort();
      workAbortRef.current = { requestId, controller };
      setObservedRequestId(requestId);
      intentionallyDetachedRef.current.delete(requestId);
    },
    []
  );

  const recoveryState = useCallback(
    (marker: EvryRunRecoveryMarker, stage: string): EvryWorkState => {
      if (marker.kind === "execution" || stage === "executing") {
        return {
          phase: "execution",
          message: "Reconnected to the same confirmed plan attempt",
        };
      }
      return stage === "accepted"
        ? { phase: "reading", message: "Reconnected to the same request" }
        : {
            phase: "planning",
            message: "Reconnected to the same request and latest progress",
          };
    },
    []
  );

  const pauseRecoveryForRoute = useCallback(
    (requestId: string) => {
      const observation = workAbortRef.current;
      if (observation?.requestId === requestId) {
        intentionallyDetachedRef.current.add(requestId);
        observation.controller.abort();
        workAbortRef.current = null;
        setObservedRequestId(null);
      }
      if (pendingWorkRequestIdRef.current === requestId) {
        const sequence = (sequencedWorkRef.current?.sequence ?? 0) + 1;
        updateWork(requestId, sequence, {
          phase: "complete",
          message:
            "Stopped watching while another conversation is open. Return here to reconnect.",
        });
        finishWork(requestId, sequence + 1);
      }
      setDetachedRequestId((current) =>
        current === requestId ? null : current
      );
    },
    [finishWork, updateWork]
  );

  const recoverMarker = useCallback(
    async (marker: EvryRunRecoveryMarker) => {
      if (!markerMatchesEvryLocation(marker, routeLocationRef.current)) return;
      const controller = new AbortController();
      observeWith(marker.requestId, controller);
      beginWork(marker.requestId, recoveryState(marker, "accepted"));
      try {
        const recovered = await reconnectEvryRun({
          marker,
          signal: controller.signal,
          onActive(snapshot) {
            if (snapshot.conversationId) {
              bindEvryRunRecoveryConversation(
                marker.requestId,
                snapshot.conversationId
              );
            }
            updateWork(
              marker.requestId,
              snapshot.sequence,
              recoveryState(marker, snapshot.stage)
            );
          },
        });
        if (controller.signal.aborted) return;
        if (
          readEvryRunRecoveryMarker()?.requestId !== marker.requestId ||
          !markerMatchesEvryLocation(marker, routeLocationRef.current)
        ) {
          pauseRecoveryForRoute(marker.requestId);
          return;
        }
        if (recovered.status === "durable") {
          bindEvryRunRecoveryConversation(
            marker.requestId,
            recovered.conversation.id
          );
          settleWorkConversation(
            marker.requestId,
            recovered.sequence,
            recovered.conversation
          );
          clearEvryRunRecoveryMarker(marker.requestId);
          setDetachedRequestId(null);
          return;
        }
        const terminalSequence =
          "sequence" in recovered
            ? recovered.sequence
            : (sequencedWorkRef.current?.sequence ?? 0) + 1;
        settleWork(marker.requestId, terminalSequence, {
          phase: recovered.status === "expired" ? "blocked" : "failed",
          message:
            recovered.status === "expired"
              ? "This run expired. Durable conversation state is shown; retry only from its available controls."
              : "This run is no longer available. Durable conversation state was not changed.",
        });
        clearEvryRunRecoveryMarker(marker.requestId);
        setDetachedRequestId(null);
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const failureSequence = (sequencedWorkRef.current?.sequence ?? 0) + 1;
        settleWork(marker.requestId, failureSequence, {
          phase: "failed",
          message:
            "Unable to reconnect right now. The durable run was not cancelled.",
        });
        setDetachedRequestId(marker.requestId);
      } finally {
        if (
          workAbortRef.current?.requestId === marker.requestId &&
          workAbortRef.current.controller === controller
        ) {
          workAbortRef.current = null;
          setObservedRequestId(null);
        }
      }
    },
    [
      beginWork,
      observeWith,
      pauseRecoveryForRoute,
      recoveryState,
      settleWork,
      settleWorkConversation,
      updateWork,
    ]
  );

  const stopWatching = useCallback(() => {
    const observation = workAbortRef.current;
    const requestId = pendingWorkRequestIdRef.current;
    if (!requestId || observation?.requestId !== requestId) return;
    intentionallyDetachedRef.current.add(requestId);
    observation.controller.abort();
    workAbortRef.current = null;
    setObservedRequestId(null);
    const sequence = (sequencedWorkRef.current?.sequence ?? 0) + 1;
    updateWork(requestId, sequence, {
      phase: "complete",
      message:
        "Stopped watching. The same run continues safely; reconnect to see its progress.",
    });
    finishWork(requestId, sequence + 1);
    setDetachedRequestId(requestId);
  }, [finishWork, updateWork]);

  useEffect(() => {
    if (!enabled) return;
    const marker = readEvryRunRecoveryMarker();
    if (!marker) return;
    if (isEvryRecipeReuseRecoveryMarker(marker)) return;
    if (!markerMatchesEvryLocation(marker, routeLocation)) {
      pauseRecoveryForRoute(marker.requestId);
      return;
    }
    void recoverMarker(marker);
    return () => {
      if (workAbortRef.current?.requestId === marker.requestId) {
        workAbortRef.current.controller.abort();
      }
    };
  }, [enabled, pauseRecoveryForRoute, recoverMarker, routeLocation]);

  const cancelActiveConversationLoads = useCallback(() => {
    conversationLoadStateRef.current = cancelEvryConversationLoads(
      conversationLoadStateRef.current
    );
    setLoading(false);
    setRequestedConversationId(null);
    setError(null);
  }, []);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (previousPathname === "/evry" && pathname !== "/evry") {
      cancelActiveConversationLoads();
      if (expandedFromPanel) {
        setExpandedFromPanel(false);
        setPanelOpen(true);
      }
    }
  }, [cancelActiveConversationLoads, expandedFromPanel, pathname]);

  const openPanel = useCallback(
    (trigger: HTMLButtonElement) => {
      launcherRef.current = trigger;
      if (pathname === "/evry") {
        document.getElementById("evry-message")?.focus();
        return;
      }
      setActiveContext(visibleContext);
      setError(null);
      setHasOpenedPanel(true);
      setPanelOpen(true);
    },
    [pathname, visibleContext]
  );

  const closePanel = useCallback(() => setPanelOpen(false), []);
  const restoreLauncherFocus = useCallback(
    () => launcherRef.current?.focus(),
    []
  );

  const expandToWorkspace = useCallback(() => {
    setExpandedFromPanel(true);
    setPanelOpen(false);
    const query = conversation ? `?conversation=${conversation.id}` : "";
    const href = `/evry${query}`;
    navigationHrefFenceRef.current(href);
    router.push(href);
  }, [conversation, router]);

  const returnToPage = useCallback(() => {
    if (expandedFromPanel) {
      cancelActiveConversationLoads();
      setExpandedFromPanel(false);
      setPanelOpen(true);
      router.back();
      return;
    }
    navigationHrefFenceRef.current("/dashboard");
    router.push("/dashboard");
  }, [cancelActiveConversationLoads, expandedFromPanel, router]);

  const clearPendingRecipeReuse = useCallback(
    (requestId: string, sequence: number) => {
      const current = pendingRecipeReuseRef.current;
      if (!current || current.requestId !== requestId) return;
      clearEvryRunRecoveryMarker(requestId);
      pendingRecipeReuseRef.current = null;
      setPendingRecipeReuse(null);
      finishWork(requestId, sequence);
    },
    [finishWork]
  );

  const fenceRecipeReuseForNavigationIntent = useCallback(() => {
    const marker = pendingRecipeReuseRef.current;
    if (!marker) return;
    pendingRouteDepartureRef.current = marker.sourceLocation;
    setPendingRouteDeparture(true);
    if (workAbortRef.current?.requestId === marker.requestId) {
      workAbortRef.current.controller.abort();
    }
    clearPendingRecipeReuse(marker.requestId, 2);
  }, [clearPendingRecipeReuse]);

  const fenceRecipeReuseForHref = useCallback(
    (href: string) => {
      const marker = pendingRecipeReuseRef.current;
      if (!marker) return;
      const origin =
        typeof window.location?.origin === "string"
          ? window.location.origin
          : "https://everyfield.invalid";
      try {
        const source = new URL(
          `${marker.sourceLocation.pathname}${marker.sourceLocation.search}`,
          origin
        );
        const destination = new URL(href, source);
        if (
          destination.origin === source.origin &&
          destination.pathname === source.pathname &&
          destination.search === source.search
        ) {
          return;
        }
      } catch {
        // Let Next own validation, but revoke reuse ownership for an opaque
        // destination before it can enqueue any route action.
      }
      fenceRecipeReuseForNavigationIntent();
    },
    [fenceRecipeReuseForNavigationIntent]
  );
  useEffect(() => {
    navigationHrefFenceRef.current = fenceRecipeReuseForHref;
  }, [fenceRecipeReuseForHref]);

  const navigationRouter = useMemo<AppRouterInstance>(
    () => ({
      back: router.back,
      forward: router.forward,
      refresh: router.refresh,
      prefetch: router.prefetch,
      bfcacheId: router.bfcacheId,
      push: (href, options) => {
        fenceRecipeReuseForHref(href);
        router.push(href, options);
      },
      replace: (href, options) => {
        fenceRecipeReuseForHref(href);
        replaceRoute(href, options);
      },
      experimental_gesturePush: router.experimental_gesturePush
        ? (href, options) => {
            fenceRecipeReuseForHref(href);
            router.experimental_gesturePush?.(href, options);
          }
        : undefined,
    }),
    [fenceRecipeReuseForHref, replaceRoute, router]
  );

  useEffect(() => {
    if (
      !enabled ||
      typeof window === "undefined" ||
      typeof window.addEventListener !== "function"
    )
      return;
    const historyNavigation = () => {
      const pending = pendingRecipeReuseRef.current;
      if (!pending) return;
      if (
        window.location.pathname !== pending.sourceLocation.pathname ||
        window.location.search !== pending.sourceLocation.search
      ) {
        fenceRecipeReuseForNavigationIntent();
      }
    };
    window.addEventListener("popstate", historyNavigation);
    return () => window.removeEventListener("popstate", historyNavigation);
  }, [enabled, fenceRecipeReuseForNavigationIntent]);

  useEffect(() => {
    const pending = pendingRouteDepartureRef.current;
    if (!pending) return;
    if (
      routeLocation.pathname !== pending.pathname ||
      routeLocation.search !== pending.search
    ) {
      pendingRouteDepartureRef.current = null;
      setPendingRouteDeparture(false);
    }
  }, [routeLocation]);

  const presentRecipeReuseDestination = useCallback(
    (
      marker: EvryRecipeReuseRecoveryMarker,
      nextConversation: PublicEvryConversation
    ) => {
      const current = pendingRecipeReuseRef.current;
      if (
        !current ||
        current.requestId !== marker.requestId ||
        !markerMatchesEvryLocation(current, routeLocationRef.current)
      ) {
        return false;
      }
      const bound = Object.freeze({
        ...current,
        conversationId: nextConversation.id,
      });
      bindEvryRunRecoveryConversation(marker.requestId, nextConversation.id);
      pendingRecipeReuseRef.current = bound;
      setPendingRecipeReuse(bound);
      cancelActiveConversationLoads();
      if (!applyWorkConversation(marker.requestId, 1, nextConversation)) {
        return false;
      }
      if (bound.sourceLocation.pathname === "/evry") {
        const next = new URLSearchParams(bound.sourceLocation.search);
        next.delete("new");
        next.set("conversation", nextConversation.id);
        router.push(`/evry?${next.toString()}`);
      }
      return true;
    },
    [applyWorkConversation, cancelActiveConversationLoads, router]
  );

  const runRecipeReuse = useCallback(
    async (marker: EvryRecipeReuseRecoveryMarker) => {
      const controller = new AbortController();
      observeWith(marker.requestId, controller);
      beginWork(marker.requestId, {
        phase: "reading",
        message: "Refreshing this recipe from current application data",
      });
      try {
        const result = await requestEvryRecipeReuse({
          marker,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return "unavailable" as const;
        if (
          result.status !== "conversation" ||
          !presentRecipeReuseDestination(marker, result.conversation)
        ) {
          clearPendingRecipeReuse(marker.requestId, 2);
          return "unavailable" as const;
        }
        return "started" as const;
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return "unavailable" as const;
        }
        updateWork(marker.requestId, 1, {
          phase: "failed",
          message:
            "Unable to reconnect right now. The exact reuse request is retained.",
        });
        setDetachedRequestId(marker.requestId);
        return "started" as const;
      } finally {
        if (workAbortRef.current?.controller === controller) {
          workAbortRef.current = null;
          setObservedRequestId(null);
        }
      }
    },
    [
      beginWork,
      clearPendingRecipeReuse,
      observeWith,
      presentRecipeReuseDestination,
      updateWork,
    ]
  );

  const resumeWatching = useCallback(() => {
    const marker = readEvryRunRecoveryMarker();
    if (!marker || marker.requestId !== detachedRequestId) return;
    document.getElementById("evry-work-status")?.focus();
    setDetachedRequestId(null);
    if (isEvryRecipeReuseRecoveryMarker(marker)) {
      void runRecipeReuse(marker);
      return;
    }
    void recoverMarker(marker);
  }, [detachedRequestId, recoverMarker, runRecipeReuse]);

  const startRecipeReuse = useCallback(
    async (input: {
      sourceConversationId: string;
      resultArtifactId: string;
      recipeIdentity: string;
    }) => {
      if (
        pendingRecipeReuseRef.current ||
        pendingRouteDepartureRef.current ||
        pendingWorkRequestIdRef.current ||
        detachedRequestId !== null
      ) {
        return "unavailable" as const;
      }
      const marker: EvryRecipeReuseRecoveryMarker = Object.freeze({
        version: 2,
        requestId: crypto.randomUUID(),
        kind: "conversation",
        operation: "reuse",
        conversationId: null,
        ...input,
        sourceLocation: routeLocationRef.current,
      });
      writeEvryRunRecoveryMarker(marker);
      pendingRecipeReuseRef.current = marker;
      setPendingRecipeReuse(marker);
      return runRecipeReuse(marker);
    },
    [detachedRequestId, runRecipeReuse]
  );

  const acknowledgeConversationMounted = useCallback(
    (conversationId: string | null) => {
      mountedConversationIdRef.current = conversationId;
      if (conversationId === null) return;
      const marker = pendingRecipeReuseRef.current;
      if (!marker || marker.conversationId !== conversationId) return;
      if (marker.sourceLocation.pathname === "/evry") {
        if (
          routeLocationRef.current.pathname !== "/evry" ||
          new URLSearchParams(routeLocationRef.current.search).get(
            "conversation"
          ) !== conversationId
        ) {
          return;
        }
      } else if (
        routeLocationRef.current.pathname !== marker.sourceLocation.pathname ||
        routeLocationRef.current.search !== marker.sourceLocation.search
      ) {
        return;
      }
      clearPendingRecipeReuse(marker.requestId, 2);
    },
    [clearPendingRecipeReuse]
  );

  useEffect(() => {
    if (!enabled) return;
    const stored = readEvryRunRecoveryMarker();
    if (!stored || !isEvryRecipeReuseRecoveryMarker(stored)) return;
    if (!markerMatchesEvryLocation(stored, routeLocation)) {
      if (workAbortRef.current?.requestId === stored.requestId) {
        workAbortRef.current.controller.abort();
      }
      clearPendingRecipeReuse(stored.requestId, 2);
      return;
    }
    if (
      stored.conversationId !== null &&
      mountedConversationIdRef.current === stored.conversationId &&
      routeLocation.pathname === "/evry" &&
      new URLSearchParams(routeLocation.search).get("conversation") ===
        stored.conversationId
    ) {
      clearPendingRecipeReuse(stored.requestId, 2);
      return;
    }
    const current = pendingRecipeReuseRef.current;
    if (
      current?.requestId !== stored.requestId ||
      current.conversationId !== stored.conversationId
    ) {
      pendingRecipeReuseRef.current = stored;
      setPendingRecipeReuse(stored);
    }
    if (
      stored.conversationId === null &&
      workAbortRef.current?.requestId !== stored.requestId
    ) {
      void runRecipeReuse(stored);
    }
  }, [clearPendingRecipeReuse, enabled, routeLocation, runRecipeReuse]);

  const clearContext = useCallback(() => setActiveContext(null), []);

  useEffect(() => {
    if (conversation === null) return;
    const cache = conversationCacheRef.current;
    cache.delete(conversation.id);
    cache.set(conversation.id, conversation);
    if (cache.size <= 8) return;
    const oldestConversationId = cache.keys().next().value;
    if (oldestConversationId !== undefined) cache.delete(oldestConversationId);
  }, [conversation]);

  const loadConversation = useCallback(
    async (conversationId: string) => {
      if (isSending || isWorking) return;
      if (pendingRecipeReuseRef.current || pendingRouteDepartureRef.current)
        return;
      if (conversation?.id === conversationId) {
        setRequestedConversationId(null);
        return;
      }
      const cachedConversation =
        conversationCacheRef.current.get(conversationId);
      if (cachedConversation) {
        cancelActiveConversationLoads();
        setConversation(cachedConversation);
        presentWork(
          `cache:${cachedConversation.id}:${cachedConversation.stateVersion}`,
          evryWorkStateForConversation(cachedConversation)
        );
        return;
      }
      if (
        isEvryConversationLoading(
          conversationLoadStateRef.current,
          conversationId
        )
      ) {
        return;
      }
      const load = beginEvryConversationLoad(
        conversationLoadStateRef.current,
        conversationId
      );
      conversationLoadStateRef.current = load.state;
      setConversation(null);
      setRequestedConversationId(conversationId);
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/evry/conversations/${encodeURIComponent(conversationId)}`,
          { cache: "no-store" }
        );
        const loadedConversation = await responseConversation(response);
        if (
          !isLatestEvryConversationLoad(
            conversationLoadStateRef.current,
            load.attempt
          )
        ) {
          return;
        }
        if (
          !canApplyEvryConversationLoadResponse(
            conversationLoadStateRef.current,
            load.attempt,
            loadedConversation.id
          )
        ) {
          throw new Error("Conversation response did not match its request.");
        }
        setConversation(loadedConversation);
        setRequestedConversationId(null);
        presentWork(
          `load:${load.attempt.conversationId}:${load.attempt.ordinal}`,
          evryWorkStateForConversation(loadedConversation)
        );
      } catch {
        if (
          isLatestEvryConversationLoad(
            conversationLoadStateRef.current,
            load.attempt
          )
        ) {
          setError(
            "Unable to open this conversation. Reload the page to try again."
          );
        }
      } finally {
        const completion = finishEvryConversationLoad(
          conversationLoadStateRef.current,
          load.attempt
        );
        conversationLoadStateRef.current = completion.state;
        if (completion.applies) {
          setLoading(false);
        }
      }
    },
    [
      cancelActiveConversationLoads,
      conversation?.id,
      isSending,
      isWorking,
      presentWork,
    ]
  );

  const resetConversation = useCallback(() => {
    if (
      isSending ||
      isWorking ||
      pendingRecipeReuseRef.current ||
      pendingRouteDepartureRef.current
    )
      return;
    cancelActiveConversationLoads();
    mountedConversationIdRef.current = null;
    pendingSubmissionRef.current = null;
    setConversation(null);
    setActiveContext(null);
    setDraft("");
    setError(null);
    setAcknowledgement(null);
    clearWork();
  }, [
    cancelActiveConversationLoads,
    clearWork,
    isSending,
    isWorking,
    setDraft,
  ]);

  const sendMessage = useCallback(async () => {
    const message = evrySubmissionMessage(draft);
    const mountedConversationId = mountedConversationIdRef.current;
    const loadedConversationId = conversation?.id ?? null;
    if (
      message === null ||
      isSending ||
      isWorking ||
      pendingRecipeReuseRef.current !== null ||
      pendingRouteDepartureRef.current !== null ||
      isLoading ||
      requestedConversationId !== null ||
      conversationLoadStateRef.current.latest !== null
    ) {
      return;
    }

    if (mountedConversationId !== loadedConversationId) {
      setError(
        "This conversation changed before the message was sent. Open it again and retry."
      );
      return;
    }

    const pageContext = activeContext?.wire ?? null;
    const pendingSubmission = pendingEvrySubmissionFor(
      pendingSubmissionRef.current,
      {
        conversationId: mountedConversationId,
        message,
        pageContext,
      },
      () => crypto.randomUUID()
    );
    setAcknowledgement({
      requestId: pendingSubmission.requestKey,
      submittedAt: performance.now(),
    });
    writeEvryRunRecoveryMarker({
      requestId: pendingSubmission.requestKey,
      kind: "conversation",
      conversationId: mountedConversationId,
    });
    setSending(true);
    setError(null);
    beginWork(pendingSubmission.requestKey, {
      phase: "reading",
      message: pageContext
        ? "Checking this conversation and page context"
        : "Checking this conversation",
    });
    const controller = new AbortController();
    observeWith(pendingSubmission.requestKey, controller);
    let recoverAfterStream = false;
    try {
      pendingSubmissionRef.current = pendingSubmission;
      const body = evryConversationRequestBody(pendingSubmission);
      let lastSequence = 0;
      const response = await fetch(
        evryConversationSubmissionEndpoint(pendingSubmission),
        {
          method: "POST",
          headers: {
            accept: "application/x-ndjson",
            "content-type": "application/json",
          },
          body,
          signal: controller.signal,
        }
      );
      const streamed = await readEvryConversationStream(response, {
        requestId: pendingSubmission.requestKey,
        expectedConversationId: mountedConversationId,
        onEvent(event) {
          lastSequence = event.sequence;
          if (event.type === "work") {
            updateWork(
              event.requestId,
              event.sequence,
              evryWorkStateForStreamEvent(event)
            );
          } else if (event.type === "conversation") {
            if (
              applyWorkConversation(
                event.requestId,
                event.sequence,
                event.conversation
              )
            ) {
              pendingSubmissionRef.current =
                pendingEvrySubmissionAfterConversation(
                  pendingSubmission,
                  event.requestId,
                  event.conversation.id
                );
              bindEvryRunRecoveryConversation(
                event.requestId,
                event.conversation.id
              );
            }
          } else if (event.type === "complete") {
            finishWork(event.requestId, event.sequence);
          }
        },
      });
      if ("status" in streamed) {
        recoverAfterStream = true;
        return;
      }
      pendingSubmissionRef.current = null;
      if (!streamed.sawComplete || lastSequence < 2) {
        throw new Error("Evry response did not complete.");
      }
      setDraft(evryDraftAfterSubmission(draftRef.current, message));
      clearEvryRunRecoveryMarker(pendingSubmission.requestKey);
    } catch (cause) {
      if (
        controller.signal.aborted &&
        intentionallyDetachedRef.current.has(pendingSubmission.requestKey)
      ) {
        return;
      }
      if (
        cause instanceof EvryConversationStreamFailure &&
        !cause.durableConversationSeen
      ) {
        pendingSubmissionRef.current = null;
        clearEvryRunRecoveryMarker(pendingSubmission.requestKey);
      }
      const failure =
        "Unable to save your request. Check your connection and try again.";
      setError(failure);
      const failureSequence =
        (sequencedWorkRef.current?.requestId === pendingSubmission.requestKey
          ? sequencedWorkRef.current.sequence
          : 0) + 1;
      updateWork(pendingSubmission.requestKey, failureSequence, {
        phase: "failed",
        message: failure,
      });
      finishWork(pendingSubmission.requestKey, failureSequence + 1);
    } finally {
      if (workAbortRef.current?.requestId === pendingSubmission.requestKey) {
        workAbortRef.current = null;
        setObservedRequestId(null);
      }
      setSending(false);
      if (recoverAfterStream) {
        const marker = readEvryRunRecoveryMarker();
        if (marker?.requestId === pendingSubmission.requestKey) {
          void recoverMarker(marker);
        }
      }
    }
  }, [
    activeContext,
    applyWorkConversation,
    beginWork,
    conversation,
    draft,
    finishWork,
    isLoading,
    isSending,
    isWorking,
    requestedConversationId,
    setDraft,
    observeWith,
    recoverMarker,
    updateWork,
  ]);

  const submitPeopleFile = useCallback(
    async (
      input: EvryPeopleFileSubmission
    ): Promise<EvryPeopleFileSubmissionResult> => {
      if (
        isSending ||
        isWorking ||
        pendingRecipeReuseRef.current !== null ||
        pendingRouteDepartureRef.current !== null ||
        isLoading ||
        requestedConversationId !== null
      )
        return { status: "failed" };
      let workRequestId = crypto.randomUUID();
      setAcknowledgement({
        requestId: workRequestId,
        submittedAt: performance.now(),
      });
      setSending(true);
      setError(null);
      beginWork(workRequestId, {
        phase: "reading",
        message: "Checking the file and current People records",
      });
      try {
        let prepared = input.kind === "people_csv" ? input.prepared : null;
        if (!prepared) {
          const form = new FormData();
          form.set("kind", input.kind);
          form.set("file", input.file);
          if ("personId" in input) form.set("personId", input.personId);
          const stagedResponse = await fetch("/api/evry/people/attachments", {
            method: "POST",
            body: form,
          });
          const staged: unknown = await stagedResponse.json();
          prepared = preparedEvryPeopleFileFromStage(staged);
          if (!stagedResponse.ok || !prepared) {
            const reason =
              typeof staged === "object" &&
              staged !== null &&
              "reason" in staged &&
              typeof staged.reason === "string"
                ? staged.reason
                : null;
            throw new Error(
              reason === "unsupported_file_type"
                ? "Choose a PDF, JPEG, or PNG file."
                : reason === "file_too_large"
                  ? "Choose a file that is 10 MB or smaller."
                  : "Unable to stage this file."
            );
          }
        }
        if (
          input.kind === "people_csv" &&
          input.duplicateResolutions === null &&
          prepared.duplicateRows.length > 0
        ) {
          updateWork(workRequestId, 1, {
            phase: "complete",
            message: "Choose how to handle each possible duplicate",
          });
          finishWork(workRequestId, 2);
          return {
            status: "needs_duplicate_resolution",
            prepared,
          };
        }
        const duplicateResolutions =
          input.kind === "people_csv" ? (input.duplicateResolutions ?? {}) : {};
        const semanticKey = [
          input.kind,
          prepared.digest,
          "personId" in input ? input.personId : "",
          "commitmentType" in input ? input.commitmentType : "",
          "signedDate" in input ? input.signedDate : "",
          "notes" in input ? (input.notes ?? "") : "",
          JSON.stringify(Object.entries(duplicateResolutions).toSorted()),
          conversation?.id ?? "new",
        ].join(":");
        const pending = pendingPeopleFileSubmissionFor(
          pendingPeopleFileRef.current,
          semanticKey,
          () => crypto.randomUUID()
        );
        pendingPeopleFileRef.current = pending;
        workRequestId = pending.requestKey;
        setAcknowledgement({
          requestId: pending.requestKey,
          submittedAt: performance.now(),
        });
        beginWork(pending.requestKey, {
          phase: "planning",
          message: "Preparing the exact file review",
        });
        const planBody = evryPeopleFilePlanBody(
          input.kind === "people_csv"
            ? {
                kind: input.kind,
                prepared,
                duplicateResolutions,
                conversationId: conversation?.id ?? null,
                requestKey: pending.requestKey,
              }
            : input.kind === "person_photo"
              ? {
                  kind: input.kind,
                  prepared,
                  conversationId: conversation?.id ?? null,
                  requestKey: pending.requestKey,
                }
              : {
                  kind: input.kind,
                  prepared,
                  commitmentType: input.commitmentType,
                  signedDate: input.signedDate,
                  notes: input.notes,
                  conversationId: conversation?.id ?? null,
                  requestKey: pending.requestKey,
                }
        );
        const reviewResponse = await fetch(
          "/api/evry/people/attachments/plan",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(planBody),
          }
        );
        const nextConversation = await responseConversation(reviewResponse);
        setConversation(nextConversation);
        pendingPeopleFileRef.current = null;
        setDraft("");
        updateWork(
          pending.requestKey,
          2,
          evryWorkStateForConversation(nextConversation)
        );
        finishWork(pending.requestKey, 3);
        requestAnimationFrame(() =>
          document.getElementById("evry-work-status")?.focus()
        );
        return { status: "submitted" };
      } catch (error) {
        const failure =
          error instanceof Error &&
          (error.message === "Choose a PDF, JPEG, or PNG file." ||
            error.message === "Choose a file that is 10 MB or smaller.")
            ? error.message
            : "Unable to prepare this file review. Keep the file selected and try again.";
        setError(failure);
        updateWork(workRequestId, 2, {
          phase: "failed",
          message: failure,
        });
        finishWork(workRequestId, 3);
        return { status: "failed" };
      } finally {
        setSending(false);
      }
    },
    [
      beginWork,
      conversation,
      finishWork,
      isLoading,
      isSending,
      isWorking,
      requestedConversationId,
      setDraft,
      updateWork,
    ]
  );

  const value = useMemo<EvryShellValue>(
    () => ({
      activeContext,
      acknowledgement,
      acknowledgeConversationMounted,
      applyWorkConversation,
      beginWork,
      canStopWatching:
        observedRequestId !== null &&
        observedRequestId === pendingWorkRequestId,
      clearContext,
      closePanel,
      conversation,
      draft,
      error,
      expandToWorkspace,
      finishWork,
      isEnabled: enabled,
      isComposerBlocked:
        isLoading || isWorking || requestedConversationId !== null,
      isLoading,
      isPanelOpen,
      isSending,
      isWorking,
      isWatchingDetached: detachedRequestId !== null,
      loadConversation,
      startRecipeReuse,
      openPanel,
      observeWork: observeWith,
      resetConversation,
      restoreLauncherFocus,
      resumeWatching,
      returnToPage,
      sendMessage,
      setDraft,
      stopWatching,
      updateWork,
      suggestions,
      submitPeopleFile,
      workRequestId: sequencedWork?.requestId ?? null,
      workState: sequencedWork?.state ?? { phase: "idle" },
    }),
    [
      activeContext,
      acknowledgement,
      acknowledgeConversationMounted,
      applyWorkConversation,
      beginWork,
      clearContext,
      closePanel,
      conversation,
      draft,
      enabled,
      error,
      expandToWorkspace,
      finishWork,
      isLoading,
      isPanelOpen,
      isSending,
      isWorking,
      detachedRequestId,
      loadConversation,
      openPanel,
      observeWith,
      observedRequestId,
      pendingWorkRequestId,
      resetConversation,
      requestedConversationId,
      restoreLauncherFocus,
      resumeWatching,
      returnToPage,
      sendMessage,
      setDraft,
      stopWatching,
      startRecipeReuse,
      sequencedWork,
      suggestions,
      submitPeopleFile,
      updateWork,
    ]
  );

  return (
    <EvryShellContext.Provider value={value}>
      <AppRouterContext.Provider value={navigationRouter}>
        <AuthenticatedNavigationIntentProvider value={fenceRecipeReuseForHref}>
          {children}
          {enabled && hasOpenedPanel ? <EvryPanel /> : null}
        </AuthenticatedNavigationIntentProvider>
      </AppRouterContext.Provider>
    </EvryShellContext.Provider>
  );
}

export function useEvryShell(): EvryShellValue {
  const value = useContext(EvryShellContext);
  if (!value) throw new Error("useEvryShell must be used within EvryShell");
  return value;
}
