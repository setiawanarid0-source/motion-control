# Diagnosis MotionFly: VHS Filenames dihapus — 18 November 2026

ID investigasi: RH-VHS-FILENAMES-DIAGNOSIS-20261118  
Status terkini: kandidat perbaikan ekspor terimplementasi dan tes lokal lengkap lulus; CI serta deployment belum terkonfirmasi. Riwayat diagnosis awal dipertahankan di bawah.  
Tanggal lokal: 18 November 2026 (Asia/Jakarta).

## Permintaan dan kondisi awal

Pengguna melaporkan tidak bisa generate video secara tiba-tiba. Dua screenshot memakai MotionFly · 1080 HD + ZIP, mesin Standard, dan pilihan Account 01/Account 02. Vanta menampilkan “Status penerimaan belum pasti” tanpa task ID.

Lingkup pemeriksaan: baca log layanan Vanta yang sama, cocokkan sumber aplikasi terpasang dengan graf MotionFly, lalu baca registry node RunningHub terbaru. Tidak mengirim generate/task-create baru, mengulang submission yang belum pasti, membatalkan task, mengubah akun/mesin/saldo, atau mengubah workflow inferensi.

## Bukti yang diperiksa

1. Railway masih menjalankan deployment d777227f-34c5-444c-a181-6f6df38dd6ec berstatus SUCCESS, source aplikasi 7905905cc784a2e581fd576d2fc8b2afc32dcdfe. Tidak ada rilis aplikasi baru sejak perbaikan pembacaan saldo 17 November pada layanan yang diperiksa.
2. Main saat diagnosis adalah eeec1ca36cefed4a0ad453782d7e49c8848423d4. Perubahan setelah source aplikasi tersebut hanya dokumentasi investigasi saldo sebelumnya.
3. Empat baris runtime “RunningHub acceptance unconfirmed” pada 18 November pukul 11:53:57, 11:54:48, 11:55:38, dan 11:55:52 UTC (18:53–18:55 WIB) memuat respons dengan result:false dan error.type **vhs_filenames_removed**. Pesan menyebut Video Combine dan Filenames. Pesan runtime dipotong oleh kode aplikasi menjadi 160 karakter; jangan menganggapnya respons provider lengkap atau bukti tidak ada task pada seluruh riwayat akun.
4. GET publik https://www.runninghub.ai/object_info berhasil HTTP 200 saat diagnosis. nodes_info memuat 20.617 definisi. VHS_VideoCombine sekarang mendeklarasikan output:[] dan output_name:[], tetap output_node:true. Jadi node penyimpan video masih ada, tetapi port keluaran Filenames tidak tersedia pada registry terbaru.
5. Snapshot registry lama di workflows/runninghub-web-node-schemas.json masih mendeklarasikan satu output VHS_VideoCombine: Filenames bertipe VHS_FILENAMES. Ini berbeda dengan registry yang baru dibaca.
6. MotionFly aktif berasal dari motionfly-hd-workflow.js dan workflows/motionfly-hd-runninghub.json. Builder memasukkan root 490, 493, dan 496. Node 493 VHS_VideoCombine memakai output slot 0 melalui link 1041 ke node 494 VHS_SelectFilename.filenames. Node 494 diteruskan melalui link 1042 ke node 496 CompressImages. Jalur preview → pilih nama berkas → ZIP ini bergantung pada port yang sudah dihapus.
7. SHA-256 snapshot registry baca-saja: ecbd2e9451424b3ce0040c56020982482bdcf094d437aac0cff2dc385c28f7cd. Snapshot diambil tanpa sesi akun dan tanpa alokasi GPU. Deklarasi registry tidak membuktikan eksekusi atau kualitas video pengganti.

## Kesimpulan

Penolakan yang teramati berasal dari pemeriksaan kompatibilitas RunningHub terhadap penggunaan output Filenames milik VHS_VideoCombine. Graf ekspor ZIP Vanta masih memakai kontrak port lama. Temuan ini menjelaskan mengapa pergantian akun tidak menghilangkan error yang sama.

