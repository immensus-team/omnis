import type { ko } from "./ko.js";

/** 사전 한 벌의 형태. ko.ts가 진실 원천이고 여기서는 그 형태만 빌려온다(타입 전용 import라
 * 런타임 순환은 없다). 화면(namespace)이 슬라이스마다 파일 단위로 추가되므로 닫힌 유니온으로
 * 굳히지 않는다 — ko에 키를 더하면 Dictionary와 DottedKeyPath가 자동으로 넓어진다. */
export type Dictionary = typeof ko;

/** 리프(문자열)까지의 점 표기 경로: "common.draftCard.editAndSend", "emptyStates.inbox" … */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type DottedKeyPath = Paths<Dictionary>;

/** 치환 변수. 복수형은 값이 숫자면 `{count, plural, …}` 규약에 걸린다(index.ts 참고). */
export type Vars = Record<string, string | number>;

export type Locale = "ko" | "en";
