# MotionFly: referensi tanpa AI upscale/refine — 19 November 2026

ID: MOTIONFLY-RAW-REFERENCE-20261119
Status terkini: perubahan aktif di Vanta; regresi lokal, CI dan deployment lulus. Render GPU baru serta penerimaan visual belum diuji.
Tanggal lokal: 19 November 2026 (Asia/Jakarta).

## Permintaan dan basis

Pengguna meminta gambar referensi yang diunggah tidak di-upscale atau di-refine, agar tampil alami, dan aspek rasio hasil mengikuti gambar referensi.

Basis repository: 5c810956b52b1c0896fa539dab2cba33a7679e1a. Source aplikasi aktif: 5d0c31038b3c17cefec15cf7f26cc8cbf2de9192, deployment 0bb1a8e2-2faa-408c-a206-1b31bc73a39d berstatus SUCCESS pada pemeriksaan awal. Lingkup perubahan hanya MotionFly; otorisasi pengguna mencakup edit dan implementasi pada Vanta yang sama.

## Temuan awal

- Node 308 ImageResizeKJv2 pada foto memakai nvidia_rtx_vsr, target total_pixels 640×1120, pembulatan16. Ini memang peningkatan berbasis AI pada referensi.
- Node 489 pada hasil decode juga memakai nvidia_rtx_vsr menuju ukuran HD yang diambil dari node497.
- Node497 ImageResizeKJv2 melakukan resize foto hanya untuk mengambil width/height hasil, meskipun IMAGE keluaran tidak dipakai model.
- Driver89 mengikuti ukuran foto308 dan dipad agar gerakan utuh; SAM3, conditioning dan latent memakai kanvas kerja yang sama.
- Preview/cadangan/ZIP, audio dan RIFE 60 berada pada satu task. Kompatibilitas Filenames yang dirilis 18 November harus tetap dipertahankan.

## Rencana sebelum perubahan

1. Hapus NVIDIA VSR dari jalur foto dan hasil akhir. Gunakan area untuk pengecilan foto biasa, tanpa generative refinement, enhancement, sharpening atau koreksi warna.
2. Hitung batas ukuran kerja dari dimensi foto: maksimum budget lama 716800 piksel dan faktor skala maksimum1, sehingga gambar kecil tidak diperbesar. Alignment16 tetap diperlukan oleh model. Seluruh foto dipertahankan, tanpa portrait crop atau penambahan border pada referensi.
3. Ganti node497 yang meresize foto untuk metadata dengan perhitungan dimensi numerik. Target output HD tetap budget lama 2073600 piksel, aspect dari foto asli dan alignment8. Resize hasil HD memakai Lanczos biasa; pembesaran piksel hasil generasi bila perlu tetap merupakan interpolasi output, bukan peningkatan detail AI dan bukan perubahan file referensi.
4. Pertahankan model/LoRA/prompt/sampling, mask/driver alignment, audio, RIFE 60, MP4/ZIP, pilihan akun/mesin dan retensi. File foto upload tidak disimpan ulang atau direkayasa.
5. Periksa dukungan registry dan implementasi operator yang dipakai; uji fungsi resize dan ekspresi dengan tensor CPU, hubungan graf/editor, beberapa rasio/ukuran serta kedua mesin, kemudian full regression dan CI sebelum deploy.
6. Jangan menjalankan render GPU untuk diagnosis atau mengulang submission lama. Pisahkan kelulusan CPU/CI/deployment dari hasil visual pengguna.

Registry terbaru dibaca dari https://www.runninghub.ai/object_info, SHA256 32c2dac6a7febaaf19eee4b639cd611afdeb7a9f4ceb5ee47e29b8cbbb63b76c. ImageResizeKJv2 mendeklarasikan area/lanczos, resize/total_pixels dan keluaran dimensi; MathExpression|pysssss tersedia. Sumber ImageResizeKJv2 upstream Kijai/ComfyUI-KJNodes nodes/image_nodes.py blob a2a0c9e6206cec696f6f59426408cde84b90c98a dibaca. Semantik ekspresi dimensi dan operator resize akan diverifikasi sebelum dipakai.

