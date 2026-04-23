# n8nctl

> 🇬🇧 **[Read in English](./README.md)**

**kubectl cho n8n.** CLI quản lý n8n workflows qua REST API — gọn, lẹ, script được.

Monorepo này gồm 2 npm package:

| Package | Mục đích | npm |
|---------|----------|-----|
| [`@trngthnh369/n8nctl`](./packages/n8nctl) | CLI đầy đủ | [![npm](https://img.shields.io/npm/v/@trngthnh369/n8nctl.svg)](https://www.npmjs.com/package/@trngthnh369/n8nctl) |
| [`@trngthnh369/n8n-workflow-validator`](./packages/n8n-workflow-validator) | Validator workflow JSON offline (6 lớp kiểm tra) | [![npm](https://img.shields.io/npm/v/@trngthnh369/n8n-workflow-validator.svg)](https://www.npmjs.com/package/@trngthnh369/n8n-workflow-validator) |

## Tại sao cần n8nctl?

Nếu bạn dùng n8n thường xuyên và gặp các vấn đề:
- Phải click-click-click trên UI mỗi lần deploy
- Không version control được workflows (git-friendly)
- Không biết workflow fail cho đến khi user báo
- Mỗi lần deploy quên backup, sợ mất dữ liệu
- Quản lý nhiều instance (dev/staging/prod) → mất thời gian đổi URL

→ `n8nctl` giải quyết hết qua terminal, tích hợp được vào CI/CD.

## Cài đặt (chỉ 1 lệnh)

```bash
npm install -g @trngthnh369/n8nctl
```

Yêu cầu: Node.js 20+.

## Khởi động nhanh

```bash
# 1. Login 1 lần (API key lưu vào OS keyring — bảo mật)
n8nctl auth login
# ? n8n host (URL): https://n8n.example.com
# ? API key: ****

# 2. Check sức khoẻ toàn hệ thống
n8nctl doctor

# 3. List workflows
n8nctl workflow list --active

# 4. Backup trước khi thay đổi
n8nctl workflow backup 42 -o ./backups/

# 5. Validate JSON offline trước khi deploy
n8nctl workflow validate ./my-workflow.json --strict

# 6. Xem diff trước khi update (safe!)
n8nctl workflow diff 42 ./my-workflow.json

# 7. Deploy + activate
n8nctl workflow update 42 ./my-workflow.json
n8nctl workflow activate 42

# 8. Test trigger webhook + đợi kết quả
n8nctl workflow trigger-webhook 42 --data '{"input":"test"}' --wait --timeout 60000

# 9. Debug khi lỗi
n8nctl execution last-error --workflow 42 --summary
```

## Tính năng nổi bật

**Quản lý workflow đầy đủ** — create, update, activate, backup, restore, delete, diff, tag, export-all, import, validate, trigger-webhook.

**Multi-instance profiles** — dev/staging/prod, switch 1 lệnh:
```bash
n8nctl profile add prod --host https://n8n-prod.example.com
n8nctl profile switch prod
n8nctl --profile dev workflow list    # một lần override
```

**Auth phân lớp** (kiểu `gh`):
1. `--api-key` flag (ephemeral, cho CI)
2. Env vars `$N8N_API_KEY` + `$N8N_HOST`
3. OS keyring qua `keytar` (bảo mật nhất)
4. File `~/.config/n8nctl/config.yml`

**Output linh hoạt** (kiểu `gh`):
```bash
n8nctl workflow list                              # TTY: bảng đẹp
n8nctl workflow list | cat                        # piped: JSON
n8nctl workflow list --json                       # ép JSON
n8nctl workflow list --jq '.[] | select(.active)' # jq filter
n8nctl workflow list --template '{{#each this}}{{id}} {{name}}{{newline}}{{/each}}'
```

**Validator offline 6 lớp** (không cần internet):
1. Cấu trúc JSON
2. Tham chiếu connection → node
3. Cú pháp expression `{{ }}`
4. Rò rỉ secrets (Bearer, JWT, AWS key, Google API key, Slack token)
5. Sanity node (duplicate id/name, typeVersion, position, parameters)
6. Type check parameter theo node catalog (21 native nodes sẵn)

**An toàn production**:
- `--dry-run` cho mọi lệnh destructive
- Retry + exponential backoff + Retry-After
- `--insecure` flag (self-signed TLS dev)
- File lock config (tránh race condition)
- Typed exit codes: 0 OK / 1 API / 2 auth / 3 validation / 4 network / 5 internal

## Exit codes (dùng trong scripts)

| Code | Nghĩa |
|------|-------|
| 0 | Thành công |
| 1 | Lỗi API (4xx/5xx từ n8n) |
| 2 | Lỗi auth (thiếu/sai credentials) |
| 3 | Lỗi validation (file sai, args sai) |
| 4 | Lỗi network (timeout, DNS, connection refused) |
| 5 | Lỗi nội bộ (bug bất ngờ) |

Dễ viết logic shell:
```bash
n8nctl workflow validate wf.json --strict && \
  n8nctl workflow update 42 wf.json && \
  n8nctl workflow activate 42
```

## Use cases

### Git-ops cho workflows
```bash
# Commit tất cả workflows vào git
n8nctl workflow export-all -o ./workflows/
git add workflows/ && git commit -m "snapshot"

# Restore toàn bộ vào instance mới
n8nctl --profile staging workflow import ./workflows/ --force
```

### CI/CD pipeline
```bash
# .github/workflows/deploy-n8n.yml
- run: npx @trngthnh369/n8nctl workflow validate $FILE --strict
- run: npx @trngthnh369/n8nctl workflow update $ID $FILE
  env:
    N8N_API_KEY: ${{ secrets.N8N_API_KEY }}
    N8N_HOST: ${{ secrets.N8N_HOST }}
```

### Self-healing pipeline
```bash
#!/bin/bash
n8nctl workflow trigger-webhook 42 --data @payload.json --wait
if [ $? -ne 0 ]; then
  n8nctl execution last-error --workflow 42 --summary
  # ... auto-patch + retry logic ...
fi
```

## Lấy cảm hứng từ đâu?

- **[`gh`](https://cli.github.com/)** (GitHub CLI) — structure noun/verb, factory pattern, `--json/--jq/--template` trio
- **[`kubectl`](https://kubernetes.io/docs/reference/kubectl/)** — ergonomics + exit code philosophy
- **[`gws`](https://github.com/googleworkspace/cli)** — exit codes 0-5, AI helpers

## Đóng góp

PRs welcome! Tuân theo [conventional commits](https://www.conventionalcommits.org/) để `semantic-release` tự cut release.

Report bug: https://github.com/trngthnh369/n8nctl/issues

## License

MIT — tự do sử dụng, chỉnh sửa, distribute.
