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

afterEach(() => {
  cleanup();
});