## Hasil

Belum ada perubahan aplikasi, tes GPU atau hasil visual baru pada entri awal ini. Penutup akan mencatat diff aktual, tes, kegagalan, rilis, batas dan rollback.

## Implementasi aktual

- Foto 308 kini area/CPU, keep_proportion resize, tanpa crop/padding pada referensi, ukuran dari MathExpression 499 dan 502. Faktor skala min(1,sqrt(716800/piksel_foto)); alignment 16. Foto kecil yang sudah aligned tidak diperbesar atau diubah nilainya.
- Node 497/498 hanya menghitung dimensi output HD dari a.width/a.height milik LoadImage30; tidak membuat salinan gambar hasil resize untuk metadata. Alignment 8 dan budget 2073600 piksel dipertahankan. Slot 500/501 yang pernah dipakai History/mask lama tetap tidak dipakai; ekspresi baru menggunakan 502.
- Output 489 kini Lanczos/CPU untuk ukuran HD, tanpa NVIDIA VSR. Ini tetap resampling output generasi, yang dapat membesarkan ukuran piksel keluaran; tidak menjanjikan detail native 1080 atau kualitas identik foto dari hasil diffusion.
- Label/detail menu menjelaskan referensi tanpa AI upscale/refine. Internal workflow ID/nama, model/LoRA/prompt/sampler, audio, RIFE 60 satu task, MP4/ZIP, dan mekanisme akun tidak diganti.

## Verifikasi kandidat

- Referensi primer: ImageResizeKJv2 a2a0c9e6206cec696f6f59426408cde84b90c98a; MathExpression pysssss 4a41655b6876a077338040b0099c4d4e8c9dbcd2 dari pythongosssss/ComfyUI-Custom-Scripts; fungsi resize ComfyUI 9d428226c6d1e69af4fe9c7cc75ba3798f7798ce. Ekspresi a.width/a.height, min/floor/sqrt dibuktikan dari implementasi dan registry terbaru.
- Uji CPU menjalankan ekspresi, metode KJ resize dan fungsi Comfy area/Lanczos yang dibaca, memakai tensor sintetis dan stub infrastruktur UI/GPU. Delapan ukuran/rasio lulus, tidak ada provider/GPU call, tensor sumber tidak dimutasi, referensi persis sama dengan area biasa, foto kecil aligned persis tetap nilainya. Hasil ini bukan tes diffusion/SAM3/RIFE GPU atau penerimaan visual.
- Contoh photo → working → HD: 320×480 →320×480 →1168×1760; 640×480 →640×480 →1656×1240; 1080×1920 →624×1120 →1080×1920; 2048×1529 →976×720 →1664×1240; 1200×1200 →832×832 →1440×1440. Rasio mengikuti foto dalam toleransi alignment encoder; tidak menjanjikan pecahan rasio matematis eksak untuk semua ukuran integer.
- Tes geometri mencakup 11 ukuran foto × 3 bentuk driving video: referensi tidak diperbesar, budget sampling tidak naik, latent/mask/driving satu kanvas, rasio output tidak ditentukan video, dan orientasi portrait/landscape/square terjaga.
- Hash graf setelah mengecualikan node pemrosesan foto/ukuran tetap 21c0188f377a36cd3c9342f95f4532ee22425511d7fdc8b9a45ca77cfc9d1ee6; seluruh resep generasi lain identik. SHA256 editor kandidat 42513fc1a5d4c1a893b27df902afdf4174d6094b5d34dd5a4c2820c91b1db531.
- Tes pengiriman native keenam workflow ×Standard/Plus lulus, termasuk prompt/editor/Save yang sama, satu create fixture, ZIP kompatibel dari rilis sebelumnya, serta tidak ada VSR pada payload MotionFly.
- Rangkaian lengkap awal menghentikan perubahan pada guard checksum/resep VSR lama dan jumlah node audit 103; guard diperbarui sesudah diff/CPU diperiksa, jumlah node kini 106 karena tiga node numerik tambahan. Guard 500/501 untuk History lama dipertahankan. Tes target terkait lulus; rangkaian lengkap diulang sebelum rilis.

