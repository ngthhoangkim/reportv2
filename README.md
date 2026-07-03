# Report V2 Phase 1

Node.js service chạy trên Windows có Microsoft Word. SQL Server chỉ dùng để đọc dữ liệu, không tạo DB/table và không ghi dữ liệu vào SQL.

## Setup

```powershell
cd C:\ReportV2
copy .env.example .env
npm install
npm start
```

Điền `.env` theo SQL Server và UNC paths của máy chạy thật. Không dùng mapped drive nếu chạy bằng Task Scheduler; dùng UNC path như `\\server\share\img`.

## API

- `GET /health`
- `GET /api/cases/:fileNum`
- `GET /api/cases/:fileNum/:sessionId`
- `POST /api/reports/generate`
- `POST /api/backfill`
- `GET /api/jobs/recent`

Generate thủ công:

```powershell
Invoke-RestMethod http://localhost:3000/api/reports/generate `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"fileNum":"16012083","sessionId":855699,"force":true,"upload":false}'
```

Backfill:

```powershell
npm run backfill -- --date 2026-05-22 --dry-run
npm run backfill -- --from 2026-05-01 --to 2026-05-31 --force --upload
npm run backfill -- --fileNum 16012083 --sessionId 855699 --force
npm run backfill -- --failed-only --force --upload
```

## Word Flow

- Nếu có `Templates/full-report.docx`, service render DOCX bằng `docxtemplater`, sau đó convert PDF bằng Word COM.
- Nếu template là `.doc`, service cache bản `.docx` trong `tmp/template-cache`.
- Mỗi job chỉ convert PDF một lần cuối.
- Queue Word COM chạy tuần tự để tránh nhiều `WINWORD.EXE` chạy song song.
- Nếu chưa có template, Phase 1 sinh PDF summary để kiểm tra dữ liệu và luồng end-to-end.

## File Names

CDHA giữ đúng quy tắc v1 để upload S3 overwrite file cũ:

- Mặc định tạo từng file theo từng dòng `CN_ImagingResult.FileName`.
- Ví dụ mỗi item CDHA sẽ upload thành `khambenh/{FileName}.pdf`.
- Flow tổng session chỉ dùng khi truyền `mode=session`.

Toa thuốc v1 upload vào `khambenh/toathuoc/` với tên `{sessionId}.pdf`.

## Run Hidden On Windows

```powershell
npm run service:install
npm run service:status
npm run service:logs
npm run service:stop
```

Task Scheduler chạy bằng Windows user đang login để Word COM có profile người dùng.

## Logs And State

Logs JSONL nằm trong `logs/`:

- `app-YYYY-MM-DD.jsonl`
- `worker-YYYY-MM-DD.jsonl`
- `job-YYYY-MM-DD.jsonl`
- `backfill-YYYY-MM-DD.jsonl`
- `upload-YYYY-MM-DD.jsonl`
- `error-YYYY-MM-DD.jsonl`

State local nằm trong `data/state/`:

- `source-snapshots.json`
- `generated-files.jsonl`
- `failed-jobs.jsonl`
- `failed-uploads.jsonl`
