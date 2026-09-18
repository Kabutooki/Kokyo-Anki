# v22 QA TEST RESULTS

## 構文・ファイル
- `app.js`: `node --check` PASS
- `sw.js`: `node --check` PASS
- `cards.json`: JSON parse PASS
- `manifest.webmanifest`: JSON parse PASS
- `VERSION.json`: JSON parse PASS

## 教材データ
- v21とv22の全1,925問について、問題文・正答・誤答・分野・出典・重要度の全件比較: PASS（差分0）
- 48次元ベクトル: 1,925 / 1,925
- 近傍24件: 1,925 / 1,925
- 自分自身を近傍に含むカード: 0
- 近傍ID不正: 0
- クラスタ範囲外: 0
- 2D座標範囲外: 0

## 学習エンジン単体シミュレーション
- 誤答履歴0件 → ホットエリア0 / 意味弱点デッキ0: PASS
- 「控訴→上告」を誤答 → 控訴・上告双方へ弱点熱量: PASS
- 複数分野を同時に誤答 → 複数ホットエリアを検出: PASS
- 意味弱点デッキで同一クラスタ3連続を避ける: PASS
- 既存の2連続正答・定着確認ロジックを保持: 構文・静的回帰確認 PASS

## 未実施
この実行環境ではiPhoneホーム画面PWAの実機操作はできないため、実機でのタップ・バックグラウンド復帰・オフライン起動・Service Worker更新は未実施です。


## v23 UI回帰確認
- タッチ端末向けCSSで `.choice:hover` の青色スタイルが無効になることを静的検査。
- `.choice.correct` / `.choice.wrong` の緑・赤フィードバック規則は変更なし。
- デスクトップの `:focus-visible` を維持。
- app.js / sw.js syntax check: pass。
- cards.json: 変更なし。


## v24 追加QA項目
- app.js JavaScript syntax check
- sw.js JavaScript syntax check
- VERSION.json / cards.json JSON parse
- 必須UI ID存在確認
- default session size = 20 の静的確認
- sessionPhase 3状態のコード存在確認
- 最終問で finishSession('completed') が呼ばれることを静的確認
- v23/v24 cards.json SHA-256完全一致
- ZIP integrity check

### v24 実ブラウザ相当テスト（Chromium / iPhone 390×844 viewport）
Playwright の `setContent` + ローカル教材データ注入で、ネットワークに依存せずUI状態遷移を実行した。

- 初期表示が `SESSION SETUP` であること: PASS
- 初期問題数が20: PASS
- 問題カードが開始前に非表示: PASS
- 1問指定 → 演習開始 → 4択回答 → 自動で終了画面: PASS
- 終了結果が `1/1` になり、正解+不正解=1: PASS
- 終了画面から条件設定へ戻れる: PASS
- 3問指定 → 開始 → 未回答のまま途中終了 → `0/3` と未回答3問表示: PASS

※これはiPhone実機SafariそのものではなくChromiumのモバイルviewportによる回帰テスト。iPhoneホーム画面PWA固有の最終確認は実機で行うのが望ましい。
