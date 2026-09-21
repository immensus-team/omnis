-- US-D10: the detail pane's two settings. The pane is resizable and collapsible, and both facts
-- outlive the window — they are the viewer's own layout, so they belong in the settings KV rather
-- than in localStorage (the D7 note in packages/ui/src/lib/rail-order.ts assumed there was no HTTP
-- route for this; GET /settings and PUT /settings/:key exist in apps/hub/src/http.ts).
--
-- `ui.detail_width` defaults to null rather than to a number: the shipped width is a layout
-- constant that has to stay adjustive (it is a grid track at >=1280 and a sheet elsewhere), so the
-- unset state means "whatever the layout would do" rather than a pixel value frozen into the
-- database. `ui.detail_collapsed` is a real boolean default.
INSERT INTO settings (key, value) VALUES
  ('ui.detail_width', 'null'),
  ('ui.detail_collapsed', 'false')
ON CONFLICT (key) DO NOTHING;
