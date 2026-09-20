# 복구 리허설 로그 (US-B41)

분기 1회 `bash ops/scripts/restore-drill.sh`(인자 없이)를 돌려 이 파일에 결과가 자동으로 append된다.
실패하면 다음 분기까지 미루지 않고 즉시 Sev1로 고친다(A6 §4).
