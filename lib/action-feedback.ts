'use client';

import {
  isStreamTrafficUrl,
  noteStreamRequestEnd,
  noteStreamRequestStart,
  scheduleAppNetworkRequest,
  setLowNetworkPriority,
} from './network-qos';

export type ActionFeedbackStatus = 'start' | 'done' | 'error';
export type ActionFeedbackPayload = {
  id: string;
  label: string;
  status: ActionFeedbackStatus;
  detail?: string;
};

export type ActionRunOptions = {
  label?: string;
  detail?: string;
  dedupe?: boolean;
  silent?: boolean;
};

const ACTION_EVENT = 'momsat-action-feedback';
const PIPELINE_INSTALLED = '__momsatActionPipelineInstalled';
const inflight = new Map<string, Promise<unknown>>();

export function emitActionFeedback(payload: ActionFeedbackPayload) {
  if (typeof window === 'undefined') return;
  if ((payload as ActionFeedbackPayload & { silent?: boolean }).silent) return;
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

export async function runAction<T>(id: string, task: () => Promise<T>, options: ActionRunOptions = {}): Promise<T> {
  const existing = inflight.get(id);
  if (existing && options.dedupe !== false) return existing as Promise<T>;

  const label = options.label || 'در حال انجام عملیات';
  startAction(id, label);
  const promise = Promise.resolve().then(task);
  inflight.set(id, promise);

  try {
    const result = await promise;
    finishAction(id, options.detail);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'عملیات انجام نشد');
    failAction(id, detail);
    throw error;
  } finally {
    if (inflight.get(id) === promise) inflight.delete(id);
  }
}

export function isActionRunning(id: string) {
  return inflight.has(id);
}

export function subscribeActionFeedback(listener: (payload: ActionFeedbackPayload) => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<ActionFeedbackPayload>).detail);
  window.addEventListener(ACTION_EVENT, handler);
  return () => window.removeEventListener(ACTION_EVENT, handler);
}

function requestLabel(url: string, method: string) {
  const path = (() => { try { return new URL(url, window.location.href).pathname; } catch { return url; } })();
  if (path.startsWith('/api/admin/')) return method === 'GET' ? 'در حال دریافت اطلاعات مدیریت' : 'در حال اجرای عملیات مدیریت';
  if (path === '/api/catalog') return 'در حال دریافت کاتالوگ شبکه‌ها';
  if (path.includes('/api/channel')) return 'در حال دریافت اطلاعات شبکه';
  if (path.includes('/api/stream')) return '';
  return method === 'GET' ? 'در حال دریافت اطلاعات' : 'در حال پردازش درخواست';
}

function isHighPriorityAppRequest(method: string, url: string) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  return !isStreamTrafficUrl(url);
}

function shouldQoSRequest(method: string, url: string) {
  if (isStreamTrafficUrl(url)) return false;
  return method === 'GET' || method === 'HEAD';
}

export function installGlobalActionPipeline() {
  if (typeof window === 'undefined') return () => undefined;
  const target = window as Window & { [PIPELINE_INSTALLED]?: boolean; __momsatOriginalFetch?: typeof window.fetch; __momsatOriginalOpen?: typeof XMLHttpRequest.prototype.open; __momsatOriginalSend?: typeof XMLHttpRequest.prototype.send };
  if (target[PIPELINE_INSTALLED]) return () => undefined;
  target[PIPELINE_INSTALLED] = true;

  const originalFetch = window.fetch.bind(window);
  target.__momsatOriginalFetch = originalFetch;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);

    if (isStreamTrafficUrl(url)) {
      noteStreamRequestStart(url);
      const request = originalFetch(input, init);
      void request.finally(() => noteStreamRequestEnd(url));
      return request;
    }

    const label = requestLabel(url, method);
    const preparedInit = shouldQoSRequest(method, url)
      ? setLowNetworkPriority(init, true)
      : init;

    if (!label) {
      if (!shouldQoSRequest(method, url)) return originalFetch(input, preparedInit);
      return scheduleAppNetworkRequest(() => originalFetch(input, preparedInit), { highPriority: isHighPriorityAppRequest(method, url) });
    }

    const key = `${method}:${url}`;
    if ((method === 'GET' || method === 'HEAD') && inflight.has(key)) return inflight.get(key) as Promise<Response>;

    const task = () => originalFetch(input, preparedInit);
    return runAction(
      key,
      () => shouldQoSRequest(method, url)
        ? scheduleAppNetworkRequest(task, { highPriority: isHighPriorityAppRequest(method, url) })
        : task(),
      { label, dedupe: method === 'GET' || method === 'HEAD' },
    );
  }) as typeof window.fetch;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  target.__momsatOriginalOpen = originalOpen;
  target.__momsatOriginalSend = originalSend;

  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
    const xhr = this as XMLHttpRequest & { __momsatMethod?: string; __momsatUrl?: string };
    xhr.__momsatMethod = method.toUpperCase();
    xhr.__momsatUrl = String(url);

    const open = originalOpen as unknown as (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) => void;

    const async = rest.length > 0 ? Boolean(rest[0]) : undefined;
    const username = rest.length > 1 ? (rest[1] as string | null | undefined) : undefined;
    const password = rest.length > 2 ? (rest[2] as string | null | undefined) : undefined;

    if (rest.length >= 3) return open.call(this, method, url, async, username, password);
    if (rest.length === 2) return open.call(this, method, url, async, username);
    if (rest.length === 1) return open.call(this, method, url, async);
    return open.call(this, method, url);
  };

  XMLHttpRequest.prototype.send = function(...args: any[]) {
    const xhr = this as XMLHttpRequest & { __momsatMethod?: string; __momsatUrl?: string; __momsatActionId?: string; __momsatStreamUrl?: string };
    const method = xhr.__momsatMethod || 'GET';
    const url = xhr.__momsatUrl || '';
    const label = requestLabel(url, method);
    const streamTraffic = isStreamTrafficUrl(url);

    if (streamTraffic) {
      xhr.__momsatStreamUrl = url;
      noteStreamRequestStart(url);
      xhr.addEventListener('loadend', () => noteStreamRequestEnd(url), { once: true });
    }

    const send = originalSend as (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) => void;
    if (!label) return send.call(this, args[0] as Document | XMLHttpRequestBodyInit | null);

    const id = `xhr:${method}:${url}`;
    xhr.__momsatActionId = id;
    startAction(id, label);
    xhr.addEventListener('loadend', () => {
      if (xhr.status >= 200 && xhr.status < 400) finishAction(id);
      else failAction(id, `درخواست با وضعیت ${xhr.status || 'نامشخص'} پایان یافت`);
    }, { once: true });

    return send.call(this, args[0] as Document | XMLHttpRequestBodyInit | null);
  };

  return () => {
    if (target.__momsatOriginalFetch) window.fetch = target.__momsatOriginalFetch;
    if (target.__momsatOriginalOpen) XMLHttpRequest.prototype.open = target.__momsatOriginalOpen;
    if (target.__momsatOriginalSend) XMLHttpRequest.prototype.send = target.__momsatOriginalSend;
    delete target[PIPELINE_INSTALLED];
  };
}

export const ACTION_FEEDBACK_EVENT = ACTION_EVENT;
