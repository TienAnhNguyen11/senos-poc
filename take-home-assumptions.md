# Take-home SenOS — Assumptions
Mỗi assumption: quyết định → lý do → phương án khác đã cân nhắc (nếu có) và cái giá của nó.

## Roles & tenancy

**Admin trong PoC = admin của 1 tenant**, đóng vai người mua/triển khai sản phẩm cho tổ chức đó, không phải IT department riêng.
- Lý do: khớp luồng onboarding tự nhiên nhất (Slack/Notion/Linear-style: người đăng ký đầu tiên tự động là owner), không cần bước duyệt/provisioning phức tạp.
- Phương án khác: admin = IT department tách biệt khỏi người mua — sát thực tế enterprise hơn (IT thường quản SSO/policy), nhưng đòi hỏi khái niệm "role trong org" phức tạp hơn nhị phân admin/user. Brief đã nói rõ "no need yet for complex...", nên chọn buyer-as-admin. Đánh đổi: chưa mô hình hoá được trường hợp "IT setup nhưng người khác trả tiền".

**System admin (SenOS-internal, quản lý toàn bộ tenant) tồn tại về khái niệm nhưng nằm ngoài phạm vi build.** Tenant + admin đầu tiên chỉ được tạo qua seed script (không có public signup form/UI nào) — không dựng UI quản trị riêng cho SenOS.
- Lý do: brief chỉ yêu cầu "authorisation (admin + user)" — 2 role. Build thêm console platform-admin là vượt "smallest thing that proves the concept".
- Ghi vào mục "what we chose not to build".

**Ngày đầu tiên, admin thấy màn hình gần như trống**: chỉ có chính họ trong danh sách user, action chính là "Invite user", usage/budget dashboard chưa có dữ liệu.
- Lý do: tenant vừa tạo, chưa ai được mời — tránh giả định sai kiểu "đã có sẵn team".

**User gia nhập tenant qua invite-only**: admin nhập email → hệ thống gửi link mời → người nhận click, tạo tài khoản/set password → tự động thuộc tenant với role mặc định "user".
- Lý do: đơn giản nhất để implement trong PoC; admin kiểm soát rõ ràng ai vào được tenant.
- Phương án khác: auto-join theo email domain (kiểu Slack/Notion) — mượt hơn cho enterprise thật, nhưng cần verify domain ownership (DNS/email xác thực) — thêm phức tạp không cần thiết cho PoC. Đánh đổi: user phải chờ admin chủ động mời.

## Usage tracking (user's own)

**User thường chỉ thấy usage và lịch sử chat của chính mình** — hiển thị dạng số lượng request/message (không phải token, không phải tiền). Không thấy usage/chat của user khác, không thấy rollup theo department. Admin thấy usage toàn tenant, lọc được theo user và theo department.
- Lý do: "basic usage tracking" ở mức đơn giản nhất là đếm hành động, không phải kế toán chi phí; ẩn tiền khỏi user tránh lộ thông tin nhạy cảm (giá SenOS trả cho model provider) mà brief không yêu cầu minh bạch tới từng nhân viên.
- **Không build**: số liệu quy đổi tiền ($) cho admin. Chỉ có budget/usage dạng số lượng request ở mọi cấp, kể cả với admin — không riêng gì user. Ghi vào "Things that go wrong".
- Phương án khác: hiện token count cho user (minh bạch hơn) — nhưng thêm phức tạp UI không cần thiết cho "basic", và token không trực quan bằng số tin nhắn với end-user không rành kỹ thuật.
- Department rollup chỉ admin xem được (không có role "trưởng phòng" trong hệ thống 2-role này).

## Budget & what happens when it runs out

**Budget tính bằng số lượng request/tháng, đặt ở 3 cấp:** tenant, department, user-pool.
- **Tenant:** admin chọn từ **droplist cố định** (5.000 / 10.000 / 20.000 request/tháng), không nhập tự do. Mức cao nhất kèm "cần nhiều hơn? liên hệ SenOS" (custom deal ngoài self-service).
- **Department:** admin **nhập tự do**, ý định là tổng các department ≤ budget tenant đã chọn — nội bộ tenant tự quản, không liên quan admission-control của SenOS. **Chưa enforce trong code** (`POST/PATCH /admin/departments` không check tổng so với `tenant.monthlyBudget`) — ghi vào "Things that go wrong" như 1 gap thật, không phải giả định đã hiện thực hoá.
- **User (trong department):** budget department là **1 pool chung** (first-come-first-served theo request), không chia đều cứng theo đầu người.
- Cảnh báo (banner in-app) khi tenant/department đạt 80% cap; chặn gửi chat khi đạt 100%. Thông báo chỉ hiển thị in-app, không gửi email.
- Lý do chọn droplist cố định cho tenant: validate input tầm thường (không cần chặn số âm/số khổng lồ), và làm admission-control check (mục Centralised key) dễ suy luận vì tổng khả dĩ chỉ là tổ hợp hữu hạn — dễ demo/defend.
- Lý do chọn pool thay vì chia đều cứng theo đầu người ở cấp user: ít code hơn (1 counter cộng dồn/department, không cần công thức chia lại mỗi khi headcount đổi — né bug "user đã dùng gần cap cũ bỗng vượt cap mới khi có người join giữa tháng"). Mất fairness tự động không đáng ngại vì admin đã thấy usage theo từng user trong department (xem mục Usage tracking) nên có thể can thiệp thủ công.
- Phương án khác đã cân nhắc: chia đều budget theo đầu người trong department (tự tính lại khi headcount đổi) — công bằng hơn nhưng thêm 1 edge case khó defend. Loại bỏ vì không cần thiết cho PoC.

