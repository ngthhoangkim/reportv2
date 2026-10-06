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

## Chạy bằng PM2

Hai app trong `ecosystem.config.js`:

| App | Việc | autorestart |
| --- | --- | --- |
| `reportv2` | Server + worker daily incremental (dữ liệu mới) | `true` |
| `reportv2-backfill` | Backfill quá khứ theo từng ngày/tháng | `false` (bắt buộc) |

Daily incremental:

```bash
pm2 start ecosystem.config.js --only reportv2
pm2 logs reportv2
pm2 save
```

Worker không còn quét lặp cửa sổ 48h mỗi 30 giây. Nó lưu mốc đã xử lý vào
`data/state/worker-cursor.json`; mỗi lần chạy chỉ query từ mốc đó trừ overlap nhỏ
(`WORKER_CURSOR_OVERLAP_MINUTES`, mặc định 15 phút) tới thời điểm đã ổn định
(`WORKER_SETTLE_SECONDS`, mặc định 60 giây). Lần đầu tiên dùng
`WORKER_INITIAL_LOOKBACK_HOURS` (mặc định 48h). Sau đó worker chỉ tự chạy theo giờ
trong `WORKER_SCHEDULE_TIMES` (mặc định `02:15,14:15`, theo giờ local của máy chạy app).

SQL pool tự đóng sau khi idle `DB_IDLE_CLOSE_SECONDS` giây (mặc định 30s), nên app không giữ
kết nối DB liên tục giữa hai khung giờ sync. Nếu upstream sync lỗi và chưa có data mới, service
sẽ không tự retry dồn dập; sau khi sửa sync có thể chạy tay qua `POST /api/backfill` với `date`
hoặc `from/to`.

### Dọn file local

Service mặc định cố gắng không giữ file local:

- Sau upload thành công, PDF trong `output/` bị xoá ngay (`CLEANUP_AFTER_UPLOAD=true` mặc định).
- Khi app khởi động, các file output cũ và thư mục render tạm còn sót sẽ bị dọn.
- Cleanup worker chạy mỗi `CLEANUP_INTERVAL_SECONDS` giây (mặc định 30s), xoá output cũ hơn
  `CLEANUP_OUTPUT_STALE_SECONDS` (mặc định 10 phút) và thư mục tạm cũ hơn
  `CLEANUP_TMP_STALE_SECONDS` (mặc định 30 phút).
- Log JSONL mặc định giữ 7 ngày, state JSONL mặc định tự trim ở 5MB/file.

Backfill quá khứ (sửa `BACKFILL_FROM` / `BACKFILL_TO` trong `ecosystem.config.js` trước):

```bash
pm2 start ecosystem.config.js --only reportv2-backfill
pm2 logs reportv2-backfill
```

Backfill mặc định chạy **từng ngày một, mới nhất trước** để mỗi lần query DB nhỏ và dễ resume.
Nếu muốn chạy theo tháng như cũ, đặt `BACKFILL_CHUNK=month` hoặc truyền `--chunk month`.
Tiến độ ghi vào `data/state/backfill-cursor.json` sau mỗi chunk. Dừng giữa chừng rồi start
lại thì nó bỏ qua các ngày/tháng đã xong. Một chunk lỗi không chặn các chunk còn lại — lỗi
được ghi vào cursor, chạy lại với `--retry-failed`.

Chạy tay không qua PM2:

```bash
npm run backfill:chunked -- --from 2022-07-01 --to 2025-06-30
npm run backfill:chunked -- --from 2022-07-01 --to 2025-06-30 --retry-failed
npm run backfill:chunked -- --from 2022-07-01 --to 2025-06-30 --reset       # bỏ cursor, chạy lại từ đầu
npm run backfill:chunked -- --from 2024-01-01 --to 2024-12-31 --oldest-first
npm run backfill:chunked -- --from 2024-01-01 --to 2024-12-31 --chunk month
```

Cờ: `--types cdha,prescription`, `--chunk day|month`, `--force` (làm lại cả case đã có), `--upload false`.

### Word COM lock

Word chỉ cho một instance automation trên mỗi phiên Windows. Hai process cùng gọi Word COM sẽ
gây `RPC_E_CALL_REJECTED` / Word treo. Vì vậy mọi lần dùng Word đều phải giành lock file
`data/state/word-com.lock` ([comLock.js](src/modules/state/comLock.js)): realtime và backfill tự
xen kẽ nhau ở mức từng case, không cần tắt cái nào. Lock có heartbeat 5s, process chết đột ngột
thì process sau tự thu hồi.

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
- `worker-cursor.json` (mốc incremental cho worker daily)
- `backfill-cursor.json` (tiến độ backfill theo tháng)
- `word-com.lock` (lock Word COM, tự xoá khi nhả)
- `generated-files.jsonl`
- `failed-jobs.jsonl`
- `failed-uploads.jsonl`

Nếu cần giải phóng dung lượng state trên máy chạy thật, dừng PM2 trước rồi xoá/di chuyển
`data/state/`. Service sẽ tự tạo lại state tối thiểu khi chạy lại; mất state chỉ làm mất lịch sử
skip/backfill cursor, không xoá dữ liệu gốc trong SQL/S3. Các file JSONL state được giữ tối đa
`STATE_JSONL_RETENTION_MB` (mặc định 50MB), còn snapshot chỉ lưu hash/trạng thái nhỏ để tránh
phình dung lượng.
