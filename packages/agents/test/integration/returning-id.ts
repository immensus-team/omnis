/**
 * `INSERT ... RETURNING id` must return exactly one row. No row means the test setup is broken,
 * so stop here instead of leaking an empty string and later blowing up with an unrecognizable
 * uuid error. (biome's noNonNullAssertion forbids `rows[0]!.id`, so this helper collects it.)
 */
export function returningId(r: { rows: { id: string }[] }): string {
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("expected INSERT ... RETURNING id to return a row");
  return id;
}
