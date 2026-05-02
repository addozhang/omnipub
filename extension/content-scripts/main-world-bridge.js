/**
 * main-world-bridge.js — Runs in MAIN world (same JS context as the page).
 *
 * Bridges CustomEvents from the page to the content script's isolated world
 * via window.postMessage. This is necessary because CustomEvent.detail is NOT
 * accessible across Chrome's world boundary (main ↔ isolated).
 *
 * Flow: page dispatches CustomEvent → this script catches it → postMessage → page-bridge.js
 */

(function () {
  const EVENTS_TO_BRIDGE = [
    "omnipub:start-publish",
    "omnipub:check-login",
    "omnipub:ping",
    "omnipub:set-token",
    "omnipub:verify-session",
  ];

  for (const eventName of EVENTS_TO_BRIDGE) {
    window.addEventListener(eventName, (event) => {
      window.postMessage(
        {
          type: "__omnipub_bridge__",
          eventName,
          detail: JSON.parse(JSON.stringify(event.detail || {})),
        },
        window.location.origin
      );
    });
  }
})();
