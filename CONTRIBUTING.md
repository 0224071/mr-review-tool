# 貢獻指南

## 分支與 commit

- 一律從最新的 `main` 開分支，**不能直接 push 到 `main`**，所有改動都經由 PR 合併。
- 分支命名：`feat/…`、`fix/…`、`chore/…` 等，簡短描述用途。
- commit 訊息採 `類型: 說明（#issue）` 格式，例如 `fix: 修正行號驗證 (#4)`。
- commit 的作者 email 使用 GitHub 提供的 noreply email（`<id>+<帳號>@users.noreply.github.com`），不要用個人或公司信箱。
- commit 訊息不要加 `Co-authored-by` 等共同作者標記。

## 分支同步

分支落後 `main` 時，一律用 merge 同步：

```bash
git fetch origin
git merge origin/main
```

- **不 rebase**、**不 force push**（包含 `--force-with-lease`），避免改寫已推上去的歷史、讓審查中的留言對不上。

## PR 流程

1. 開 PR 時使用範本（`.github/pull_request_template.md`），填寫 `Closes #`、變更摘要、預覽網址、測試結果，並逐項確認檢查清單。
2. 指派 Code Reviewer 審查。
3. 依審查意見修正後回覆對應討論。

## 審查意見等級

審查者在意見開頭標註等級：

| 等級 | 意義 | 處理方式 |
| --- | --- | --- |
| **必修** | 錯誤、安全問題、違反規範等 | 合併前必須修正 |
| **建議** | 更好的做法或設計考量 | 可討論；接受並修改，或說明不採納的理由 |
| **小問題**（nit） | 命名、排版、措辭等細節 | 可選，不影響合併 |

## 審查深度

依 issue 上的「規模」欄位決定審查要審到多深：

| 規模 | 審查重點 |
| --- | --- |
| **S** | 小改動：檢查正確性、測試、CI |
| **M** | S 的全部，加上設計與邊界情況、對相關模組的影響，必要時在本機或預覽環境實測 |
| **L** | M 的全部，加上架構與拆分建議、完整實測；建議分兩階段審查（先看設計再看實作）或拆成較小的 PR |

## Code Reviewer 結論

- Code Reviewer 審完後，把結論寫成一則 **PR 留言**（例如「審查通過」或列出必修項目），留下紀錄。
- 結論為可合併時，在 PR 加上 `reviewed` 標籤。
- 審查結論以留言與標籤記錄，不使用 GitHub 的 approve 功能計數。

## 合併條件（main 分支保護）

`main` 受分支保護，以下全部滿足才能合併：

- 必要檢查全部通過：`ci`、`gitleaks`、`e2e`
- 所有對話（review conversations）都已 resolved
- Code Reviewer 已留言記錄結論並加上 `reviewed` 標籤
- **不需要** approval 數（不要求核准人數）

補充：

- 禁止直接 push 到 `main`，一律透過 PR 合併。
- Vercel 預覽網址為公開，不需登入；不設定 bypass secret。

## 緊急修正

線上功能壞掉、安全問題等緊急狀況，可以先合併再審查：

- PR 標題與說明需標明為「緊急修正」。
- PR 要加上 `hotfix` label。
- 合併後 24 小時內必須完成補審。
- 補審發現的問題另開 issue 追蹤。
