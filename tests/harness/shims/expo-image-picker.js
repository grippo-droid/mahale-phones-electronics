'use strict';
/** `expo-image-picker` — native, and not reachable from a test. Present so imports resolve. */
module.exports = new Proxy(
  {},
  {
    get(_target, name) {
      if (name === '__esModule') return false;
      return () => {
        throw new Error('expo-image-picker is not modelled in the harness (' + String(name) + ').');
      };
    },
  }
);
