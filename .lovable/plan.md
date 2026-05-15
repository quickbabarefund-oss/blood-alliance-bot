## Plan

1. **Make the Family Dashboard builder UI-first**
   - Stop depending on the older `family_dashboards` row for title/description/color when a `family_dashboard` UI template exists.
   - Build the Discord payload directly from the saved UI template plus the live category/clan fields.
   - Trim leading blank lines in saved title/description/content before sending to Discord, so the visible embed doesn’t look unchanged because of hidden whitespace.

2. **Make force sync return proof, not only `ok: true`**
   - Add a small response payload with the refreshed guild id, message id, title, description preview, and `updated_at`.
   - If Discord PATCH fails, surface the real Discord status/body in the UI toast instead of a generic success/warning.

3. **Fix the editor save/force-sync flow**
   - When clicking **Force sync now**, first save the current open UI changes if they are unsaved, then force refresh Discord.
   - This resolves the “0 changes” case where Discord is synced from the last saved template while edits are still only in the browser.

4. **Deploy and validate**
   - Redeploy `embed-templates-api` and any shared-function consumers needed.
   - Test the edge function directly with the active editor token.
   - Verify the database row and function response show the same values as the UI-saved template.

## Technical details

- Main files: `src/pages/EmbedEditor.tsx`, `supabase/functions/embed-templates-api/index.ts`, `supabase/functions/_shared/family.ts`, possibly `supabase/functions/_shared/embed_templates.ts`.
- Root issue found: database values are being updated, but the Discord payload path still mixes legacy dashboard config with UI template config, and force sync does not save unsaved browser edits before refreshing.