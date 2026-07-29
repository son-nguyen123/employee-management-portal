# Thiết lập email biên nhận và cách tắt khẩn cấp

Email biên nhận được thiết kế tách khỏi các nghiệp vụ chính. Lịch làm, xin nghỉ,
đi trễ, ứng lương và các thao tác duyệt vẫn hoàn tất nếu Gmail tạm thời lỗi.

## Trạng thái mặc định

Giữ cấu hình sau trong lần deploy đầu tiên:

```env
AUDIT_TRAIL_ENABLED=true
AUDIT_EMAIL_ENABLED=false
```

Ở trạng thái này hệ thống ghi chuỗi audit SHA-256 nhưng không tạo hoặc gửi email.

## Cấp quyền Gmail một lần

1. Mở Google Cloud Console của OAuth client đang dùng cho dự án.
2. Bật **Gmail API**.
3. Trong OAuth consent screen, thêm Gmail gửi thư vào **Test users** nếu ứng dụng
   vẫn ở trạng thái Testing.
4. Mở OAuth 2.0 Playground và bật **Use your own OAuth credentials**.
5. Nhập OAuth Client ID và Client Secret.
6. Chọn scope:

   ```text
   https://www.googleapis.com/auth/gmail.send
   ```

7. Đăng nhập đúng Gmail gửi thư, cấp quyền, đổi authorization code lấy refresh
   token.
8. Thêm các biến sau vào Vercel Production:

   ```env
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   GMAIL_REFRESH_TOKEN=...
   GMAIL_FROM_EMAIL=...
   GMAIL_FROM_NAME=Trí Candy
   AUDIT_EMAIL_ENABLED=true
   ```

9. Redeploy rồi vào **Trung tâm quản lý → Email biên nhận nhân viên → Bật gửi**.

Cả biến môi trường và công tắc admin đều phải bật thì email mới được tạo.

## Tắt khi có lỗi

Cách nhanh nhất là bấm **Tắt gửi** trong Trung tâm quản lý. Thao tác này:

- ngừng tạo email mới;
- hủy toàn bộ email còn đang chờ;
- không ảnh hưởng đăng ký lịch hoặc các yêu cầu khác;
- không xóa nhật ký audit đã ghi.

Nếu trang admin không truy cập được, đặt:

```env
AUDIT_EMAIL_ENABLED=false
```

rồi redeploy. Đây là kill switch cấp hệ thống; kể cả công tắc trong Firestore
đang bật, backend vẫn không gửi email.

Chỉ đặt `AUDIT_TRAIL_ENABLED=false` trong tình huống khẩn cấp khi chính module
audit gây lỗi. Việc này không xóa lịch sử cũ nhưng các thao tác mới sẽ không có
bản ghi audit cho đến khi bật lại.
