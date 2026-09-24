// Adds jest-dom's DOM-specific matchers (toBeInTheDocument, toHaveTextContent,
// etc.) to every test file automatically — CRA loads this file before each
// test suite runs (react-scripts convention, no explicit import needed).
import "@testing-library/jest-dom";

// jsdom (this project's Jest test environment) doesn't expose TextEncoder/
// TextDecoder globally the way a real browser does — a gap react-router@7
// (added for the admin panel — docs/ADMIN_PANEL_PLAN.md Phase 0.4) hits at
// import time in every test that pulls in react-router-dom, even indirectly.
// Node's own `util` module has real, spec-compliant implementations; global
// (not per-test-file) is the right place for this since it's an environment
// gap any future test importing react-router-dom will hit again, unlike the
// component-specific window.matchMedia/IntersectionObserver mocks that stay
// local to the one test file that needs them.
import { TextEncoder, TextDecoder } from "util";
if (typeof global.TextEncoder === "undefined") global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === "undefined") global.TextDecoder = TextDecoder;
