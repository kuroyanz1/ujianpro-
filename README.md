# UjianPro — Cloudflare Pages + D1 + R2

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
