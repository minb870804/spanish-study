# Minb Design System

## 1. Atmosphere & Identity
Preserve the existing warm paper dashboard: cream canvas, softly raised white cards, charcoal primary actions, restrained terracotta study accent. Noto Sans KR and Outfit remain. This is an extraction and consolidation of existing CSS primitives, authorized by the user, not a brand replacement.

## 2. Color
Shared CSS owns --ui-bg #F5F3EE / #101112, --ui-card #FFFFFF / #191B1D, --ui-text #1B1D1F / #F1F2F1, --ui-muted #62676B / #A8ADB1, --ui-border #E6E3DC / #2B2E30, --ui-accent #38679b / #91B9EC, --ui-soft #e7f0fa / #203148, --ui-ink #1B1D1F / #F1F2F1, --ui-on-ink #FFFFFF / #16181A. Existing semantic --red, --green, --blue and category/owner colors keep their meaning; never substitute them for text labels.

## 3. Typography
Body Noto Sans KR, system-ui; Latin title/number Outfit. --ui-caption 12px, --ui-small 14px, --ui-body 16px, --ui-title 20px, --ui-display 28px. Weights 400, 500, 700, 800; body line-height 1.6, title 1.3. Korean keep-all, overflow-wrap anywhere for unbroken content. Form controls 16px minimum to avoid iOS zoom.

## 4. Spacing & Layout
4px base: --ui-s1 4px, --ui-s2 8px, --ui-s3 12px, --ui-s4 16px, --ui-s5 20px, --ui-s6 24px, --ui-s8 32px. --ui-radius 14px, --ui-radius-sm 8px, --ui-control 44px, --ui-nav-height 68px, --ui-content 1140px. Document owns page scroll; fixed bottom navigation includes safe-area inset and matching body padding. 375/768/1280 width validation. Desktop navigation stays horizontal at top. Default home order: today summary, calendar and selected-day agenda, future tasks, compact shared status. Each user can reorder or hide any of these four cards from settings; an always-present edit link and main navigation remain available. Mobile defaults to week calendar, desktop month; explicit user choice saved per account in Firestore with an account-scoped cache. Settings are a hash-addressable home view. Existing day/editor dialogs retain their own scroll owner and sticky action footer.

