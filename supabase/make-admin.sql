-- Cấp quyền QUẢN TRỊ HỆ THỐNG (xem mọi trung tâm, tạo trung tâm mới, đặt gói cước).
-- Chỉ dành cho người vận hành app (bạn), KHÔNG cấp cho nhân viên của một trung tâm.
-- Bước 1: tài khoản phải ĐĂNG KÝ trong app trước.
-- Bước 2: sửa email ở dòng dưới thành email (hoặc tên đăng nhập@vercel.app) của bạn, rồi Run.
insert into app_admins (user_id)
select id from auth.users
where lower(email) in (
  'email-cua-ban@vidu.com'
)
on conflict do nothing;

-- Kiểm tra: hiện ra các tài khoản đang là quản trị hệ thống.
select u.email from app_admins a join auth.users u on u.id = a.user_id;
