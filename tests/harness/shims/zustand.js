'use strict';

/**
 * `zustand`'s `create`, enough for the stores this project has.
 *
 * The real one returns a hook; outside React it is called through
 * `useX.getState()`, which is how every suite drives a store. The hook form is
 * provided so a module that calls `useX(selector)` at import time does not
 * throw, but no suite renders anything.
 */
function create(initialiser) {
  let state;
  const listeners = new Set();

  const setState = (partial, replace) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    state = replace ? next : { ...state, ...next };
    listeners.forEach((listener) => listener(state));
  };
  const getState = () => state;

  state = initialiser(setState, getState, { setState, getState });

  const useStore = (selector) => (selector ? selector(state) : state);
  useStore.getState = getState;
  useStore.setState = setState;
  useStore.subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return useStore;
}

exports.create = create;
exports.default = create;