## Centralised key / cost & trust

**"Centralised key" = 1 API key duy nhất (OpenAI/Anthropic...) dùng chung cho toàn bộ platform, không phải BYOK per-tenant.** Provider chỉ thấy 1 khách hàng là SenOS — SenOS tự đếm/gán usage cho từng tenant/department/user ở tầng application, provider không biết gì về khái niệm tenant.

**Platform capacity được enforce bằng admission-control tại thời điểm set budget, không phải circuit-breaker chặn runtime.** SenOS định nghĩa `PLATFORM_MONTHLY_CAPACITY` (tổng request/tháng SenOS sẵn sàng tài trợ). Khi admin của 1 tenant chọn/sửa mức budget (droplist), hệ thống kiểm tra: tổng budget của mọi tenant đang active (kể cả tenant vừa sửa) có vượt `PLATFORM_MONTHLY_CAPACITY` không — nếu vượt, **từ chối lưu** ngay lúc đó, không cho chọn mức đó.
- Lý do: version đầu (circuit-breaker chặn chat toàn platform khi tổng usage runtime chạm trần) có lỗi thiết kế nghiêm trọng — phạt tất cả tenant vô tội vì hành vi tenant khác. Admission-control tại thời điểm cấu hình budget đảm bảo tổng usage **không bao giờ vượt trần theo thiết kế** (by construction), không tenant nào bị block vì lỗi của tenant khác, và tenant không cần biết tới khái niệm "trần platform".
- Vì tenant budget đã là droplist cố định (không phải input tự do), tổng khả dĩ chỉ là tổ hợp hữu hạn của vài số — check này rất rẻ và dễ chứng minh đúng.
- Phương án khác đã cân nhắc và loại bỏ: circuit-breaker runtime chặn toàn bộ chat khi tổng usage vượt trần — đơn giản hơn về code nhưng bất công (block nhầm tenant vô tội), và là "chữa cháy" thay vì ngăn từ gốc.
- **Race condition riêng (không liên quan trần platform):** counter usage ở cấp department cần **atomic increment-and-check** (VD: Redis `INCR` hoặc `UPDATE ... WHERE count < cap` ở Postgres), không phải đọc-rồi-ghi 2 bước — tránh 2 request đồng thời cùng lọt qua khi counter gần chạm cap. Ghi vào "things that go wrong" như rủi ro kỹ thuật đã lường trước, không cần hạ tầng distributed-lock phức tạp để xử lý.

## Multi-tenancy — bản đơn giản

**Dùng 1 database chung, lọc theo `tenantId`** (pool model) cho toàn bộ tenant trong PoC.
- Lý do: quy mô demo (vài tenant), pool rẻ hơn nhiều để dựng trong 8 giờ — 1 schema, 1 migration set, không cần quản N connection pool như silo. Silo cho isolation mạnh hơn nhưng chi phí đó chỉ đáng trả khi có hàng trăm/nghìn tenant thật.

**Ép `tenantId` ở tầng data access ngay từ đầu**, không để scatter ở từng query — 1 middleware/base repository tự động inject filter `tenantId` vào mọi query, kết hợp AsyncLocalStorage để mang tenant context xuyên suốt request thay vì truyền tay qua từng hàm.
- Lý do: rẻ để làm ngay bây giờ, đắt và rủi ro nếu retrofit sau (leak dữ liệu thật giữa enterprise customer là failure mode nghiêm trọng hơn nhiều so với bug demo thường).
- Phương án khác đã cân nhắc: để mỗi dev tự nhớ filter `tenantId` trong từng query — nhanh hơn ban đầu nhưng là nguồn leak phổ biến nhất trong hệ multi-tenant thật; loại bỏ.

## AI provider

**Dùng Claude API (Anthropic) làm model đứng sau "centralised key".**
- Có sẵn web search tool built-in trong API (từ 09/2025, $10/1.000 search + token cost) — quyết định trực tiếp cách xử lý mảng "Third-party features" bên dưới.

## Third-party features (web search, browser execution)

