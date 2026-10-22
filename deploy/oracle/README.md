# VANTA — Migrasi Railway ke Oracle Cloud Always Free

## Status
Ini adalah **paket deployment**, BUKAN bukti VANTA telah dipasang pada VM Oracle. VM Oracle dan data terenkripsi Railway belum terhubung ke sesi ChatGPT; konektivitas, volume, dan inferensi RunningHub masih harus diperiksa langsung.

## Tujuan
Pindahkan **server aplikasi yang sama** dari Railway: Motion Control (semua workflow lama), MiniMax H3 Character Swap v1.1 experimental, Image Generation via kie.ai, Account Pool, dashboard, History, upload foto/video, preview, paginasi, reference storage, task queue dan status. Jangan tulis ulang atau reset fungsi yang sudah ada.

Video AI tetap dijalankan oleh RunningHub; Oracle hanya host untuk Docker/Node.js, FFmpeg/OpenCV, API proxy, dan penyimpanan. File Character Swap v1.1 tidak otomatis membuat node MiniMax H3/BFS tersedia pada RunningHub.

## Infrastruktur Oracle
- OCI Always Free, **VM.Standard.A1.Flex** (ARM64) Ubuntu 24.04 atau Ubuntu 22.04 LTS, target 2 OCPU / 12 GB RAM jika tersedia dalam kuota gratis di home region. Periksa lagi konsol dan kuota saat provision.
- Boot volume dengan ruang aman untuk Docker images, sementara upload, dan data; tetap berada dalam kuota gratis. Gunakan filesystem persisten, bukan temp storage.
- Public IPv4, VCN, internet gateway, security rules TCP 80/443 untuk web, TCP 22 hanya IP admin. Jangan ekspos port 8080 publik.
- DNS A record nama domain VANTA ke alamat IPv4 VM. Caddy memerlukan nama domain agar sertifikat TLS otomatis dapat diterbitkan.
- Install Docker Engine dan Docker Compose plugin untuk Linux ARM64 dari paket resmi.

## Konfigurasi file
1. `compose.oracle.yaml`: Node app (Dockerfile asli, tanpa mengubah fungsinya), Caddy HTTPS, persistent bind mount host `./data:/data`.
2. `deploy/oracle/Caddyfile`: reverse proxy internal ke container VANTA.
3. `deploy/oracle/example.env`: salin ke `.env`, isi nilai sebenarnya **di VM**, jangan simpan secret di Git.
4. `deploy/oracle/deploy.sh`: cek adanya data, build, jalankan semua test `npm run check`, up, check health.

## Tahap migrasi yang tidak boleh dilewati
### A. Arsip volume Railway
Railway menggunakan volume bernama `vanta-account-vault` yang dimount pada `/data`. Ekspor salinan **seluruh** isinya secara privat, termasuk file `accounts.enc`, direktori `account-vaults`, references, registri tugas, dan berkas antrean; jangan hanya menyalin file workflow GitHub. Hindari membuat endpoint HTTP publik untuk mengunduh vault.

Jangan menghapus akun Railway, volume, atau mengubah nilai `APP_MASTER_KEY` sebelum validasi Oracle selesai.

### B. Konfigurasi kunci terenkripsi
Salin `APP_MASTER_KEY` **nilai persis sama** dari Railway production secara aman ke `.env` di VM Oracle. Jika berbeda, ciphertext AES-256-GCM yang ada tidak dapat dibaca. Rotasi kunci terpisah harus memakai mekanisme migrasi enkripsi; jangan asal ganti nilai. Salin `RUNNINGHUB_WORKFLOW_ID` serta konfigurasi lainnya yang diperlukan. API key pengguna yang disimpan dalam `/data` tetap dienkripsi.

Jangan memberikan nilai rahasia, SSH private key, API key, atau file vault kepada ChatGPT melalui teks chat.

### C. Upload data ke VM
Transfer arsip terenkripsi melalui sambungan terautentikasi, pulihkan ke `<repo>/data` dengan struktur direktori utuh, verifikasi checksum dan permission. Buat backup offline sebelum menjalankan aplikasi.

### D. Jalankan
```bash
cp deploy/oracle/example.env .env
chmod 600 .env
# Isi .env menggunakan editor DI VM (jangan commit).
# Pastikan folder ./data telah dimigrasi dan memiliki file accounts.enc.
bash deploy/oracle/deploy.sh
```

Script berhenti apabila `data/accounts.enc` tidak ada. Override `VANTA_ALLOW_EMPTY_DATA=1` hanya untuk instalasi baru yang *secara sengaja* tidak membutuhkan pemulihan akun lama; jangan gunakan untuk migrasi produksi.

### E. Uji non-GPU sebelum cutover
- `GET /health` via HTTPS valid.
- UI Create, Image Studio, History dan Account Pool tampil.
- Kunci Account Pool lama bisa dibaca, saldo dapat diperiksa tanpa membatalkan task berjalan.
- Riwayat lama termasuk input preview tersedia.
- Upload foto/video berhasil, error fail closed (tidak membuat task berbayar tanpa input lengkap).
- RunningHub queue handling menghormati saldo 100–600 RH; akun yang lebih besar tidak terpilih.
- Integrasi kie.ai dan model-modelnya tetap bisa diakses.
- Workflow lama tetap tersedia.
- Character Swap v1.1 dapat dipilih tanpa input prompt manual; **keberhasilan generasi memerlukan MiniMax H3, BFSNodes, dan LoRA di RunningHub yang belum terverifikasi**, jadi hanya pengguna yang melakukan tes generate setelah siap.
- Setelah semua lolos, pindahkan trafik/domain dari Railway ke Oracle. Domain `*.up.railway.app` milik Railway **tidak bisa dipindahkan ke Oracle**; pakai domain baru atau domain pribadi.

## Catatan keamanan
- HTTPS diakhiri di Caddy; Node hanya di jaringan Docker.
- `.env`, `data/`, arsip, private key **dikecualikan dari Git**.
- SSH dibatasi ke administrator, gunakan key dan keamanan OS.
- Siapkan backup rutin terenkripsi dari `./data` (volume satu VM tidak menggantikan backup).
- Perhatikan pengumuman keamanan Railway terkait rotasi kredensial; lakukan migrasi/rotasi terencana tanpa memutus dekripsi Account Pool.
- Oracle home-region Always Free dapat kehabisan kapasitas, dan konsumsi melebihi kuota berpotensi menjadi berbayar pada akun PAYG. Cek metering dan alert.

## Kriteria sukses
Migrasi selesai **hanya setelah** server Oracle aktif pada HTTPS, `npm run check` lulus pada arsitektur ARM64, account vault berhasil dibaca, history utuh, dan semua fungsi UI/backend lolos pemeriksaan. Penyelesaian pipeline generasi MiniMax H3 di RunningHub merupakan dependensi provider terpisah.
