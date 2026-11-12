-- Cấp quyền QUẢN TRỊ (xem tất cả tuyến đội / trận đấu) cho 2 tài khoản.
-- Bước 1: các tài khoản này phải ĐĂNG KÝ trong app trước (tên đăng nhập: admin và admin2).
-- Bước 2: chạy file này trong Supabase → SQL Editor → Run.
-- Đổi tên tài khoản ở dòng dưới nếu bạn dùng tên khác. Chạy lại nhiều lần không sao.
insert into app_admins (user_id)
select id from auth.users
where lower(email) in (
  'admin@vercel.app',
  'admin2@vercel.app'
)
on conflict do nothing;

-- Kiểm tra: hiện ra các tài khoản đã là quản trị.
select u.email from app_admins a join auth.users u on u.id = a.user_id;
