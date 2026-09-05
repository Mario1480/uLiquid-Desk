# Registration control — local validation

Implemented a platform-superadmin registration switch in the existing Access Settings page, backed by `auth.registration.v1`. Public signup checks the database setting before any signup side effects. Login and existing-account verification remain unchanged. The public registration page displays a localized closed or unavailable notice, with a login link.

Validation:

- API authentication suite: 64/64 passed, including registration settings, direct-request blocking, fail-closed database errors, authorization, input validation, and audited toggling.
- API TypeScript: passed.
- Targeted TypeScript compilation of the changed web pages/component: passed with zero diagnostics.
- Translation integrity and `git diff --check`: passed.
- Local browser with mocked API responses: disabled and enabled registration states; admin disable/save and enable/save; desktop 1440x1000 and mobile 390x844 rendering. Mobile closed registration had no input fields or horizontal overflow. Browser mocks do not establish production behavior.
- Full web TypeScript compilation was interrupted after stalling on dependency file reads under `node_modules/porto/node_modules/ox`; it is not marked passed. An unrelated controlled-input warning was caused by the incomplete visibility-settings browser mock. A transient translation warning during hot reload resolved after the new messages loaded.

No deployment or production setting change was performed. Existing installations remain open until the new code is deployed and a superadmin explicitly disables public registration. Production activation and verification remain pending.
