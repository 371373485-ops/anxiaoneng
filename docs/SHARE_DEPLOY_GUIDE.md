# 加密分享数据部署指引

## 前提

- 本项目已部署到 GitHub Pages
- 看板中已导入数据

---

## 方式 A：浏览器端一键加密（推荐）

1. 在看板页面 toolbar 点击「加密分享数据」
2. 输入分享密码（至少 16 位字符），两次确认
3. 浏览器自动下载加密文件 `随机token.json`
4. 弹窗会显示完整部署指引

## 方式 B：命令行加密

```powershell
# 1. 导出数据（看板 → 导出分享数据 → 下载 JSON）
# 2. 终端执行加密
node scripts/encrypt-share.mjs 下载的share-data.json pages/data/随机token.json --allowed-org ORG_ID
# 按提示输入密码（≥16 字符）
```

---

## 部署加密文件到 GitHub Pages

```powershell
# 将加密文件放到 pages/data/ 目录
copy 下载的token.json C:\Users\liuyi\.openclaw-autoclaw\agents\agent-aa5swh\workspace\pages\data\

# Git 提交
cd C:\Users\liuyi\.openclaw-autoclaw\agents\agent-aa5swh\workspace
git add pages/data/
git commit -m "更新分享数据 $(Get-Date -Format 'yyyy-MM-dd')"
git push

# 触发部署
# 浏览器打开: https://github.com/你的用户名/仓库名/actions/workflows/deploy-pages.yml
# 点击 "Run workflow" → 等待完成（约 1 分钟）
```

---

## 分享给接收方

```
链接格式: https://你的用户名.github.io/仓库名/share/token/
密码: 你设置的访问密码
```

## 接收方操作

1. 打开链接
2. 输入密码
3. 即可查看完整看板（不含导出/AI 功能，仅只读）

## 注意事项

- 密码不会存储在服务器上，只有加密文件本身
- 加密文件可以安全地公开存放在 GitHub 仓库中（AES-256-GCM + PBKDF2 600,000 次迭代）
- 如果要撤销访问，删除 `pages/data/token.json` 并重新部署即可
- 你的电脑关闭后链接仍然有效（纯静态 GitHub Pages）
- 每个加密文件对应一个独立的密码和 token，互不影响
