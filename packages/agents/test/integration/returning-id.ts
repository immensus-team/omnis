/**
 * `INSERT ... RETURNING id`는 반드시 한 행을 돌려준다. 행이 없으면 테스트 셋업이 깨진 것이므로
 * 빈 문자열을 흘려보내 나중에 알 수 없는 uuid 오류로 터지게 두지 않고 여기서 멈춘다.
 * (biome noNonNullAssertion 때문에 `rows[0]!.id`를 쓸 수 없어 이 헬퍼로 모은다.)
 */
export function returningId(r: { rows: { id: string }[] }): string {
  const id = r.rows[0]?.id;
  if (id === undefined) throw new Error("expected INSERT ... RETURNING id to return a row");
  return id;
}
