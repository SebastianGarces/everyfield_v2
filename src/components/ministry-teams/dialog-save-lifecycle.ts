"use client";

import { useCallback, useRef, useState } from "react";

export type DialogSaveResult =
  | { success: true }
  | { success: false; error: string };

export interface DialogSaveState {
  open: boolean;
  loading: boolean;
  error: string | null;
  attempt: number;
}

export const INITIAL_DIALOG_SAVE_STATE: DialogSaveState = {
  open: false,
  loading: false,
  error: null,
  attempt: 0,
};

export function openDialogSave(
  state: DialogSaveState,
  attempt: number
): DialogSaveState {
  return { ...state, open: true, loading: false, error: null, attempt };
}

export function closeDialogSave(
  state: DialogSaveState,
  attempt: number
): DialogSaveState {
  return { ...state, open: false, loading: false, error: null, attempt };
}

export function beginDialogSave(
  state: DialogSaveState,
  attempt: number
): DialogSaveState {
  return { ...state, loading: true, error: null, attempt };
}

export function settleDialogSave(
  state: DialogSaveState,
  attempt: number,
  result: DialogSaveResult
): DialogSaveState {
  if (!state.open || state.attempt !== attempt) return state;

  return result.success
    ? { ...state, open: false, loading: false, error: null }
    : { ...state, loading: false, error: result.error };
}

export function finishDialogSave(
  state: DialogSaveState,
  attempt: number
): DialogSaveState {
  if (!state.open || state.attempt !== attempt) return state;

  return { ...state, loading: false };
}

export function useDialogSaveLifecycle() {
  const [state, setState] = useState(INITIAL_DIALOG_SAVE_STATE);
  const latestAttempt = useRef(0);

  const onOpenChange = useCallback((open: boolean) => {
    const attempt = ++latestAttempt.current;
    setState((current) =>
      open
        ? openDialogSave(current, attempt)
        : closeDialogSave(current, attempt)
    );
  }, []);

  const submit = useCallback(async (save: () => Promise<DialogSaveResult>) => {
    const attempt = ++latestAttempt.current;
    setState((current) => beginDialogSave(current, attempt));

    try {
      const result = await save();
      setState((current) => settleDialogSave(current, attempt, result));
    } catch (error) {
      setState((current) => finishDialogSave(current, attempt));
      throw error;
    }
  }, []);

  return { ...state, onOpenChange, submit };
}
