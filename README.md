# UjianPro V6 — Holow Execution UI + Cloudflare Pages + D1 + R2

Versi ini menambahkan pengelolaan akun, blokir murid, layar blokir penuh di dalam halaman, riwayat murid, force-end ujian oleh Admin, dan penghapusan percobaan. Website tetap bukan aplikasi kiosk Android dan tidak dapat mengunci tombol Home/Power/Recent Apps.

## Struktur
```text
ujianpro-cloudflare/
├── index.html
├── app.js
├── styles.css
├── schema.sql
├── upgrade-v2.sql
├── wrangler.toml.example
├── README.md
└── functions/
    └── api/
        └── [[path]].js
```

## Akun demo
- Admin: `admin / admin123`
- Guru: `guru01 / 123456`
- Murid: `murid01 / 123456`

Ganti password demo sebelum dipakai untuk kegiatan sekolah.

## Fresh install
1. Upload semua file ke root repository GitHub.
2. Deploy sebagai Cloudflare Pages static project.
3. Buat D1 database dan bind sebagai `DB`.
4. Buat R2 bucket dan bind sebagai `MEDIA`.
5. Jalankan seluruh `schema.sql` sekali pada D1 Console.
6. Redeploy Pages.

## Update database dari versi sebelumnya
Jika database D1 sudah dibuat dengan `schema.sql` versi lama:
1. Buka D1 database yang sama.
2. Jalankan `upgrade-v2.sql` sekali.
3. Jangan jalankan `schema.sql` ulang pada database lama.
4. Redeploy Pages setelah file baru ter-push.

`upgrade-v2.sql` menambah:
- `users.status`
- `users.block_reason`
- `users.blocked_at`
- `users.blocked_by`
- `attempts.ended_by`
- `attempts.end_reason`

## Fitur Admin baru
- Blokir akun murid dengan alasan.
- Saat diblokir, `active=0` dan `status=blocked`.
- Attempt yang sedang berjalan otomatis dikunci dan diberi catatan `ADMIN_BLOCK`.
- Murid yang masih memiliki session akan melihat layar blokir penuh dan frontend mengecek kembali status akun setiap 5 detik.
- Setelah Admin mengaktifkan akun, layar blokir hilang dan dashboard dimuat ulang.
- Riwayat Murid menampilkan seluruh attempt, nilai, pelanggaran, dan evidence.
- Admin dapat mengakhiri attempt yang masih `in_progress`; jawaban yang sudah tersimpan dinilai di server.
- Admin dapat menghapus attempt. Penghapusan attempt juga menghapus record evidence dari R2 jika binding `MEDIA` tersedia.
- Penghapusan akun menggunakan soft-delete (`status=deleted`) agar riwayat tetap tersedia.

## Catatan anti-nyontek
Website dapat mencatat event browser seperti pindah tab, keluar fullscreen, offline, copy/cut/paste, dan berhentinya screen-share. Kamera/screen-share membutuhkan izin browser. Website tidak dapat menyadap seluruh perangkat Android atau mengunci sistem operasi.

## Cloudflare bindings
- D1 binding name: `DB`
- R2 binding name: `MEDIA`

## Verifikasi lokal
```bash
node --check app.js
node --check "functions/api/[[path]].js"
```


## Admin/akun v3
- Pemblokiran akun kini dipantau global setiap 3 detik, sehingga layar blokir juga muncul bila murid sedang berada di dashboard (bukan hanya saat ujian).
- Layar blokir menampilkan status DIBLOKIR, alasan, instruksi konfirmasi Admin, dan status menunggu aktivasi.
- Hapus akun sekarang benar-benar menghapus record pengguna, sesi, attempts, jawaban, pelanggaran, dan evidence milik murid; objek evidence di R2 ikut dicoba dihapus.
- Guru/Admin yang masih memiliki ujian yang dibuat oleh akun tersebut tidak dapat dihapus sebelum ujian dipindahkan atau dihapus.
- Tidak ada migrasi database baru untuk v3; gunakan database D1 yang sudah ada.


## v4 changes
- Dashboard staff: per-exam delete button (one exam at a time).
- Admin accounts: direct 'Akhiri ujian' button for each murid; opens currently running attempts.
- Exam deletion is blocked while exam is active or while a student attempt is still in progress.


## V6 UI
Public/student flow: intro splash → landing → login → student dashboard → exam screen with Holow Execution-inspired visuals. This update is visual only; the existing D1 schema is reused, so no database migration is required.


## V6 animated landing
- `hero-animated.mp4` is the supplied animated hero video used above the ENTER LOGIN button.
- `hero-poster.jpg` is the fallback poster shown before the video renders.
- No database migration is required for this UI-only update.