Vanta juga mempunyai kekurangan pelaporan: createTask jatuh ke Error(data.msg) untuk respons ini; req.submissionAttempted sudah disetel sebelum /task/create. runQueuedGeneration lalu mengubahnya menjadi status uncertain dan mengganti pesan asli dengan peringatan penerimaan belum pasti. Jadi pesan pada screenshot berasal dari lapisan penanganan Vanta; error teknis yang mendasarinya diterima dari RunningHub.

Log percobaan ini bukan penolakan kredit, bukan bukti token kedaluwarsa, dan bukan bukti kesalahan gambar/video. Tidak menetapkan gangguan menyeluruh RunningHub, waktu persis perubahan platform, status penerimaan seluruh percobaan pada riwayat akun, atau pembebanan/refund kredit. Akun bersaldo tidak menjamin graf dengan port yang dihapus akan diterima.

## Yang perlu diperbaiki berikutnya

- Sesuaikan jalur ekspor dengan kontrak node RunningHub terkini. Pertahankan MP4, audio, FPS, ukuran/orientasi, preview, retensi, dan kebutuhan ZIP pengguna; jangan diam-diam membuang ZIP atau mengubah model/sampling untuk menghindari error ekspor.
- Periksa implementasi/runtime jalur pengganti. Kehadiran node alternatif di registry saja belum membuktikan kompatibilitas encoding, output, watermark, atau ZIP yang sesuai.
- Kenali penolakan struktural vhs_filenames_removed secara khusus dan tampilkan penyebab yang dapat dipahami. Hanya tandai pasti ditolak apabila respons lengkap dan tahapnya membuktikan hal itu; tetap pertahankan larangan replay untuk timeout, respons ambigu, atau adanya task ID.
- Periksa workflow lain yang masih menyambungkan output VHS sebelum menyatakan masalah memengaruhi semuanya. Diagnosis konkret saat ini adalah MotionFly pada screenshot.
- Gunakan ID investigasi ini sebagai acuan sebelum implementasi berikutnya. Tidak menyuruh pengguna mengulang generate yang sama sebagai pengganti diagnosis.

## Penutup

Pemeriksaan log runtime, sumber aktif, sambungan graf, dan registry node publik selesai. Tidak ada perubahan aplikasi, workflow, deployment, akun, atau task dalam investigasi ini. Tidak ada render GPU baru dan generate belum dinyatakan pulih. Dokumen ini menyimpan hasil diagnosis; bukan catatan rilis perbaikan.

## Awal perbaikan RH-VHS-FILENAMES-REPAIR-20261118

Pengguna meminta perbaikan langsung setelah diagnosis. Otorisasi mencakup implementasi, pengujian, dan deployment pada layanan Vanta yang sama. Acuan aplikasi rollback: 7905905cc784a2e581fd576d2fc8b2afc32dcdfe; acuan repository sebelum perbaikan: cca00b0e1b4dce1b28a10c54b53a45053f873a01.

Rencana: pilih jalur ekspor yang didukung registry RunningHub saat ini, verifikasi implementasi encoder/arsip, pertahankan resep inferensi dan kebutuhan video/audio/ZIP, perbaiki klasifikasi error terstruktur tanpa replay submission, lalu jalankan pemeriksaan relevan dan CI sebelum rilis. Model, sampling, pemilihan akun/mesin, dan retensi tiga hari tetap sesuai kontrak pengguna. Tidak menjalankan render GPU; hasil render baru harus tetap ditandai belum diuji.

Status awal: investigasi sumber ekspor berlangsung, belum ada perubahan aplikasi dan belum ada klaim generate pulih. Jangan memperlakukan sekadar hilangnya link Filenames atau lolosnya schema sebagai bukti kualitas keluaran.

## Implementasi kandidat RH-VHS-FILENAMES-REPAIR-20261118

