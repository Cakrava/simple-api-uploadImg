const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 3000

// Buat folder tujuan simpan gambar jika belum ada
const uploadDir = path.join(__dirname, 'public/images')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// Konfigurasi multer simpan file ke folder sementara
const upload = multer({
  dest: 'uploads/',
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
      return cb(new Error('Hanya file gambar yang diizinkan!'), false)
    }
    cb(null, true)
  },
})

// Akses folder public (agar /images bisa diakses)
app.use(express.static('public'))

// Root endpoint
app.get('/', (req, res) => {
  res.send('API Upload aktif! Gunakan POST ke /upload.')
})

// Endpoint akses gambar tanpa perlu tahu ekstensi
app.get('/images/:imageCode', (req, res) => {
  const imageCode = req.params.imageCode
  const dirPath = path.join(__dirname, 'public/images')

  fs.readdir(dirPath, (err, files) => {
    if (err) return res.status(500).send('Gagal baca folder gambar.')
    const fileName = files.find((f) => path.parse(f).name === imageCode)
    if (fileName) {
      res.sendFile(path.join(dirPath, fileName))
    } else {
      res.status(404).send('Gambar tidak ditemukan.')
    }
  })
})

// Endpoint upload gambar
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file || !req.body.id) {
    return res.status(400).json({
      status: 'error',
      message: 'Wajib kirim gambar dan ID.',
    })
  }

  const id = req.body.id
  const oldPath = req.file.path
  const ext = path.extname(req.file.originalname)
  const newFilename = `${id}${ext}`
  const newPath = path.join(uploadDir, newFilename)

  // Hapus file lama jika ada
  const existingFiles = fs.readdirSync(uploadDir)
  existingFiles.forEach((file) => {
    if (path.parse(file).name === id && file !== newFilename) {
      fs.unlinkSync(path.join(uploadDir, file))
    }
  })

  // Pindahkan file
  fs.rename(oldPath, newPath, (err) => {
    if (err) {
      return res
        .status(500)
        .json({ status: 'error', message: 'Gagal simpan file.' })
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/images/${id}`
    res.status(200).json({
      status: 'success',
      message: 'Upload berhasil!',
      data: {
        id,
        filename: newFilename,
        url: imageUrl,
      },
    })
  })
})

// Jalankan server
app.listen(PORT, () => {
  console.log(`🚀 Server aktif di http://localhost:${PORT}`)
})
