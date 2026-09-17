'use strict';

function defaultHooks() { return { response: [] }; }

function asHookList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  for (const hook of list) {
    if (typeof hook !== 'function') throw new TypeError('response hooks must be functions');
  }
  return list.slice();
}

function normalizeHooks(hooks) {
  const result = defaultHooks();
  if (hooks == null) return result;
  if (typeof hooks !== 'object') throw new TypeError('hooks must be an object');
  for (const [name, value] of Object.entries(hooks)) result[name] = asHookList(value);
  return result;
}

function mergeHooks(requestHooks, sessionHooks) {
  const request = normalizeHooks(requestHooks);
  const session = normalizeHooks(sessionHooks);
  const result = {};
  for (const name of new Set([...Object.keys(session), ...Object.keys(request)])) {
    const requestList = request[name] || [];
    const sessionList = session[name] || [];
    result[name] = requestList.length && sessionList.length
      ? [...sessionList, ...requestList]
      : requestList.length ? requestList.slice() : sessionList.slice();
  }
  return result;
}

async function dispatchHook(key, hooks, data, kwargs = {}) {
  let current = data;
  for (const hook of asHookList(hooks && hooks[key])) {
    const result = await hook(current, kwargs);
    if (result !== undefined && result !== null) current = result;
  }
  return current;
}

function dispatchHookSync(key, hooks, data, kwargs = {}) {
  let current = data;
  for (const hook of asHookList(hooks && hooks[key])) {
    const result = hook(current, kwargs);
    if (result && typeof result.then === 'function') {
      throw new TypeError('Synchronous requests require synchronous response hooks');
    }
    if (result !== undefined && result !== null) current = result;
  }
  return current;
}

module.exports = { defaultHooks, normalizeHooks, mergeHooks, dispatchHook, dispatchHookSync };
