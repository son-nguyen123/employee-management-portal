# Trí Candy Employee Management Portal

Ứng dụng quản lý nhân viên nội bộ, tối ưu cho điện thoại và có thể cài đặt như PWA. Hệ thống hỗ trợ nhân viên đăng ký lịch làm, gửi yêu cầu và theo dõi kết quả; đồng thời cung cấp cho quản lý các màn hình duyệt lịch, điều hành, lịch sử xử lý và lưu trữ dữ liệu.

## Chức năng chính

### Nhân viên

- Đăng ký và điều chỉnh lịch làm cho tuần kế tiếp.
- Xin nghỉ, báo đi trễ, xin ứng lương và xin làm thêm.
- Gửi ghi chú cho quản lý.
- Theo dõi thông báo, khoản phạt và công việc trong xưởng.
- Nhận biên nhận email cho các thao tác quan trọng.

### Quản lý

- Duyệt bảng đăng ký lịch và các yêu cầu của nhân viên.
- Xem nhân sự tuần tới theo từng ngày và ca.
- Theo dõi, sửa quyết định trong lịch sử xử lý.
- Quản lý hồ sơ nhân viên và các khoản phạt.
- Bật hoặc tắt biên nhận email từ giao diện admin.
- Lưu bản chụp dữ liệu hằng tuần lên Google Drive.

### Minh bạch dữ liệu

- Mỗi thao tác quan trọng được ghi vào nhật ký kiểm toán.
- Các sự kiện được liên kết bằng mã SHA-256 để phát hiện chỉnh sửa.
- Email biên nhận chứa thời gian máy chủ, mã sự kiện và mã kiểm tra.
- Lỗi tích hợp email không làm mất yêu cầu đã gửi thành công.

## Công nghệ

- Next.js 16, React 19 và TypeScript.
- Tailwind CSS 4.
- Firebase Authentication, Cloud Firestore và Firebase Cloud Messaging.
- Firebase Admin SDK cho các nghiệp vụ phía máy chủ.
- Gmail API cho email biên nhận.
- Google Drive API cho kho lưu trữ hằng tuần.
- Vercel cho build, cron và production hosting.

## Yêu cầu

- Node.js 22.x.
- pnpm 10.28.1 hoặc phiên bản tương thích.
- Một Firebase project đã bật Authentication và Firestore.
- Tài khoản Google/OAuth nếu sử dụng Gmail và Google Drive.

## Chạy trên máy local

```bash
pnpm install
copy .env.local.example .env.local
pnpm dev
```

Mở `http://localhost:3000`.

Các lệnh thường dùng:

```bash
pnpm dev
pnpm lint
pnpm build
pnpm start
pnpm seed:firestore
```

## Biến môi trường

Sao chép `.env.local.example` thành `.env.local`, sau đó điền các nhóm biến cần thiết:

- `NEXT_PUBLIC_FIREBASE_*`: cấu hình Firebase phía trình duyệt.
- `FIREBASE_ADMIN_*`: thông tin Firebase Admin phía máy chủ.
- `GOOGLE_DRIVE_*`: OAuth dùng cho lưu trữ Google Drive.
- `GMAIL_*`: OAuth và địa chỉ gửi biên nhận Gmail.
- `AUDIT_TRAIL_ENABLED`: công tắc nhật ký kiểm toán.
- `AUDIT_EMAIL_ENABLED`: công tắc khẩn cấp cho email.
- `CRON_SECRET`: bảo vệ endpoint cron lưu trữ.
- `OPERATIONS_ALERT_EMAIL`: địa chỉ nhận cảnh báo vận hành; nếu để trống sẽ dùng `GMAIL_FROM_EMAIL`.
- `FIRESTORE_*_ALERT_LIMIT`: các ngưỡng cảnh báo lượt đọc, ghi, xóa và dung lượng Firestore trong 24 giờ.

Không commit `.env.local`, private key, refresh token hoặc client secret vào Git.

## Thiết lập dịch vụ

- [Thiết lập Firebase](./FIREBASE_SETUP.md)
- [Thiết lập Firebase trên Vercel](./VERCEL_FIREBASE_SETUP.md)
- [Thiết lập lưu trữ Google Drive](./GOOGLE_DRIVE_ARCHIVE_SETUP.md)
- [Thiết lập email và nhật ký kiểm toán](./AUDIT_EMAIL_SETUP.md)
- [Hướng dẫn dành cho lập trình viên](./DEVELOPER_GUIDE.md)

## Triển khai

Production hiện được triển khai bằng Vercel. Trước khi deploy:

```bash
pnpm build
```

Sau đó có thể triển khai bằng Vercel CLI:

```bash
npx vercel --prod
```

Cron trong `vercel.json` gọi các endpoint tạo lịch cố định, lưu trữ và kiểm tra tình trạng hệ thống. Kiểm tra hệ thống chạy mỗi ngày lúc 07:30 theo giờ Việt Nam. Các biến môi trường production phải được cấu hình trên Vercel trước khi chạy.

Trang **Cài đặt → Tình trạng hệ thống** cho quản lý biết Firestore có sắp chạm giới hạn hay không, Google Drive có đầy hoặc mất kết nối hay không, và các tác vụ tự động/lưu trữ có bị lỗi hay không. Cảnh báo được chống gửi lặp trong 12 giờ, gửi trong ứng dụng và gửi email dự phòng.

Để đọc số liệu Firestore, service account production cần quyền **Monitoring Viewer** và project phải bật **Cloud Monitoring API**. Nếu thiếu, hệ thống sẽ hiện cảnh báo cấu hình thay vì báo trạng thái an toàn sai.

## Bảo mật

- Repository phải được giữ ở chế độ Private.
- Không đưa khóa Firebase Admin hoặc OAuth token vào source code.
- Firestore Rules cần được kiểm tra và deploy cùng thay đổi liên quan dữ liệu.
- Có thể tắt email từ admin; `AUDIT_EMAIL_ENABLED=false` là lớp ngắt khẩn cấp ở môi trường triển khai.
- Việc đổi quyền OAuth hoặc thay tài khoản gửi thư cần tạo refresh token mới.

## Trạng thái

Ứng dụng đang được sử dụng nội bộ và triển khai tại:

<https://employee-management-portal-seven-pi.vercel.app>
