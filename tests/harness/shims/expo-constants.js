'use strict';
/** `expo-constants` — native, and not reachable from a test. Present so imports resolve. */
module.exports = new Proxy(
  {},
  {
    get(_target, name) {
      if (name === '__esModule') return false;
      return () => {
        throw new Error('expo-constants is not modelled in the harness (' + String(name) + ').');
      };
    },
  }
);
