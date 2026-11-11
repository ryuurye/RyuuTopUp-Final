# Panduan pemasangan RyuuTopUp (Netlify + Cloudflare + Supabase)

Ikuti urutan ini. Tidak perlu membuat ulang tabel lama sebelum memeriksa nama tabel yang sudah ada.

## 1. Supabase — database

1. Buka Supabase project yang sudah kamu punya.
2. Buka **SQL Editor → New query**.
3. Buka file `supabase/001_schema.sql` dari paket ini, salin seluruh isinya, lalu jalankan.
4. Jalankan query pemeriksaan:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
```

5. Buka **Project Settings → API**. Simpan:
   - Project URL
   - anon / publishable key
   - service_role / secret key (khusus Cloudflare Worker; jangan masukkan ke Netlify)
6. Buka **Authentication → Providers → Email**. Untuk pengujian awal, kamu boleh menonaktifkan email confirmation agar akun uji bisa langsung masuk. Sebelum produksi, aktifkan kembali dan siapkan SMTP yang benar.

> SQL membuat tabel khusus dengan awalan `rt_` (misalnya `rt_orders`, `rt_products`) agar 13 tabel lama tidak ditimpa. Jangan hapus tabel lama; aplikasi final hanya menggunakan tabel `rt_` ini.

## 2. Cloudflare — backend Worker

Worker yang pernah kamu buat bernama `ryuutopup-api`. Paket ini menyediakan kode penggantinya di folder `worker/`.

### Deploy dari komputer

1. Install Node.js LTS (Node 20 atau lebih baru) dari https://nodejs.org/.
2. Ekstrak ZIP proyek.
3. Buka PowerShell di folder `RyuuTopUp-Final\worker`.
4. Jalankan:

```powershell
npm install
npx wrangler login
npx wrangler deploy
```

5. Jika Wrangler meminta konfirmasi deployment, pilih Worker `ryuutopup-api` yang sama. `worker/wrangler.toml` sudah menyiapkan nama dan entrypoint.

### Isi Worker Secrets

Cloudflare Dashboard → Workers & Pages → `ryuutopup-api` → Settings → Variables and Secrets. Tambahkan sebagai **Secret**, bukan plain text variable:

| Name | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role/secret key |
| `MELO_API_KEY` | Melo H2H API Key |
| `MELO_SECRET_KEY` | Melo H2H Secret Key |
| `MELO_WEBHOOK_SECRET` | Melo H2H Webhook Secret |
| `MIDTRANS_SERVER_KEY` | Midtrans Sandbox Server Key |

Tambahkan sebagai **Variable**:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `MIDTRANS_IS_PRODUCTION` | `false` |
| `MELO_SANDBOX_MODE` | `true` |
| `APP_URL` | URL Netlify kamu: `https://ryuutopup.netlify.app` |
| `DEFAULT_MARGIN_PERCENT` | `10` |
| `STORE_NAME` | `RyuuTopUp` |

`MELO_API_KEY`, `MELO_SECRET_KEY`, dan `MELO_WEBHOOK_SECRET` adalah tiga nilai yang dibuat dari menu API Credentials di dashboard Melo. Jangan menekan Rotate Keys setelah pemasangan kecuali siap memperbarui ketiganya.

6. Deploy ulang Worker setelah menambah/mengubah secret.
7. Buka `https://ryuutopup-api.timothy-d-hartono.workers.dev/health`. Status harus menunjukkan Worker hidup dan konfigurasi terisi. Endpoint ini tidak menampilkan isi secret.

## 3. Melo H2H — callback

1. Buka dashboard Melo H2H → pengaturan API / Webhook.
2. Atur Webhook URL menjadi:

`https://ryuutopup-api.timothy-d-hartono.workers.dev/api/webhooks/melo`

3. Simpan. Pastikan secret yang ada di Cloudflare adalah Webhook Secret dari key pair yang sama.
4. Jangan ubah akun live/sandbox di dashboard tanpa mengubah `MELO_SANDBOX_MODE` sesuai keputusan operasional. Paket ini default `true` supaya uji tidak mendebit saldo provider.
5. Katalog menyimpan inquiry form Melo. Checkout menampilkan field tambahan dari form SKU, memvalidasi required/options di Worker, lalu mengirim `additional_data` sesuai key form Melo.
6. Jika IP whitelist aktif pada Melo, pastikan jalur egress backend diizinkan. Cloudflare Workers standar tidak menjanjikan satu IP egress statis; jangan mengaktifkan whitelist dengan asumsi alamat IP Worker tetap. Minta konfirmasi Melo atau gunakan opsi egress statis yang didukung Cloudflare sebelum transaksi live.

