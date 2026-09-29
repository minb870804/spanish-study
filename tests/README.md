# Minb browser regression checks

Run with Node.js, Playwright and Chrome installed:

```sh
node tests/minb-regression.cjs
```

If Playwright is installed outside this project, set MINB_PLAYWRIGHT to its module directory. MINB_ROOT overrides the source directory and MINB_RESULTS overrides the JSON output (default: system temporary directory/minb-regression-results.json).

The runner opens a fresh Chrome context for each scenario, intercepts every request, serves local source, and supplies an in-memory Firebase boundary. It never signs into a real account or contacts production Firebase. Tests cover personal-diary and reading draft isolation, failure recovery, delayed saves, retries, guest login, local dates, theme restoration and shared-diary mood changes. They do not verify real OAuth, native iOS or production Firestore rules.

Shared-diary coverage also includes per-account/space/date draft restoration, failed and delayed deletion, duplicate-write prevention, storage failures, subscription retry, offline status, and unconfirmed initial Firestore reads. Both diary pages expose synchronization failures and recovery actions.

Run `node tests/recurrence.cjs` for weekday presets, inclusive start/end boundaries, legacy recurrence behavior, private/shared persistence, failed-save recovery, and keyboard dialog checks. Uses the same MINB_PLAYWRIGHT, MINB_ROOT and MINB_RESULTS environment options.

Run `node tests/schedule-save.cjs` for new schedules while notification permission is pending, failed-save draft recovery, failed-copy rollback, and copying a period schedule through the date picker. It uses MINB_PLAYWRIGHT/MINB_ROOT and a visible Chrome window with mocked Firebase writes.

Run `node tests/monthly-save.cjs` for migrated (`dayStorage=2`) schedule creation and cross-month copy/rollback. Its mock rejects legacy root writes, covering the production schema boundary missed by the legacy fixtures. Actual production-rule checks are recorded separately in `.omo/evidence/schedule-monthly-20260927.md`.

Run `node tests/schedule-editor.cjs` for editor focus, sharing, collapsed-value preservation, all-day/multi-day controls, failed-save retry, dirty dismissal and the reordered creation fields. Chrome screenshots and viewport assertions cover 375/768/1280px. Set `MINB_EDITOR_EVIDENCE` to redirect its output. Firebase is mocked; this does not verify native iPhone keyboards or notification delivery.

Run `node tests/home-visual.cjs` for the home screen's look: a computed-style baseline (`tests/fixtures/home-computed-baseline.json`, regenerate only after reading the diff, with `MINB_WRITE_BASELINE=1`), 44px touch targets on the row-menu and word buttons, and a sweep that fails when any decorative emoji appears in the home view, day popup, settings view or the modals opened from home (the allow-list of meaningful marks lives in `sweepDecorInPage`). Because that sweep cannot see strings that only appear after a user action, the same file also has a static source check (`findMessageSinks`) that fails when an emoji appears in a `toast(...)` / `showUndoToast(...)` message, in an argument of a helper that forwards its message to `toast` (found automatically), or in a `*Hint` element assignment; a self-check proves it catches dirty snippets and ignores list-marker regexes, category/card icons and day marks. A runtime test triggers real toasts (complete, delete with undo, add memo) and asserts their rendered text. Uses MINB_PLAYWRIGHT/MINB_ROOT; Firebase is mocked.

Run `node tests/cross-page.cjs` for pages other than home: a hovered card keeps the calm shadow on study/reading/diary/shared-diary (shared ui.css must beat study.html's own heavier `.card:hover`). Uses MINB_PLAYWRIGHT/MINB_ROOT; Firebase is mocked.
