
-- Remove public read access from internal/sensitive tables.
-- Edge functions use the service role and bypass RLS, so they remain functional.
DROP POLICY IF EXISTS "public read coc_links" ON public.coc_links;
DROP POLICY IF EXISTS "public read command_permissions" ON public.command_permissions;
DROP POLICY IF EXISTS "public read disabled_commands" ON public.disabled_commands;
DROP POLICY IF EXISTS "public read discord_config" ON public.discord_config;
DROP POLICY IF EXISTS "public read war_track_config" ON public.war_track_config;
DROP POLICY IF EXISTS "public read wars" ON public.wars;

-- Lock down SECURITY DEFINER function so anon/authenticated cannot execute it.
REVOKE EXECUTE ON FUNCTION public.prune_old_snapshots() FROM anon, authenticated, public;

-- Explicit deny policy on embed_edit_tokens to satisfy "RLS enabled, no policy" linter.
-- Tokens are only validated server-side via service role.
CREATE POLICY "deny all client access" ON public.embed_edit_tokens
  FOR SELECT TO anon, authenticated USING (false);
