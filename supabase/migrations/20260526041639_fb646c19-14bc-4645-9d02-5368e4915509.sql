
CREATE POLICY "deny all client access" ON public.coc_links FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "deny all client access" ON public.command_permissions FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "deny all client access" ON public.disabled_commands FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "deny all client access" ON public.discord_config FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "deny all client access" ON public.war_track_config FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "deny all client access" ON public.wars FOR SELECT TO anon, authenticated USING (false);
