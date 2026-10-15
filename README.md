# GitLab MR Review Tool

用 AI 講解與審查 GitLab Merge Request 的工具。

- 輸入 GitLab MR 網址抓取 Diff，或直接貼上 `git diff`
- 依變更意圖分組、畫出結構圖，產生符合團隊規範的審查意見
- 審查意見可發布回 GitLab MR（行內留言／一般留言）
- 支援多種 AI provider：Google Gemini、OpenAI、Anthropic Claude、OpenRouter、OpenAI 相容端點（例如 Ollama）

本工具**純前端**，沒有後端伺服器。瀏覽器直接呼叫 GitLab API 與你選的 AI 服務。

## 需求

- Node.js 22.12 以上（vitest 需要；CI 與部署都使用 Node 22）
- npm（使用 `package-lock.json`）

## 本機執行

```bash
npm ci && npm run dev
```

啟動後開啟 <http://localhost:3000>。dev 伺服器預設只聽本機（localhost），區網其他裝置連不到。

若需要讓區網其他裝置（例如手機）連線，可自行加上 `--host`：

```bash
npm run dev -- --host
```

> ⚠️ 這會把 dev 伺服器開放給同一區網的所有裝置，請只在信任的網路使用，用完即關。

### 載入範例

不需要 GitLab 也能先試用：在輸入區點「範例 Diff」載入購物車範例，再點「分析」。分析需要先設定 AI provider（見下一節）。

## 設定

點頁首的「填寫金鑰」（設定完成後顯示為「偏好設定」）開啟設定視窗。

### AI provider

| Provider | 需要填寫 |
| --- | --- |
| Google Gemini | API Key（<https://aistudio.google.com/app/apikey>） |
| OpenAI | API Key（<https://platform.openai.com/api-keys>） |
| Anthropic Claude | API Key（<https://console.anthropic.com/settings/keys>） |
| OpenRouter | API Key（<https://openrouter.ai/settings/keys>） |
| Ollama／自訂 OpenAI 相容 | Base URL（預設 `http://localhost:11434/v1`）、模型，API Key 視服務而定 |

按「測試連線」可以檢查連線並從 `/models` 取得模型清單。

使用 Ollama 時，Ollama 預設會擋下來自其他網頁來源的請求，需要用 `OLLAMA_ORIGINS` 允許：

```bash
OLLAMA_ORIGINS="*" ollama serve
```

### GitLab

填寫 GitLab Base URL（預設 `https://gitlab.com`，自建 GitLab 填自己的網域）與 Personal Access Token。

Token 請給最少權限：

| 用途 | scope |
| --- | --- |
| 只讀取 MR 做分析 | `read_api` |
| 要把審查意見發布成 MR 留言 | `api` |

建立 Token 時建議設定到期日，用完或到期後重新產生。

> 所有金鑰（AI API Key、GitLab Token）只存在你自己瀏覽器的 localStorage，不會送到本工具的任何伺服器。AI API Key 只會送往你選的 AI 服務，GitLab Token 只會送往你設定的 GitLab。

## 內網 GitLab 怎麼連

本工具由瀏覽器用 `fetch` **直接**呼叫 GitLab REST API v4（`/api/v4/...`，以 `PRIVATE-TOKEN` header 帶 Token）。沒有後端、也沒有內建的開發伺服器 proxy，所以能不能連上取決於「你的瀏覽器連不連得到 GitLab」以及下列情況：

- 連線目標：貼完整 MR 網址（`https://<GitLab 網域>/<group>/<project>/-/merge_requests/<iid>`）時，使用網址裡的網域；貼簡寫 `group/project!123` 時，使用設定中的 GitLab Base URL。
- 頁面是 https、GitLab 是 http 時，工具會直接顯示提示並停止請求，不會送出（瀏覽器本來就會擋下混合內容）。

依「工具開在哪」與「GitLab 是 http 還是 https」分成三種情況：

| 工具開在哪 | 內網 GitLab | 結果 |
| --- | --- | --- |
| 本機 `http://localhost:3000`（`npm run dev`） | http 或 https | 可以連。電腦需在公司網路內或已連 VPN。**建議用這種方式** |
| https 部署頁（GitHub Pages／Vercel） | https | 電腦連得到 GitLab（公司網路或 VPN），且 GitLab 允許跨網域請求時可以連 |
| https 部署頁（GitHub Pages／Vercel） | http | **連不上**。https 頁面不能呼叫 http 網址（混合內容），請改用本機執行 |

所以內網 GitLab 是 http 的話，請在本機執行（`npm ci && npm run dev`），不要用 GitHub Pages 上的版本。

## 測試

```bash
npm test          # 等同 npx vitest run
npx tsc --noEmit  # 型別檢查（也可用 npm run lint）
```

## Build

```bash
npm run build                      # 輸出到 dist/，base 為 /
GITHUB_PAGES=true npm run build    # GitHub Pages 用，base 為 /mr-review-tool/
npm run preview                    # 本機預覽 build 結果
```

## 部署

- 正式環境：GitHub Pages
- PR 預覽：Vercel

不論哪種部署方式，都不需要也不應該設定任何 API 金鑰環境變數；金鑰一律由使用者在 UI 中輸入。

### GitHub Pages（正式環境）

push 到 `main` 時由 GitHub Actions（`.github/workflows/deploy-pages.yml`）自動部署，build 時設 `GITHUB_PAGES=true`，base 路徑為 `/mr-review-tool/`。也可以在 Actions 頁面手動執行（workflow_dispatch）。

### Vercel（PR 預覽）

用來產生 PR 的預覽網址，不是正式環境。設定見 `vercel.json`（`npm run build`、輸出 `dist`）。base 為 `/`，**不要**設定 `GITHUB_PAGES`。

## 常見錯誤排除

### Node 版本不對

`npm ci` 或 `npm run dev` 出現語法錯誤、套件要求的 engine 不符等訊息時，先確認版本：

```bash
node -v   # 應為 v22.12 以上
```

可以用 nvm 等工具切換到 Node 22.12 以上（例如 `nvm install 22 && nvm use 22`）。

### 3000 port 被占用

`npm run dev` 固定用 3000 port。被占用時可以改用其他 port：

```bash
npm run dev -- --port 3001
```

然後開啟 <http://localhost:3001>。

### GitLab Token 權限不足

- 401：Token 無效或已過期，請重新產生。
- 404：找不到專案或 MR。確認網址正確，以及 Token 的帳號有該專案的存取權限。
- 讀取正常但發布留言失敗（403）：Token 只有 `read_api`，發布需要 `api` scope。

可以在設定視窗按 GitLab 的「測試連線」確認 Token 是否有效。

### 跨網域（CORS）被擋

瀏覽器 console 出現 CORS 錯誤，或設定視窗顯示「連線失敗：請檢查 Base URL 與網路」時：

- GitLab：本工具由瀏覽器直接呼叫 GitLab API，若 GitLab 前面的反向代理或安全設定沒有回傳允許跨網域的 header，請求會被擋下。請 GitLab 管理員確認 `/api/v4` 允許跨網域請求。
- Ollama：沒有設定 `OLLAMA_ORIGINS` 時會被擋，設定方式見上方「AI provider」。
- 頁面是 https、目標是 http：這是混合內容而不是 CORS，請改用本機執行（見「內網 GitLab 怎麼連」）。
