# UjianPro — Cloudflare Pages + D1 + R2

Platform ujian demo dengan 3 role (Murid, Guru, Admin), backend Pages Functions, D1 database, audit log, aturan anti-cheating browser, serta evidence kamera/screen-share berbasis izin browser.

## Demo login
- Admin: `admin` / `admin123`
- Guru: `guru01` / `123456`
- Murid: `murid01` / `123456`

**Ganti semua password demo sebelum dipakai sungguhan.** 

## Struktur

```text
ujianpro/
├── index.html
├── styles.css
├── app.js
├── schema.sql
├── wrangler.toml.example
└── functions/
    └── api/
        └── [[path]].js
```

## Deploy paling mudah dari HP

1. Buat repository GitHub baru, misalnya `ujianpro`.
2. Upload seluruh isi folder ini, termasuk folder `functions/api/`.
3. Di Cloudflare buka **Workers & Pages → Create application → Pages → Connect to Git** dan pilih repository GitHub.
4. Production branch: `main`.
5. Build command: kosongkan.
6. Build output directory: `.`
7. Deploy project.
8. Setelah project ada, buka **Settings → Bindings**.
9. Buat D1 database bernama `ujianpro-db`.
10. Tambahkan binding D1 dengan variable name **`DB`**.
11. Buat R2 bucket bernama misalnya `ujianpro-evidence`.
12. Tambahkan binding R2 dengan variable name **`MEDIA`**.
13. Redeploy project.
14. Buka D1 → **Console** lalu jalankan seluruh isi `schema.sql` sekali.
15. Buka URL `https://NAMA-PROJECT.pages.dev` dan login memakai akun demo.

Cloudflare Pages Functions dapat memakai binding D1 dan R2, dan folder `/functions` pada root project dipakai untuk server-side routes. GitHub integration akan melakukan deploy ulang setiap kali ada push ke branch yang terhubung.

## Opsional: wrangler.toml

`wrangler.toml.example` hanya contoh konfigurasi. Untuk deployment lewat GitHub Dashboard, binding dapat dibuat dari dashboard sehingga file ini tidak wajib. Bila memakai Wrangler lokal, rename menjadi `wrangler.toml` dan isi `database_id` dengan ID D1 milikmu.

## Yang dilakukan sistem saat ujian

- Timer server-side divalidasi saat submit.
- Satu murid hanya punya satu attempt per ujian.
- Jawaban dan nilai dihitung di server.
- Visibility change / pindah tab dicatat.
- Keluar fullscreen dicatat.
- Offline dicatat.
- Menghentikan screen-share dicatat.
- Context menu / copy / cut / paste diblokir browser dan dicatat.
- Ujian dapat dikonfigurasi untuk dikunci pada pelanggaran pertama.
- Jika kamera/screen-share diwajibkan, browser meminta izin pengguna.
- Guru dapat menambah, mengedit, dan menghapus soal beserta kunci jawaban.
- Evidence singkat (maks. 4 detik per jenis saat pelanggaran dan maksimal 25 MB per file) dapat disimpan ke R2.

## Batasan penting

Website tidak dapat mengunci seluruh Android. Website juga tidak dapat mengetahui secara langsung bahwa HP benar-benar dimatikan; server hanya dapat melihat heartbeat/koneksi berhenti. Tombol Home, Settings, power, aplikasi lain, dan lock-down tingkat perangkat memerlukan aplikasi Android yang dikelola dalam mode kiosk/device-owner.

### Privasi

Kamera dan screen capture hanya berjalan setelah browser memberikan izin. Jangan merekam siswa tanpa kebijakan sekolah, pemberitahuan, dan dasar/izin yang sesuai. Simpan evidence seperlunya dan batasi akses Guru/Admin.

## Uji lokal (opsional)

Jika sudah ada Node.js dan Wrangler, gunakan Pages dev. Untuk Pages + D1 lokal, gunakan konfigurasi Wrangler dengan `preview_database_id`. Cloudflare mendokumentasikan `wrangler pages dev` untuk menjalankan asset + Functions secara lokal.
