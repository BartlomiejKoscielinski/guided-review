import '@testing-library/dom';

declare module '@testing-library/dom' {
  interface ByRoleOptions {
    /**
     * Accepted for symmetry with Playwright's `getByRole(…, { exact: true })` and ignored: a
     * string `name` already matches the whole accessible name in Testing Library.
     */
    exact?: boolean;
  }
}
