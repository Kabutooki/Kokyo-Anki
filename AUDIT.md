# v22 データ監査

- カード数: 1,925
- v21→v22 問題内容差分: 0
- ID重複: 0
- 問題文空欄: 0
- 正答空欄: 0
- 誤答数不足: 0
- 正答と誤答の重複: 0
- 4択内誤答重複: 0
- 複数回答の項目数不一致: 0
- 意味ベクトル欠落: 0
- ベクトル次元不一致: 0
- 近傍ID不正: 0

詳細は `DATA_AUDIT_v21.md`、`DISTRACTOR_AUDIT.md`、`SEMANTIC_AUDIT_v22.md` を参照してください。


## v23 iPhone blue-outline bug fix
- 原因候補をCSSまで追跡し、選択肢の青色 `:hover` が全ポインタ種別に適用されていたことを確認。
- iOS Safari / standalone PWA のタッチでhover状態が残るケースを避けるため、青色hoverを `(hover:hover) and (pointer:fine)` のみに制限。
- touch/coarse pointerでは選択肢のfocus outlineを抑制。
- correct/wrongの緑・赤状態は変更なし。
- cards.json checksum/contentは変更なし。


## v24 セッション演習監査
- 初期問題数: 20問
- 数値指定: 1〜全カード数の範囲へ正規化
- 候補数 < 指定数: 候補全問を出題
- セッション状態: setup / active / completed
- 最終問後: completedへ自動遷移
- 途中終了: 回答済みのみ成績に含め、未回答数を結果画面に明示
- 演習中の条件変更: UIをロック
- v23教材データとの `cards.json` SHA-256一致を検査
