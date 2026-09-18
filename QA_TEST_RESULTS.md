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
