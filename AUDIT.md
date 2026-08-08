# GIGA句会プラザ 点検記録（GIGA Standard v4）

2026-08-03 時点。数字はすべて**実測**。測っていないものは「未計測」と書く。

## 測り方

本番（`script.google.com`）へは作業環境から到達できないため、
**GAS が返す画面と同じものを手元で組み立てて**測った
（`index.html` の `include()` を実体に置き換え、`google.script.run` をダミーにする）。

計測環境：Chromium 141（Playwright）、1280×900 / DPR 2。
道具は Digital_textbook の
[`scripts/measure/`](https://github.com/GIGAyama/Digital_textbook/tree/main/scripts/measure)。

**この作業環境は `cdn.tailwindcss.com` / `unpkg.com` / `cdn.jsdelivr.net` へ出られない。**
つまり**学校のフィルタリングとまったく同じ状態**で測っている。これは都合がよかった。

---

## 1. いちばん重い：フィルタリングされると画面が一切出なかった

改修前の `index.html` はこう始まっていた。

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/..."></script>
```

**この5本のうち1本でも届かないと、画面は白いまま何も起きない。**
実測でそうなった。

```json
"問題": ["JS: ReferenceError: tailwind is not defined"],
"読み込み失敗": [
  "https://cdn.tailwindcss.com/ :: net::ERR_TUNNEL_CONNECTION_FAILED",
  "https://unpkg.com/react@18/... :: net::ERR_TUNNEL_CONNECTION_FAILED",
  "https://unpkg.com/@babel/standalone/babel.min.js :: ...",
  ...
]
```

児童からは「壊れている」としか見えない。しかも原因はアプリの外にあるので、
先生が調べても分からない。

### さらに、開くたびに JSX をコンパイルしていた

`@babel/standalone` は **3MB 近くある**うえ、その役目は
**ブラウザの中で JSX を JavaScript に翻訳すること**。
つまり児童が開くたび、728行の JSX を毎回コンパイルし直していた。
40人が同時に開く校内 Wi-Fi では、この時間がそのまま待ち時間になる。

### どう直したか

**全部「先に作っておく」ことにした。**

| もの | 前 | 後 |
|---|---|---|
| Tailwind | ブラウザ内で CSS を生成 | 使っているクラスだけの CSS を先に作る（`css.html`） |
| JSX | ブラウザ内で毎回コンパイル | **ビルド時に1回だけ**コンパイル（`app.html`） |
| React / ReactDOM | unpkg | GAS 側に置く（`vendor.html`） |
| canvas-confetti | jsDelivr | 同上 |

転送量は **約3.3MB → 237KB**。CDN への依存はゼロになった。

```
vendor.html  156.5 KB
css.html      28.1 KB
app.html      52.3 KB
```

直したあとの実測（**CDN が塞がれたまま**）：

```json
"問題": [],
"読み込み失敗": ["fonts.googleapis.com のみ（フォントは無くても崩れない）"]
```

**画面は最後まで出て、6画面すべて操作できた。**

> **`src/app.jsx` が編集する場所。** `app.html` / `css.html` / `vendor.html` は
> `npm run build` が作る生成物なので、手で編集しない。

---

## 2. 拡大を禁止していた

```js
// code.gs（改修前）
.addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
```

**見えづらい子が画面を大きくできない。** 外した。

> 手元で組み立てて測ったとき、`addMetaTag` はサーバー側の処理なので再現されず、
> **一度「viewport の指定が無い」と読み違えた。**
> GAS の画面を測るときは、`index.html` だけでなく `code.gs` の `doGet` も必ず読むこと。

`viewport-fit=cover` は `index.html` と `code.gs` の**両方**に入れた。
GAS は画面を iframe で包むため、片方だけでは安全領域が使えるようにならない。

---

## 3. コントラストとタップ領域

6画面（ようこそ・投稿・広場・自分・過去・先生）を歩いて測った。

| 対象 | 色 | 比 | 直し方 |
|---|---|---:|---|
| ふりがな（送信ボタン上） | 白 on `#d9534f` | **3.96** | ボタンを `#c9302c` に（hover の色にそろえた） |
| 「うへのく／なかのく／したのく」 | `text-slate-300` | **1.48** | `text-slate-500` |
| 「完成プレビュー」 | `text-slate-400` | 2.46 | `text-slate-600` |
| 「現在0文字 (目安:5)」 | `text-slate-400` | 2.56 | 同上 |
| フッター（8か所） | `text-slate-400` | 2.56 | 同上 |
| フッターのリンク | — | 49×16 | 当たり判定だけ 44px に |

**「うへのく／なかのく／したのく」は、俳句のどこを書く欄かを示す案内**で、
比 1.48 はほぼ見えない。**このアプリでいちばん必要な案内が、いちばん見えなかった。**

ふりがなの色は `#64748b` を `#5b6472` にし、色のついた面では継がせるようにした。

**結果：9件 → 0件、タップ 1件 → 0件。**

---

## 4. そのほか入れたもの

- `env(safe-area-inset-*)`（左右下）
- `100dvh`（`@supports` で古い端末に `100vh` を残す）
- `prefers-reduced-motion`（`0.01ms` を残す。`0` にすると `fade-in` が
  `opacity:0` のまま消える）
- `forced-colors`
- `touch-action: manipulation`
- Google Fonts が塞がれても崩れないよう、端末側の明朝体を後ろに並べた
- LICENSE / dependabot / `.gitignore`

---

## 5. 未計測・未対応

- **PWA 化していない**（manifest / Service Worker / offline.html なし）。
  C型は `script.google.com` 配信のため、GitHub Pages 側のシェル（C+型）を
  作らないと PWA にできない。構成の変更なので別途判断が要る。
- サーバーの戻り値に依存する画面（実際の投稿一覧、投票結果）は未計測。
  ダミーは見本しか返さないため、件数の多い一覧は再現していない。
- CSP は入れていない。GAS は `HtmlService` が独自のサンドボックスで包むため、
  `<meta>` の CSP がどう働くかを本番で確かめないと判断できない。
- 本番の URL・デプロイ状態は未確認（到達できないため）。

---

## 6. この PR をマージしてよいか

**構成を変えています。** `index.html` は `include()` で
`vendor.html` / `css.html` / `app.html` を読む形になりました。
`code.gs` に `include()` を足しています。

表示まわりは手元で実測していますが、**本番での動作確認は取れていません。**
そのため**自動ではマージしていません。**
テスト用のデプロイで一度動かしてから取り込んでください。

とくに確かめてほしいところ：

1. 画面が最後まで出るか（`include()` が3つとも通っているか）
2. 投稿・投票が今までどおりできるか
3. 紙吹雪が出るか（`canvas-confetti` を GAS 側に移したため）

---

## 7. 作り直す手順

```bash
npm install
npm run build   # app.html / css.html / vendor.html を作り直す
```

**`src/app.jsx` を直したら、必ず `npm run build` を走らせてから push すること。**
生成物を更新し忘れると、変更が画面に出ない。

> `package-lock.json` が無いため `npm ci` は使えない。
> また `npm install` は `^` の範囲で新しい版を取るので、生成物のサイズが
> ここに載せた実測値と変わることがある。作り直したら `git diff` で確かめること。
