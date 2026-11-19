# MotionFly: referensi tanpa AI upscale/refine — 19 November 2026

ID: MOTIONFLY-RAW-REFERENCE-20261119
Status: awal pekerjaan tersimpan; perubahan aplikasi belum dilakukan.
Tanggal lokal: 19 November 2026 (Asia/Jakarta).

## Permintaan dan basis

Pengguna meminta gambar referensi yang diunggah tidak di-upscale atau di-refine, agar tampil alami, dan aspek rasio hasil mengikuti gambar referensi.

Basis repository: 5c810956b52b1c0896fa539dab2cba33a7679e1a. Source aplikasi aktif: 5d0c31038b3c17cefec15cf7f26cc8cbf2de9192, deployment 0bb1a8e2-2faa-408c-a206-1b31bc73a39d berstatus SUCCESS pada pemeriksaan awal. Lingkup perubahan hanya MotionFly; otorisasi pengguna mencakup edit dan implementasi pada Vanta yang sama.

## Temuan awal

- Node 308 ImageResizeKJv2 pada foto memakai nvidia_rtx_vsr, target total_pixels 640×1120, pembulatan16. Ini memang peningkatan berbasis AI pada referensi.
- Node 489 pada hasil decode juga memakai nvidia_rtx_vsr menuju ukuran HD yang diambil dari node497.
- Node497 ImageResizeKJv2 melakukan resize foto hanya untuk mengambil width/height hasil, meskipun IMAGE keluaran tidak dipakai model.
- Driver89 mengikuti ukuran foto308 dan dipad agar gerakan utuh; SAM3, conditioning dan latent memakai kanvas kerja yang sama.
- Preview/cadangan/ZIP, audio dan RIFE60 berada pada satu task. Kompatibilitas Filenames yang dirilis 18 November harus tetap dipertahankan.

## Rencana sebelum perubahan

1. Hapus NVIDIA VSR dari jalur foto dan hasil akhir. Gunakan area untuk pengecilan foto biasa, tanpa generative refinement, enhancement, sharpening atau koreksi warna.
2. Hitung batas ukuran kerja dari dimensi foto: maksimum budget lama 716800 piksel dan faktor skala maksimum1, sehingga gambar kecil tidak diperbesar. Alignment16 tetap diperlukan oleh model. Seluruh foto dipertahankan, tanpa portrait crop atau penambahan border pada referensi.
3. Ganti node497 yang meresize foto untuk metadata dengan perhitungan dimensi numerik. Target output HD tetap budget lama 2073600 piksel, aspect dari foto asli dan alignment8. Resize hasil HD memakai Lanczos biasa; pembesaran piksel hasil generasi bila perlu tetap merupakan interpolasi output, bukan peningkatan detail AI dan bukan perubahan file referensi.
4. Pertahankan model/LoRA/prompt/sampling, mask/driver alignment, audio, RIFE60, MP4/ZIP, pilihan akun/mesin dan retensi. File foto upload tidak disimpan ulang atau direkayasa.
5. Periksa dukungan registry dan implementasi operator yang dipakai; uji fungsi resize dan ekspresi dengan tensor CPU, hubungan graf/editor, beberapa rasio/ukuran serta kedua mesin, kemudian full regression dan CI sebelum deploy.
6. Jangan menjalankan render GPU untuk diagnosis atau mengulang submission lama. Pisahkan kelulusan CPU/CI/deployment dari hasil visual pengguna.

Registry terbaru dibaca dari https://www.runninghub.ai/object_info, SHA256 32c2dac6a7febaaf19eee4b639cd611afdeb7a9f4ceb5ee47e29b8cbbb63b76c. ImageResizeKJv2 mendeklarasikan area/lanczos, resize/total_pixels dan keluaran dimensi; MathExpression|pysssss tersedia. Sumber ImageResizeKJv2 upstream Kijai/ComfyUI-KJNodes nodes/image_nodes.py blob a2a0c9e6206cec696f6f59426408cde84b90c98a dibaca. Semantik ekspresi dimensi dan operator resize akan diverifikasi sebelum dipakai.

## Hasil

Belum ada perubahan aplikasi, tes GPU atau hasil visual baru pada entri awal ini. Penutup akan mencatat diff aktual, tes, kegagalan, rilis, batas dan rollback.
