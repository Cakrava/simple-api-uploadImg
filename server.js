const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')

// Inisialisasi aplikasi Express
const app = express()
const PORT = process.env.PORT || 3000

// Membuat direktori 'public/images' jika belum ada
const uploadDir = 'public/images'
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// Konfigurasi Multer untuk penyimpanan file
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir) // Folder penyimpanan file
  },
  filename: function (req, file, cb) {
    // Ambil ID dari body request
    const id = req.body.id
    if (!id) {
      return cb(new Error('ID wajib diisi'))
    }
    // Rename file: id + ekstensi asli
    const newFilename = `${id}${path.extname(file.originalname)}`
    cb(null, newFilename)
  },
})

// Filter untuk memastikan hanya file gambar yang diunggah
const imageFilter = (req, file, cb) => {
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
    return cb(new Error('Hanya file gambar yang diizinkan!'), false)
  }
  cb(null, true)
}

const upload = multer({ storage: storage, fileFilter: imageFilter })

// Middleware untuk membuat folder 'public' dapat diakses secara statis
app.use(express.static('public'))

app.get('/', (req, res) => {
  res.send(
    'Server API Upload Gambar berjalan. Gunakan metode POST ke /upload untuk mengunggah gambar.',
  )
})

// Rute untuk mengunggah gambar
app.post('/upload', upload.single('image'), (req, res) => {
  // Cek jika tidak ada file yang diunggah
  if (!req.file) {
    return res.status(400).json({
      status: 'error',
      message: 'Tidak ada file yang diunggah atau ID tidak disertakan.',
    })
  }

  // --- LOGIKA TAMBAHAN UNTUK MENGHAPUS FILE LAMA ---
  // Logika ini akan mencari file lain dengan ID yang sama (namun ekstensi berbeda) dan menghapusnya.
  try {
    const newFilename = req.file.filename
    const fileId = path.parse(newFilename).name // Mengambil nama file tanpa ekstensi (yaitu ID)

    // Membaca semua file dalam direktori
    fs.readdir(uploadDir, (err, files) => {
      if (err) {
        console.error('Tidak bisa memindai direktori:', err)
        return // Keluar jika ada error saat membaca direktori
      }

      // Loop melalui setiap file yang ditemukan
      files.forEach((file) => {
        const existingFileId = path.parse(file).name

        // Jika ID file yang ada sama dengan ID file yang baru diunggah,
        // TAPI nama file lengkapnya berbeda (berarti ekstensinya beda)
        if (existingFileId === fileId && file !== newFilename) {
          // Hapus file lama tersebut
          fs.unlink(path.join(uploadDir, file), (unlinkErr) => {
            if (unlinkErr) {
              console.error(`Gagal menghapus file lama ${file}:`, unlinkErr)
            } else {
              console.log(`Berhasil menimpa file lama: ${file}`)
            }
          })
        }
      })
    })
  } catch (error) {
    console.error('Error saat proses cleanup file lama:', error)
  }
  // --- AKHIR DARI LOGIKA TAMBAHAN ---

  // Proses respon setelah unggahan selesai
  try {
    const imageUrl = `${req.protocol}://${req.get('host')}/images/${
      req.file.filename
    }`

    res.status(200).json({
      status: 'success',
      message: 'Gambar berhasil diunggah atau diperbarui!',
      data: {
        id: req.body.id,
        filename: req.file.filename,
        url: imageUrl,
      },
    })
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: `Terjadi kesalahan di server: ${error.message}`,
    })
  }
})

// Menjalankan server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`)
})