**Thêm web search bằng tool built-in của Claude API**, không tự xây search-provider integration riêng (không dùng Tavily/Google Search API). Admin có thể **bật/tắt web search theo từng tenant** (1 boolean field).
- Lý do: effort chỉ ~20-30 phút (thêm 1 tool vào mảng `tools` của API request, Claude tự quyết định khi nào cần gọi) — rẻ hơn hẳn tự tích hợp search-provider (~1-2 giờ, cần thêm tool-calling loop tự viết). Toggle per-tenant minh hoạ đúng khái niệm "mỗi organisation có tools riêng" ở đoạn mở đầu brief, gần như miễn phí để thêm.
- Phương án khác đã cân nhắc: tự tích hợp Tavily/search API riêng — bị loại vì đắt hơn nhiều lần cho cùng giá trị chứng minh; browser execution — bị loại hoàn toàn (không built-in, effort cao, không chứng minh gì thêm cho core multi-tenant/budget/authz).
- **Simplification có chủ đích (ghi vào "things that go wrong"):** khi 1 request có kích hoạt web search, chi phí thật ($10/1.000 search + token) cao hơn request thường, nhưng usage-tracking (mục Usage tracking, Budget) chỉ đếm theo **số request**, không phân biệt có search hay không. Chấp nhận sai số này cho PoC, không tách riêng kế toán chi phí theo loại request.

## "POC" nghĩa là gì cho 1 buổi demo khách hàng thật

**"POC" ở đây = đủ tin cậy để chạy lặp lại nhiều lần trước 1 người lạ (khách hàng) trong 1 buổi demo ngắn có kịch bản, không phải "production-ready" chịu được sử dụng thật ngoài kịch bản đó.** Cụ thể: không cần retry logic phức tạp, không cần chịu tải cao, không cần validate chống mọi input lạ — chỉ cần đúng happy path + đúng 2 ngưỡng budget (80%/100%) trong "Demo flow" chạy ổn định, lặp lại được nhiều lần liên tiếp (nhiều buổi demo khác nhau), không cần restart/setup tay lại giữa các lần.

- Lý do: brief hỏi riêng câu này vì "POC" có thể hiểu từ "chạy 1 lần trên máy tác giả" tới "sẵn sàng deploy cho khách dùng thật" — khoảng cách rất xa, và sản phẩm này vừa phải rẻ (PoC 8 giờ) vừa phải sống sót khi người lạ tự tay thao tác (*"someone at SenOS can run... and put in front of a customer"*). Chọn mức "demo lặp lại được, không phải production" đúng tinh thần "smallest thing that proves the concept".
- **Bằng chứng — đây không phải quyết định mới, mà là điều đã ngầm định trong nhiều quyết định trước đó:**
  - Pico.css thay vì HTML trần (mục AI provider/tech-spec) → UI đủ sạch, không mất uy tín ngay cái nhìn đầu.
  - Demo beat 3 = budget chạm ngưỡng **sống động, live**, không phải kể miệng (xem mục Demo flow) → chứng minh bằng hành vi thật, không chỉ lời nói.
  - Seed data cố tình đặt budget department thấp (8 request/tháng, xem `take-home-tech-spec.md` mục 10) → demo chạm ngưỡng được trong vài phút, không cần đợi cả tháng.
  - `docker-compose up --build` — 1 lệnh, seed tự chạy nếu DB rỗng (mục Run instructions) → khởi động lại được nhiều lần cho nhiều buổi demo, không cần setup tay lại từ đầu.
- Phương án khác đã cân nhắc: coi POC gần production (retry logic, error recovery, chịu tải, validate input đầy đủ) — tốn nhiều giờ hơn hẳn ngân sách 8 giờ cho phần brief không đòi hỏi ("no need yet for... auto-scaling").

## Demo flow (3 màn hình/API chính)

**3 beat chính, nối 2 màn hình (admin, user chat) thành 1 câu chuyện có nhân-quả:**
1. **Admin, ngày đầu** — tenant gần như trống, mời user (thiết lập bối cảnh + isolation cơ bản: đây là tenant riêng của họ).
2. **User chat** — dùng bình thường, trigger web search 1 lần cho thấy tool hoạt động, usage cá nhân tăng dần real-time.
3. **Chạm ngưỡng budget (live)** — warning 80% → block 100% ngay trong chat (hoặc show trực tiếp 1 API call bị từ chối qua curl/Postman cho audience kỹ thuật), sau đó quay lại màn admin để thấy con số usage/budget đã cập nhật phản ánh đúng.
- Lý do: không thêm 1 màn hình tĩnh thứ 3 — dùng 1 khoảnh khắc động (budget threshold) để chứng minh hệ thống thực sự kiểm soát chi phí (grading criteria #3 "honest about money"), thay vì chỉ kể bằng lời. Nối 2 màn hình đã có thành câu chuyện nhân-quả thay vì 3 màn hình rời rạc.

## Things that go wrong / out of scope

- Platform-admin console cho SenOS quản lý tenant — xem mục Roles & tenancy.
- Headcount đổi giữa tháng không ảnh hưởng cap (đã chuyển sang pool, không còn áp dụng — xem mục Budget).
- Race condition trong counter usage cần atomic increment-and-check — xem mục Centralised key.
- Chi phí thật của request có web search cao hơn request thường, nhưng usage-tracking không phân biệt — xem mục Third-party features.
- Email notification khi chạm ngưỡng budget/platform capacity — không xây, chỉ có banner in-app.
