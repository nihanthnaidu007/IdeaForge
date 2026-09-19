// The failures project's test surface: the same API as @playwright/test,
// with the page fixture extended to carry the hang tripwire (F04 diagnosis
// art_vqwfyodR — when a test in this project fails, the request timeline is
// attached so a hung proxied request produces evidence instead of silence).
import { test as base, expect } from "@playwright/test";
import { installHangTripwire } from "./hang-tripwire.js";

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const removeTripwire = installHangTripwire(page, testInfo);
    await use(page);
    removeTripwire();
  },
});
export { expect };
