# Thiết lập lưu dữ liệu tuần lên Google Drive

Ứng dụng chỉ cần ba giá trị Google OAuth:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`

Không gửi ba giá trị này qua chat, không đưa vào Git và không đặt tiền tố
`NEXT_PUBLIC_`.

## 1. Bật Google Drive API

1. Mở <https://console.cloud.google.com/>.
2. Chọn project Firebase `employee-management-port-339fe`.
3. Vào **APIs & Services** → **Library**.
4. Tìm **Google Drive API** → **Enable**.

## 2. Tạo màn hình đồng ý OAuth

1. Vào **Google Auth Platform** → **Branding**.
2. Nhập tên ứng dụng, email hỗ trợ và email liên hệ.
3. Ở **Audience**, chọn **External**.
4. Nếu ứng dụng còn ở trạng thái Testing, thêm chính Gmail nhận file Drive vào
   **Test users**.
5. Ở **Data Access**, thêm đúng scope:
   `https://www.googleapis.com/auth/drive.file`.

`drive.file` chỉ cho ứng dụng quản lý những file/thư mục do chính ứng dụng tạo,
không cho đọc toàn bộ Drive.

## 3. Tạo OAuth Client

1. Vào **Google Auth Platform** → **Clients**.
2. Chọn **Create client** → **Web application**.
3. Ở **Authorized redirect URIs**, thêm:
   `https://developers.google.com/oauthplayground`
4. Tạo client rồi sao chép **Client ID** và **Client secret**.

## 4. Lấy Refresh Token

1. Mở <https://developers.google.com/oauthplayground/>.
2. Nhấn biểu tượng bánh răng ở góc phải.
3. Bật **Use your own OAuth credentials**.
4. Dán Client ID và Client secret vừa tạo.
5. Ở bước 1, nhập scope
   `https://www.googleapis.com/auth/drive.file`, rồi nhấn
   **Authorize APIs**.
6. Đăng nhập đúng Gmail sẽ nhận file lưu trữ.
7. Ở bước 2, nhấn **Exchange authorization code for tokens**.
8. Sao chép **Refresh token**.

Nếu OAuth consent screen để **Testing**, refresh token của ứng dụng External có
thể hết hạn sau 7 ngày. Sau khi thử xong, chuyển ứng dụng sang **Production** để
chạy tự động lâu dài.

## 5. Thêm biến môi trường trên Vercel

Trong Vercel → project → **Settings** → **Environment Variables**, thêm cho
Production:

```text
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_REFRESH_TOKEN
CRON_SECRET
WEEKLY_ARCHIVE_DELETE_ENABLED=false
```

`CRON_SECRET` nên là chuỗi ngẫu nhiên ít nhất 16 ký tự. Sau đó redeploy.

## 6. Chạy thử trước khi cho phép xóa

Gọi endpoint production bằng header bí mật:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://YOUR_DOMAIN/api/archive/weekly
```

Drive sẽ tự xuất hiện thư mục **Employee Portal - Weekly Archives** và một file
JSON của tuần vừa kết thúc. Khi đã mở file và kiểm tra dữ liệu đúng, đổi:

```text
WEEKLY_ARCHIVE_DELETE_ENABLED=true
```

Sau đó redeploy và gọi endpoint thêm một lần. Hệ thống chỉ xóa các document có
đường dẫn đã ghi trong manifest `archiveRuns/{ngày-thứ-hai}`.

Cron trong `vercel.json` chạy `0 18 * * 0`, tức 18:00 Chủ nhật UTC. Tại Việt Nam
là khoảng 01:00 sáng Thứ Hai. Gói Vercel Hobby có thể chạy vào bất kỳ thời điểm
nào trong giờ đó.

## 7. Đổi sang tài khoản Google Drive khác

Không cần tạo lại Firebase và không cần đổi code.

1. Đăng xuất OAuth Playground hoặc mở cửa sổ ẩn danh.
2. Nếu OAuth app đang ở chế độ Testing, thêm Gmail mới vào **Test users**.
3. Làm lại mục **4. Lấy Refresh Token**, nhưng đăng nhập bằng Gmail Drive mới.
4. Trong Vercel, thay duy nhất `GOOGLE_DRIVE_REFRESH_TOKEN` bằng token mới.
   Giữ nguyên Client ID/Client secret nếu vẫn dùng cùng OAuth Client.
5. Redeploy Production rồi chạy endpoint `/api/archive/test` để kiểm tra.

Thư mục và file đã lưu trong tài khoản cũ không tự chuyển sang tài khoản mới.
Muốn xem chung lịch sử cũ, hãy tải/chuyển các file cũ sang tài khoản mới; các
bản lưu tạo sau khi đổi token sẽ nằm trong Drive mới.
