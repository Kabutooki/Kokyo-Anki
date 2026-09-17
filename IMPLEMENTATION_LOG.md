# v21 実装記録

ユーザー指定の「主要提案上位8項目」を、次の順に累積実装しました。下位5項目（アクセシビリティ全面改修、CI/QA自動化、模試、端末間同期、通知）は実装していません。

1. **v14相当：PWA状態遷移の堅牢化** — `pendingAdvance` に現在カード・次カード・期限を保存し、`visibilitychange` / `pageshow` / `focus` で復帰整合。タイマーは補助に変更。
2. **v15相当：安全な更新方式** — Service Workerはinstall時に即 `skipWaiting` しない。学習中は更新を待機させ、セット終了または安全なpagehide時にactivation。強制reloadを廃止。
3. **v16相当：問題データ構造化** — 1,925問を `cards.json` へ分離。taxonomy/source/prompt/answer/distractors/importance/quality/feedback を構造化。
4. **v17相当：習熟後の定着確認** — 2連続正答=習熟を維持。1→3→7→21→45日を基礎とした定着確認キューを追加。
5. **v18相当：自動誤答ノート・混同ペア** — 選択した誤答を記録し、混同ペアを端末内集計。「誤答ノート」と「混同ペア」表示を追加。
6. **v19相当：診断型誤答管理** — answer/entity class、arity、provenance等を教材側に保持。誤答選択回数を履歴化。正答位置はセッションseedで変化し、位置暗記を抑制。
7. **v20相当：短い訂正フィードバック** — 不正解時のみ、正答・混同対象・一部の重要問題では短い区別根拠を自動表示。正解時のテンポは維持。
8. **v21：IndexedDB移行** — cardState / attemptEvents / sessionState / appMeta / confusionStats をIndexedDBに保存。旧localStorage履歴を自動移行し、localStorageは互換バックアップとして残す。

## 通常演習の操作

演習中のユーザー操作は従来通り **4択から1つ選ぶだけ** です。復習時期、習熟、定着確認、誤答記録、混同集計は自動です。
