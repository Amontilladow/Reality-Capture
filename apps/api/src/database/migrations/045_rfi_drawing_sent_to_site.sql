-- Whether the updated drawing/model has actually been sent to the site
-- team -- a separate milestone from drawing_update_applied (044): applied
-- means the drawing/model itself was updated, sent-to-site means that
-- updated drawing/model was actually distributed to the people building
-- from it. Same "only means something once drawing_impact_level != 'no'"
-- rule as drawing_update_applied -- no third 'not_applicable' state here
-- either.
ALTER TABLE rfis
  ADD COLUMN IF NOT EXISTS drawing_update_sent_to_site      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS drawing_update_sent_to_site_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drawing_update_sent_to_site_by   UUID REFERENCES users(id);
