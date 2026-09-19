import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";

// jsdom lacks the observers framer-motion's viewport features use.
class MockObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
if (typeof window.IntersectionObserver === "undefined") {
  window.IntersectionObserver = MockObserver;
}
if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = MockObserver;
}

// jsdom lacks the pointer-capture APIs Radix Select's trigger relies on when
// it opens; without these the dropdown never renders its options.
for (const method of ["hasPointerCapture", "releasePointerCapture", "setPointerCapture"]) {
  if (typeof window.HTMLElement.prototype[method] === "undefined") {
    window.HTMLElement.prototype[method] = () => {};
  }
}
if (typeof window.HTMLElement.prototype.scrollIntoView === "undefined") {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