## 4. Midtrans — sandbox

1. Masuk/daftar di https://dashboard.midtrans.com/.
2. Buka Sandbox → Settings → Access Keys.
3. Ambil **Sandbox Client Key** dan **Sandbox Server Key**.
4. Masukkan Sandbox Server Key ke Cloudflare secret `MIDTRANS_SERVER_KEY`.
5. Di Cloudflare variable, pastikan `MIDTRANS_IS_PRODUCTION=false`.
6. Buka Midtrans Dashboard Sandbox → Settings → Configuration → Payment Notification URL.
7. Isi:

`https://ryuutopup-api.timothy-d-hartono.workers.dev/api/webhooks/midtrans`

8. Simpan. Client Key akan digunakan di Netlify pada langkah berikutnya.

Catatan: refund melalui API tidak didukung oleh semua metode pembayaran. Untuk metode yang tidak mendukung refund API, admin harus memproses refund melalui dashboard Midtrans atau transfer manual. Lihat status refund pada admin panel.

## 5. Netlify — frontend

1. Push folder proyek ke GitHub (jangan ikutkan `.env` atau secret apa pun).
2. Netlify → Add new site → Import an existing project → pilih repository.
3. Base directory: `frontend`
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Tambahkan environment variables berikut di Site configuration → Environment variables:

| Name | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://ryuutopup-api.timothy-d-hartono.workers.dev` |
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `VITE_MIDTRANS_CLIENT_KEY` | Midtrans Sandbox Client Key |
| `VITE_MIDTRANS_IS_PRODUCTION` | `false` |

7. Deploy site. Pastikan `APP_URL` pada Cloudflare sama dengan URL Netlify.
8. Pada Netlify site settings → Domain management, catat URL sebenarnya dan perbarui `APP_URL` di Cloudflare bila berbeda.
9. Setiap perubahan environment variable Netlify memerlukan deploy ulang agar nilai `VITE_*` masuk ke bundle frontend.

## 6. Jadikan akunmu admin

1. Buka URL Netlify.
2. Daftar akun menggunakan email milikmu sendiri.
3. Jika perlu, konfirmasi email sesuai pengaturan Auth.
4. Supabase → SQL Editor → jalankan (ganti email):

```sql
update public.rt_profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('EMAIL_LOGIN_KAMU');
```

5. Keluar lalu masuk kembali. Menu **Admin** akan muncul.
6. Buka Admin → **Sinkronkan katalog Melo**. Produk aktif dari katalog Melo akan diimpor ke Supabase dengan harga provider.

## 7. Urutan aktivasi pertama

1. Pastikan `/health` Worker menunjukkan konfigurasi lengkap.
2. Login ke website, sinkronkan katalog dari Admin.
3. Pilih produk, isi target, lalu lanjutkan checkout.
4. Midtrans Sandbox akan menampilkan metode pembayaran simulasi. Gunakan instruksi/card/VA test yang disediakan dashboard Midtrans Sandbox.
5. Setelah pembayaran mendapat status sukses, webhook Midtrans akan memicu satu permintaan ke Melo dengan `sandbox_mode=true`.
6. Status akhir akan masuk melalui callback Melo atau bisa direkonsiliasi di Admin.

Ini merupakan pengujian integrasi end-to-end, bukan transaksi uang sungguhan. Sebelum membuka transaksi live, ubah seluruh pengaturan sandbox ke live dan lakukan pemeriksaan saldo, whitelist IP Melo (bila aktif), webhook, kebijakan refund, dan status aktivasi merchant Midtrans.

## 8. Jika ada error

- `Worker not configured`: ada variable/secret wajib yang belum diisi.
- `Melo 401`: API Key / Secret Key tidak cocok.
- `Melo 403`: akun atau IP whitelist Melo belum mengizinkan server integrasi.
- `Melo 429`: rate limit; tunggu `Retry-After` dan jangan spam tombol sync.
- `Supabase 401`: URL/key Supabase salah atau service role key belum ditambahkan.
- `Midtrans 401`: Sandbox Server Key salah atau mode sandbox/production tertukar.
- Webhook tidak masuk: pastikan URL callback, Worker aktif, dan secret webhook berasal dari pasangan key terbaru.

Jangan membagikan screenshot yang memperlihatkan key secara utuh. Tutupi secret sebelum mengirim tangkapan layar untuk troubleshooting.
