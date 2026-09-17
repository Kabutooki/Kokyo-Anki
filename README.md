# 公共一問一答 PWA

『公共一問一答』を4択形式で学習するPWAです。重要度別・分野別学習、検索、シャッフル、学習履歴保存に対応しています。

## GitHub Pages で公開する手順

1. GitHubで新しいリポジトリを作成します。例: `koukyou-flashcards`
2. このフォルダの**中身をすべて**リポジトリ直下にアップロードします。
   - `index.html`
   - `manifest.webmanifest`
   - `sw.js`
   - `icons/` フォルダ
   - `.nojekyll`
   - `README.md`
3. GitHubのリポジトリで **Settings → Pages** を開きます。
4. **Build and deployment → Source** を `Deploy from a branch` にします。
5. **Branch** を `main`、フォルダを `/(root)` にして **Save** します。
6. 数分待ち、Pages画面の **Visit site** から公開URLを開きます。

公開URLは通常、次の形式です。

`https://あなたのGitHubユーザー名.github.io/koukyou-flashcards/`

## iPhoneでホーム画面に追加

1. 公開URLを **Safari** で開きます。
2. Safariの共有ボタンをタップします。
3. **「ホーム画面に追加」** を選びます。
4. **「追加」** をタップします。
5. 以後はホーム画面のアイコンから起動できます。

初回にオンラインで一度開くと、Service Worker がアプリ本体をキャッシュするため、その後はオフラインでも利用できます。

## 更新するとき

同じGitHubリポジトリの `index.html` などを新しい版に置き換えてコミットしてください。GitHub Pagesが再公開された後、Safari/PWAを再度開くと更新版が取得されます。

## 注意

GitHub Pagesで公開したサイトはインターネット上からアクセスできる状態になります。教材本文・問題など第三者の著作物を含む場合は、公開する権利・許可がある場合にのみ公開してください。