## 5. Components
- Schedule editor: warm paper bottom sheet on narrow screens, centered 600px dialog on wide screens. Header and action footer remain outside the single `.todo-editor-body` scroll owner. Title, date/time and visibility precede compact location/reminder/repeat rows; category, importance and notes live in a closed disclosure with a value summary. Separate visibility radios from assignee radios. End date appears only with the multi-day checkbox. Focus the heading on entry so touch devices do not open the keyboard. Preserve collapsed values, reveal invalid fields, retain drafts on failed save and confirm dirty dismissal. Delete is in the scroll body, away from the fixed save button. New-schedule fields follow date/time → sharing → optional details, retaining existing field IDs and persistence.
- Schedule primitives: `.schedule-segments` native radio group (selected tonal fill, keyboard focus, disabled); `.schedule-setting` native disclosure with current-value summary; `.schedule-section` grouped fields. Existing token spacing, 44px targets and 16px controls apply. Editor width token `--ui-editor-width:600px`, sheet height `--ui-sheet-height:92dvh`, overlay `--ui-overlay:rgba(27,29,31,.56)`, overlay layer `--ui-layer-dialog:6000`. Safe-area footer and visual viewport bounds keep actions reachable with the keyboard open.
- Shared app navigation: same destinations home/study/reading/diary/shared-diary/settings, SVG outline icons and labels, aria-current page; home settings #settings. Focus-visible, hover, current, active states. Hidden by existing login overlay, not above it.
- Buttons/fields: existing small-btn/add-btn/modal-input/hbtn/nexus-link patterns unified by shared CSS. 44px primary touch controls, token radii, visible focus, disabled opacity, existing loading text. No new package/runtime dependency.
- Cards: existing card/section-card surfaces use token border, radius and warm shadow. Empty rows explain next action with a real button. Error states preserve input.
- Native disclosure details/summary: additional form options and study guidance. Keyboard-native; preserved field values while collapsed; open on validation error and when existing optional values need visibility. Focus trap includes summary.
- Today/selected-day agenda: actual merged day/recurring/period data; full wrapping title, time and owner label, real open/edit behavior. Empty, complete, read-only and populated states.
- Calendar display: Sunday through Saturday. Compact event labels prioritize only the title, with single-line clipping and no ellipsis as explicitly requested by the user; the full title remains in the selected-day agenda/editor.
- Segmented week/month calendar buttons: aria-pressed with visible selection; previous/next move selected unit, today restores current date. Dates keyboard reachable without invalid nested buttons.
- Learning tables: focusable labeled local scroll region with mobile instruction; Spanish words, Korean meanings and conjugations stay intact. Arrow keys scroll a focused table rather than advancing flashcards. Progress rows put title and meter on separate mobile rows.
- Shared settings: existing nodes moved, no duplicate IDs/data ownership. Close/back returns home, escape and focus handled where appropriate.
- Diary synchronization: shared and personal diary show an aria-live connection banner with loading, cached, pending, synced, offline and error states. Retry reconnects the subscription without discarding input; one active subscription per account/space. Controls use shared 44px button and spacing tokens.
- Shared diary drafts: private local drafts are scoped by UID, space ID and date. Drafts restore text, mood and last unfinished date; temporary storage failures are visible. Save/delete operations retain newer input and never mutate another account, space or selected date on late completion.
- Draft and save states: personal diary and reading drafts are scoped to the authenticated UID; anonymous reading drafts stay in the current browser tab. Unowned legacy diary drafts are retained but never automatically attributed. Saving, failure, local draft, and saved states are announced; asynchronous completion never replaces newer input or another account/date.
- Reading navigation: visible bookshelf jump and new-record controls near the title, native keyboard-operable buttons, no hidden duplicate editor. Mobile header keeps the login action on one line and the account hint on its own row. Theme and local calendar dates follow the rest of the app.
- Reading notes: account-private book title, author, recorded date, emotion, favorite quote and reflection. The book-list card uses the same raised card, 44px controls and visible selection state; local content is never shared into the couple space.
Equivalent state harness before composition: existing verified card/button/editor screenshots plus a shared primitives fixture for new navigation/disclosure/button states at 375/768/1280.

- Recurrence settings: shared pattern in the management panel and conversion dialog, weekday toggle buttons with aria-pressed, weekdays/weekends presets, labeled start/end dates and a live plain-language summary. Dates are inclusive; legacy undated rules remain unbounded. Keep existing daily/monthly/yearly frequencies and month-end behavior. Inputs use 16px type and 44px touch targets; mobile date fields stack.

## 6. Motion & Interaction
--ui-motion 160ms ease-out for color/opacity/transform feedback only; reduced-motion disables transitions. Native disclosure is immediate; no decorative animation. Primary actions have visible focus and pressed feedback. Navigation changes are explicit links; save/close behavior and data ownership retained.

## 7. Depth & Surface
Mixed existing border and warm shadows: --ui-shadow 0 8px 24px rgba(62,52,40,.07), 0 1px 2px rgba(62,52,40,.04). Existing paper grain remains on dashboard. Navigation uses opaque card surface with border and shadow; no blur dependency. Modals sit above navigation; FAB clears bottom safe area.

## 8. Accessibility Constraints & Accepted Debt
Target readable contrast, keyboard navigation, semantic labels, visible focus, 44px navigation targets and safe-area support. Native details must retain validation and keyboard reachability. No live production user data changes during QA; use boundary-mocked fixtures. No new accepted debt. Existing third-party auth/font loading is outside this UI change; do not claim a Lighthouse certification without measurement.
