# Thiết lập Firebase Admin SDK trên Vercel

Ứng dụng dùng Firebase Authentication, Firestore và FCM trên gói Spark. Cloud
Functions không được dùng. Các nghiệp vụ ghi dữ liệu chạy trong Next.js Route
Handler tại `/api/workflows` trên Vercel.

## 1. Tạo service account

1. Mở Firebase Console → **Project settings** → **Service accounts**.
2. Chọn **Generate new private key** và tải file JSON về máy.
3. Không chép file JSON vào thư mục dự án, không commit lên GitHub.
4. Mở file JSON chỉ để lấy ba giá trị `project_id`, `client_email` và
   `private_key`.

## 2. Thêm biến môi trường vào Vercel

Vào Vercel → dự án → **Settings** → **Environment Variables** và thêm cho
Production, Preview và Development:

```text
FIREBASE_ADMIN_PROJECT_ID=employee-management-port-339fe
FIREBASE_ADMIN_CLIENT_EMAIL=<giá trị client_email>
FIREBASE_ADMIN_PRIVATE_KEY=<toàn bộ giá trị private_key, gồm BEGIN/END PRIVATE KEY>
```

Không đặt tiền tố `NEXT_PUBLIC_` cho ba biến trên. Vercel cho phép dán private
key nhiều dòng trực tiếp. Code cũng hỗ trợ dạng một dòng có ký tự `\n`.

Các biến chính sách có thể chỉnh theo nội quy:

```text
SCHEDULE_DEADLINE_HOUR=18
PENALTY_LATE_SCHEDULE_AMOUNT=50000
LEAVE_NOTICE_HOURS=24
PENALTY_LATE_LEAVE_AMOUNT=50000
PENALTY_LATE_NOTICE_AMOUNT=1000
```

Mặc định: lịch tuần sau phải gửi trước Chủ nhật lúc 18:00; nghỉ phải báo trước
24 giờ; báo đi trễ dưới 60 phút trước ca sẽ bị phạt.

## 3. Redeploy

Sau khi lưu biến môi trường, vào **Deployments** → deployment mới nhất →
**Redeploy**. Biến môi trường mới không áp dụng ngược cho deployment cũ.

## 4. Kiểm tra

1. Đăng nhập bằng tài khoản có document `employees/{uid}` và `status: active`.
2. Staff gửi lịch/nghỉ/đi trễ/ứng lương.
3. Admin hoặc manager duyệt trong trang quản lý.
4. Kiểm tra Firestore có document trạng thái, penalty (nếu vi phạm),
   notification và pushDispatches tương ứng.
5. Trên thiết bị nhân viên, bật thông báo trong trang hồ sơ để backend có FID
   dùng gửi FCM.
