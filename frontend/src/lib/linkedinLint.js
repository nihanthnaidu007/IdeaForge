// The Dashboard copy gate (Honesty bundle fix 7): the copy path runs the
// same /preview/linkedin lint the Board preview runs, so the most natural
// exit can no longer skip the formatting checks. Pure decision logic — the
// caller owns the network call, the clipboard, and the toasts.

// Error-severity checks block the copy (they will visibly break the post);
// warn/info results copy with a note; no verdict never copies — silently
// skipping the promised checks is the drift this gate exists to kill.
export const copyGateFor = (result) => {
  if (!result || typeof result !== "object") {
    return {
      allowed: false,
      message: "The LinkedIn checks didn't run, so nothing was copied. Try again.",
    };
  }
  const checks = Array.isArray(result.checks) ? result.checks : [];
  const blocking = checks.filter((c) => c?.severity === "error");
  if (blocking.length > 0) {
    return {
      allowed: false,
      message: blocking[0]?.message ?? "Fix the flagged formatting checks first.",
    };
  }
  return {
    allowed: true,
    message: result.clean
      ? "Copied. Paste it into LinkedIn and post it yourself."
      : "Copied with notes — review the checks under the post.",
  };
};
