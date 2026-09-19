// §7.4: the skip link is the first tab stop on the landing page and the app
// shell; visible only when focused.
const SkipLink = () => (
  <a
    href="#main-content"
    data-testid="skip-link"
    className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-lime focus:text-void focus:px-4 focus:py-2 focus:rounded-md text-sm font-medium"
  >
    Skip to dashboard
  </a>
);

export default SkipLink;
