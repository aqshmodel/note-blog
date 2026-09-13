# Troubleshooting

## 現在の推奨経路: 既存Chrome接続

専用profileでログイン状態を保持できないため、現在はユーザーがログイン済みの既存ChromeへCodex Desktopのブラウザ連携から接続します。通常ChromeのprofileやCookieをPlaywrightへ渡すのではなく、note専用タブで`https://note.com/settings/account/note_id`を直接開きます。`note ID`入力欄が1件だけで値が`aqsh`であることを、書き込み前に必ず確認します。メール欄のある設定一覧は本人確認に使いません。

## `aqsh-note login`でGoogle等の外部認証へ進むとログインできない

Playwright管理下のChromeは、Googleなどの外部認証側から自動操作ブラウザとして拒否される場合があります。現在の`login`コマンドは、初回認証だけ自動操作フラグのない通常モードのChromeを専用データディレクトリで開きます。

1. 開いた専用Chromeで、`aqsh`または登録メールとnote用パスワードによるログインを完了する。AqshではGoogleログインを使わない。
2. `https://note.com/aqsh`がログイン状態で表示できることを確認する。
3. 専用Chromeを前面にし、`⌘Q`でそのChromeインスタンスを終了する。macOSの赤い閉じるボタンだけではプロセスが残る場合がある。
4. CLIが同じ専用profileをPlaywrightで再度開き、アカウント設定のnote IDが`aqsh`であることまで確認する。

note IDでログインする場合は「メールアドレス または note ID」に`aqsh`または登録メールを入力する。note用パスワードが未設定なら「パスワードを忘れた方/ログインでお困りの方」から再設定する。

### 「連携済みのアカウントがなかったため、新規会員登録をしてください」

Google側のメールアドレスと既存noteアカウントの登録メールが同じでも、Googleログインが既存アカウントへ自動連携されるとは限りません。この表示は既存アカウントが消えたという意味ではありません。

- 新規登録ボタンは押さない。
- `https://note.com/login`へ戻る。
- Googleボタンではなく、`aqsh`または登録メールと既存のnote用パスワードでログインする。
- パスワードが不明な場合だけ、note公式のパスワード再設定を使う。

通常ChromeのCookieやprofileを専用profileへコピーして回避してはいけません。既存Chromeを使う場合もCodexのブラウザ連携だけを使用します。

## `PROFILE_IN_USE`

同じ専用profileを別の`aqsh-note`プロセスが使用中です。開いている専用Chromeを終了し、実行中コマンドがないことを確認してから再実行します。クラッシュで残ったロックは次回起動時に削除せず`.stale-*`として保存します。

## `PROFILE_BROWSER_STILL_RUNNING`

macOSの赤い閉じるボタンでは、ウィンドウが消えても専用Chrome本体が残ることがあります。専用Chromeを前面にして`⌘Q`で終了し、再実行します。普段使いのChromeは終了対象にしません。

## `PREFLIGHT_FAILED`

`--json`結果の`errors`を確認します。画像欠落、リモート画像、title不一致、更新先不足などのCriticalがある間はブラウザを起動しません。

## Node.js 24が選ばれない

```bash
nvm use
node --version
npm run aqsh-note -- doctor
```

`v24.19.0`であることを確認します。

## 実行証跡を確認したい

```bash
npm run aqsh-note -- recover
```

証跡は`~/.local/state/aqsh-note/runs`にあります。raw Playwright traceはCookie等を記録し得るため、現在は全操作で生成しません。ログイン・登録・設定・外部画面のスクリーンショットも生成しません。本文操作の画像は本人確認後かつ許可済みの編集・管理記事URLだけに限定し、GitHubへ追加・共有しません。`result.json`は保存時と表示時の両方で機密値をredactします。
