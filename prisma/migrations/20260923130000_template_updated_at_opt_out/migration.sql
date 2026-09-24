-- "Template" carries a BEFORE UPDATE trigger (template_updated_at → set_template_updated_at,
-- created outside the Prisma history at the plain-postgres cutover) that stamps
-- "updatedAt" = now() on EVERY update — including one that only flips a curation flag such
-- as isFeatured. That bump hides the template's ready preview video in the app
-- (isTemplatePreviewStale), changes its thumbnail cache token and reorders every
-- newest-first list.
--
-- Curation writers now opt out for their own transaction with
--   SELECT set_config('nayroz.preserve_updated_at', 'on', true);
-- (preserveTemplateUpdatedAt() in src/lib/templates/featured.server.js), and the trigger then
-- leaves "updatedAt" as the statement wrote it. Every other update behaves exactly as before.
-- Where the trigger does not exist this only (re)defines an unused function.

CREATE OR REPLACE FUNCTION public.set_template_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $function$
begin
  if current_setting('nayroz.preserve_updated_at', true) = 'on' then
    return new;
  end if;
  new."updatedAt" = now();
  return new;
end;
$function$;
