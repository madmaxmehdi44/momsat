'use client';

export type ActionFeedbackStatus = 'start' | 'done' | 'error';
export type ActionFeedbackPayload = {
  id: string;
  label: string;
  status: ActionFeedbackStatus;
  detail?: string;
};

const ACTION_EVENT = 'momsat-action-feedback';

export function emitActionFeedback(payload: ActionFeedbackPayload) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ActionFeedbackPayload>(ACTION_EVENT, { detail: payload }));
}

export function startAction(id: string, label: string) {
  emitActionFeedback({ id, label, status: 'start' });
}

export function finishAction(id: string, detail?: string) {
  emitActionFeedback({ id, label: '', status: 'done', detail });
}

export function failAction(id: string, detail = 'عملیات انجام نشد') {
  emitActionFeedback({ id, label: '', status: 'error', detail });
}

export function subscribeActionFeedback(listener: (payload: ActionFeedbackPayload) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<ActionFeedbackPayload>).detail);
  window.addEventListener(ACTION_EVENT, handler);
  return () => window.removeEventListener(ACTION_EVENT, handler);
}

export const ACTION_FEEDBACK_EVENT = ACTION_EVENT;