Perubahan aktual sebelum rilis:
- Adapter delivery memigrasikan hanya VHS_VideoCombine yang output-nya dikonsumsi node lain menjadi **VideoCombineV2**. Registry 18 November masih mendeklarasikan port VHS_FILENAMES pada V2. Encoder backup yang tidak mempunyai downstream tetap memakai VHS asli dengan deklarasi nol output. Input encoder, CRF/pix_fmt, format H.264, FPS, audio, ukuran/frame sumber, dan sambungan SelectFilename → CompressImages dipertahankan.
- Adapter dipasang setelah penambahan ZIP, sebelum native validation/Save/create, serta pada unduhan editor Akatz dan graf audit baca-saja MotionFly. Seluruh prompt dan workflow editor pada submission memakai hasil adaptasi yang sama. Historical builder/inference recipe tetap sebagai sumber, tidak diganti model lain.
- Snapshot layout editor menambahkan VideoCombineV2 dan memperbarui output VHS_VideoCombine menjadi kosong sesuai registry. Provenance sumber dan registry disimpan bersama snapshot.
- Penolakan struktural vhs_filenames_removed kini dikenali sebagai workflow validation error dan ditampilkan langsung. Bukti eksplisit failure tetap diperlukan; task ID, code0 yang bertentangan, timeout, atau respons tidak lengkap tetap uncertain dan tidak direplay. Pemilihan akun/mode serta single-submit tetap berlaku.
- Cache versi app.js diperbarui agar pesan baru termuat setelah refresh.

Sumber encoder diperiksa pada FX-FeiHou/ComfyUI-FeiHou-Toolbox, commit 8ba47000b9aeaf6cae6a5ddfab981e668726fd8c, backend blob dfea01360b48051632efac576e77dd5a1129db8d. V2 memakai backend VHS yang dibundel; mengembalikan satu file audio-final dan melakukan penyematan metadata dengan stream-copy. Input latent opsional tidak dihubungkan; fitur simpan/gabung latent baru tidak diaktifkan.

Pemeriksaan kandidat yang sudah dijalankan:
- Tes transport aktual server mencakup enam workflow × dua mesin (Standard/Plus): validasi native, Save dan satu create memakai prompt/editor yang sama, tanpa sambungan keluar dari VHS_VideoCombine. Ini transport fixture, bukan pengajuan task provider.
- Tes migrasi MotionFly membuktikan hanya encoder 493 berubah class; input encoder, sambungan ZIP 494/496, RIFE60, dan semua node inferensi tetap. Migrasi tidak memutasi basis dan idempotent.
- Tes worker/UI membuktikan penolakan removed-port tidak berpindah akun, menghasilkan error terminal dengan alasan asli, sedangkan acknowledgement bertentangan tetap uncertain. Tes native preflight mencakup penolakan sebelum Save/create.
- Uji source encoder CPU dengan tensor sintetis dan FFmpeg nyata: 4 kasus, landscape/portrait, 24/60 FPS, dengan/tanpa audio. Ukuran, jumlah frame, H.264/yuv420p, FPS dan durasi sesuai; hash paket video identik dengan backend VHS pembanding, paket audio identik bila ada audio, dan byte MP4 identik sesudah ZIP round-trip. File final satu per ekspor. Infrastruktur ComfyUI IO/folder/progress distub; tidak menguji RunningHub worker, GPU atau node ZIP provider baru.
- Pemeriksaan awal menemukan ekspektasi class lama pada tes ekspor Remake dan graf audit MotionFly; keduanya disesuaikan dengan jalur ekspor aktual dan tes terkait lulus. Full suite lokal pertama terhenti karena OpenCV tidak tersedia pada interpreter scratch; dependensi pengujian lokal ditambahkan tanpa mengubah dependensi aplikasi. Pemeriksaan ulang sedang dijalankan.

Belum rilis pada saat entri ini ditulis. CI, deployment dan render GPU pengguna belum terkonfirmasi. Jangan menyatakan generate sudah pulih dari uji CPU atau fixture saja.

### Pemeriksaan lengkap kandidat

Full npm run check lokal selesai exit0 setelah dependensi OpenCV untuk lingkungan pengujian scratch tersedia. Semua rangkaian regresi yang dikonfigurasi, termasuk migrasi output baru, 53 tes web-session, enam workflow × dua mesin, worker/UI/no-replay, editor HTTP/Remake, retensi/arsip/history, serta kontrak lain lulus. Dependensi OpenCV ini hanya untuk menjalankan rangkaian pengujian yang sudah ada; package dependensi produksi dan Dockerfile tidak diubah.

Tahap berikut: terbitkan kandidat, tunggu seluruh CI yang diwajibkan, gabungkan pada main yang sama, pin layanan Railway yang sama ke commit teruji, lalu periksa status deployment dan health. Tidak menjalankan ulang empat submission lama atau generate GPU baru.
