> Updated 11 November 2026: every existing workflow routes through the access-token transport. Akatz v3 is restored as a separate selection from commit ce7ec85, with its original builder preserved byte for byte. H3/FFP, character, Akatz and Turbo models reuse the studio's existing upload receipts, matched to pinned SHA-256 hashes; their content-addressed file names remain unchanged. API keys and repeated multi-gigabyte model transfers are unnecessary for these existing files. A missing model receipt remains a real preflight error, not a successful generate. Live GPU execution still requires an owner's valid token and provider availability.

> Updated 10 November 2026: production authentication is access-token only. API-key import and OpenAPI fallback have been removed. Startup migration purges old RunningHub API keys from global/device vaults, task credentials, retired-account escrow and stale temporary files. KIE and archived videos are not changed. The pool accepts a raw access token or existing exporter JSON, and reconnecting preserves verified upload/refresh metadata. The technical protocol notes below describe the original integration; the previous API-key option and deployment-review state are historical.

# Sesi RunningHub di Vanta

Vanta sebelumnya hanya menerima API key. Menempelkan token browser ke jalur
OpenAPI tidak mengubah aturan saldo Consumer API. Integrasi ini menambahkan
transport terpisah yang menggunakan protokol editor RunningHub melalui HTTP.

## Penggunaan setelah deployment disetujui

1. Buka **RunningHub Pool → Sesi RunningHub → Salin kode RunningHub**.
2. Jalankan kode tersebut saat berada di akun RunningHub yang sudah login.
   Membuka editor terlebih dahulu juga menyediakan izin unggah media.
3. Salin JSON pada popup, tempel di formulir Vanta, lalu pilih **Hubungkan sesi**.
   JSON dari bookmarklet lama pengguna juga diterima.
4. Setelah identitas dan saldo terverifikasi, gunakan Generate seperti biasa.
   Hubungkan ulang akun yang sama jika refresh token sudah tidak berlaku.

Kode baru hanya mengambil access token, refresh token, Rh-Identify, dan
Rh-Comfy-Auth. Kode tidak mengirim data lewat jaringan dan tidak menyalin seluruh
cookie atau penyimpanan browser. JSON sesi ditempel langsung ke Vanta;
kredensial tidak perlu dikirim melalui chat.

## Implementasi

- Endpoint impor dilindungi autentikasi Owner Vanta dan pemeriksaan Origin.
- Token berada dalam penyimpanan AES-256-GCM yang memakai APP_MASTER_KEY.
  Account Pool dan registry task hanya memegang referensi `rhweb:<hash>`.
  Referensi tetap sama setelah akun yang sama dihubungkan ulang.
- Refresh token berjalan pada server, dengan satu refresh untuk permintaan
  bersamaan. Izin unggah Comfy juga dapat diperbarui dengan stream file baru.
- Upload memakai `/upload/image` dengan field multipart `image` serta
  Rh-Comfy-Auth dan Rh-Identify di header dan query, sesuai editor. URL berisi
  izin media sementara ini tidak dicatat atau dikembalikan sebagai error;
  redirect dinonaktifkan. Ini berlaku untuk file gambar maupun video.
- Akun memperoleh workspace **VANTA Studio** tersendiri saat Generate pertama.
  Workspace disiapkan sebelum menandai pengiriman inferensi. Editor lain tidak
  ditimpa, disimpan, atau diubah oleh transport ini.
- Graph API dan override input Vanta dikirim dalam `promptContent` ke
  `/task/create`, sesuai struktur permintaan editor.
- Tidak ada pengulangan create setelah timeout, respons ambigu, atau penolakan
  autentikasi pada create. Batas concurrency web 424 dipetakan ke penolakan
  kapasitas yang sudah ditangani antrean Vanta.
- Selama ada akun sesi web di Pool, Automatic memakai akun sesi web. Tidak ada
  fallback otomatis ke API berbayar. Akun API lama tetap dapat dipilih manual.
- Pemeriksaan hasil memakai `/task/list` dan `/api/output/v2/history`, dengan
  pencocokan task ID yang tepat. Hasil task lain tidak dipakai sebagai pengganti.
- Aturan minimum 100 RH, penghapusan akun dengan saldo terverifikasi di bawah
  100 RH, registry terenkripsi, dan retensi hasil tiga hari tetap digunakan.

## Sumber protokol dan batas verifikasi

Protokol dibaca dari aset frontend resmi RunningHub yang dimuat editor pada
8 November 2026:

- [Layanan task](https://www.runninghub.ai/_nuxt/cKwDRFvK.js)
- [Pengiriman dari editor](https://www.runninghub.ai/_nuxt/FDsueUoQ.js)
- [Sesi, identitas, dan refresh token](https://www.runninghub.ai/_nuxt/Devn8H_P.js)
- [Hasil dan pagination History](https://www.runninghub.ai/_nuxt/DgKV9p04.js)

Ini adalah protokol web internal, bukan kontrak OpenAPI yang didokumentasikan.
Keberlakuan sesi dari server Railway, bentuk respons aktual workspace/upload,
hasil render, dan penggunaan jenis RH Coins **belum dibuktikan dengan generate
nyata**. Pemeriksaan editor yang tersimpan berhasil; tidak ada task berbayar
yang dijalankan untuk pekerjaan ini.

Pengujian baru memakai respons fixture pada transport HTTP. Fixture tersebut
memeriksa keamanan kredensial, rotasi token, isolasi task, format upload dan
create, serta pencegahan duplikasi; hasilnya tidak membuktikan penerimaan
permintaan oleh RunningHub. Pratinjau browser lokal juga belum terverifikasi:
browser terpisah tidak dapat menjangkau port lokal pengujian.

Akatz tetap ditunda. Resep/model dan graph generasi tidak diubah. Persiapan model
H3 yang masih membutuhkan otorisasi unggah LoRA melalui OpenAPI belum didukung
oleh transport sesi; operasi tersebut berhenti sebelum inferensi dan tidak
dialihkan diam-diam ke API. Uji awal jalur sesi ditujukan untuk KOH dan RIFE.
Jalur ZIP MotionFly yang sudah berhasil merupakan file workflow terpisah dan
tidak diubah oleh integrasi sesi ini.