Belum ada render GPU baru. CI dan deployment masih harus dibuktikan. Penutup akan memuat rilis aktual, health, keberhasilan/kegagalan, batas dan rollback.

## Penutup MOTIONFLY-RAW-REFERENCE-20261119

Perubahan digabungkan melalui PR121 menjadi commit aplikasi **151f33fee5edd300d5fa42486dd74929e4fe5ce2**. Tree **6be2e6ecaaa92235ca4d6f761f61c1768c4fb207** identik dengan kandidat c7e015b6c7cca97762dd5a2df5258d79494c711b yang diuji; sembilan blob perubahan dicocokkan terhadap berkas lokal sebelum publikasi.

**Pemeriksaan selesai:**
- Full npm run check lokal selesai exit0 pada kandidat akhir. Penjagaan checksum dan ukuran graf audit yang memakai kontrak lama sudah diperbarui sesudah pemeriksaan diff; aturan node History 500/501 tetap berlaku. Tidak ada bypass tes untuk merilis.
- Keenam check PR121 dan keenam check commit main aplikasi selesai success: regression, image-contract, popup Chromium, Firefox, Edge dan WebKit. Instalasi dependensi WebKit pada PR sempat lebih lama, lalu pemeriksaan selesai success.
- Deployment **6a578d2d-65b4-4d53-ab54-a56a44e674e8** mencapai **SUCCESS pada 19 November 2026 pukul 22:47:33 WIB** (15:47:33.116 UTC). Pembacaan kembali layanan yang sama menunjukkan source pin 151f33fee5edd300d5fa42486dd74929e4fe5ce2 dan server listening pada port 8080.
- Health publik HTTP200/ok=true terverifikasi pukul 22:49:59 WIB. Volume /data yang sama tetap 5000MB; konfigurasi/kredensial, dua layanan agent lain dan kebijakan retensi tidak diubah. Staged source lama diselaraskan dengan source aktif, tanpa menerapkan perubahan lingkungan lain melalui accept-deploy.

**Hasil konkret:** foto referensi tidak melewati NVIDIA VSR/refinement dan tidak diperbesar oleh tahap resize referensi. Ukuran kerja hanya diperkecil jika perlu dan diselaraskan ke model. Dimensi HD berasal langsung dari bentuk foto asli; hasil akhir memakai resampling Lanczos biasa tanpa AI enhancement. Audio/RIFE 60/MP4/ZIP serta seluruh model/sampling tetap dari resep yang sama.

**Batas hasil:** uji CPU menggunakan tensor sintetis, bukan foto pengguna atau render diffusion. Tidak ada generate provider baru yang diajukan asisten. Kualitas visual, konsistensi identitas dan runtime GPU berikutnya masih harus dikonfirmasi lewat hasil pengguna. Output HD tetap dapat merupakan pembesaran piksel hasil generasi melalui Lanczos; jangan menyebutnya bukti detail native 1080 atau menyatakan seluruh hasil sama persis dengan piksel foto. Pembulatan 16/8 dapat memberi selisih rasio kecil akibat alignment.

**Rollback/acuan berikut:** source aplikasi sebelumnya 5d0c31038b3c17cefec15cf7f26cc8cbf2de9192. Mengembalikan versi tersebut juga mengembalikan VSR pada MotionFly, sehingga bukan penyelesaian untuk permintaan referensi alami ini. Catat task/error/hasil pengguna berikutnya terhadap versi 151f33fee5edd300d5fa42486dd74929e4fe5ce2. Pembaruan penutup ini dokumentasi saja; pin aplikasi yang telah teruji dipertahankan.
