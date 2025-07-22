const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')

const app = express()
const PORT = process.env.PORT || 3000

// --- KONFIGURASI PATH ---
const uploadDir = path.join(__dirname, 'public/images')
const dbPath = path.join(__dirname, 'imageData.json')

// --- INISIALISASI ---
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}
if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, '[]', 'utf-8')
}

// --- FUNGSI BANTUAN DATABASE (JSON) ---
const readDb = () => {
  try {
    const data = fs.readFileSync(dbPath, 'utf-8')
    return JSON.parse(data)
  } catch (error) {
    console.error('Gagal membaca DB:', error)
    return []
  }
}

const writeDb = (data) => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (error) {
    console.error('Gagal menulis ke DB:', error)
  }
}

// ==========================================================
//      PERUBAHAN UTAMA #1: KONFIGURASI MULTER
// ==========================================================
// Konfigurasi multer untuk menyimpan file di memory, bukan di disk
const storage = multer.memoryStorage()

const upload = multer({
  storage: storage, // Gunakan memoryStorage
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
      return cb(new Error('Hanya file gambar yang diizinkan!'), false)
    }
    cb(null, true)
  },
})

// --- MIDDLEWARE ---
app.use(express.static('public'))

// --- ENDPOINTS ---
app.get('/', (req, res) => {
  res.send('API Aktif. Gunakan POST /upload atau DELETE /delete/:id')
})

// Endpoint upload dan update gambar
app.post('/upload', upload.single('image'), async (req, res) => {
  const { id, image_token } = req.body
  // Validasi sekarang hanya perlu memeriksa req.file karena tidak ada path lagi
  if (!req.file || !id || !image_token) {
    return res.status(400).json({
      status: 'error',
      message: 'Wajib menyertakan id, image_token, dan file gambar.',
    })
  }

  const db = readDb()
  // Ekstensi diambil dari originalname, sama seperti sebelumnya
  const ext = path.extname(req.file.originalname).toLowerCase()
  const newFilename = `${image_token}${ext}`
  const newPath = path.join(uploadDir, newFilename)

  const existingEntryIndex = db.findIndex((entry) => entry.id === id)

  if (existingEntryIndex !== -1) {
    const oldToken = db[existingEntryIndex].token
    const files = fs.readdirSync(uploadDir)
    const oldFile = files.find((f) => path.parse(f).name === oldToken)
    if (oldFile) {
      fs.unlinkSync(path.join(uploadDir, oldFile))
      console.log(`File lama dihapus: ${oldFile}`)
    }
    db[existingEntryIndex].token = image_token
  } else {
    db.push({ id, token: image_token })
  }

  // ==========================================================
  //      PERUBAHAN UTAMA #2: PROSES GAMBAR DARI BUFFER
  // ==========================================================
  try {
    // Proses gambar langsung dari `req.file.buffer` yang ada di memory
    await sharp(req.file.buffer)
      .resize({
        width: 1080,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 50 }) // Anda bisa menggabungkan kompresi di sini
      .png({ quality: 50 })
      .toFile(newPath)

    // Jika semua berhasil, tulis perubahan ke database JSON
    writeDb(db)

    const imageUrl = `${req.protocol}://${req.get(
      'host',
    )}/images/${image_token}`
    res.status(200).json({
      status: 'success',
      message: 'Upload dan kompresi berhasil!',
      data: {
        id,
        token: image_token,
        filename: newFilename,
        url: imageUrl,
      },
    })
  } catch (error) {
    console.error('Gagal memproses gambar:', error)
    return res
      .status(500)
      .json({ status: 'error', message: 'Gagal memproses gambar.' })
  }
})

// Endpoint untuk menghapus gambar dan data terkait
app.delete('/delete/:id', (req, res) => {
  const { id } = req.params
  const db = readDb()
  const entryToDelete = db.find((entry) => entry.id === id)

  if (!entryToDelete) {
    return res
      .status(404)
      .json({ status: 'error', message: 'ID tidak ditemukan.' })
  }

  const token = entryToDelete.token
  const files = fs.readdirSync(uploadDir)
  const fileToDelete = files.find((f) => path.parse(f).name === token)

  if (fileToDelete) {
    fs.unlinkSync(path.join(uploadDir, fileToDelete))
  }

  const newDb = db.filter((entry) => entry.id !== id)
  writeDb(newDb)

  res.status(200).json({
    status: 'success',
    message: `Data dan gambar untuk ID '${id}' telah dihapus.`,
  })
})

// Endpoint akses gambar berdasarkan token
app.get('/images/:imageToken', (req, res) => {
  const { imageToken } = req.params
  const dirPath = path.join(__dirname, 'public/images')

  fs.readdir(dirPath, (err, files) => {
    if (err) return res.status(500).send('Gagal membaca folder gambar.')
    const fileName = files.find((f) => path.parse(f).name === imageToken)
    if (fileName) {
      res.sendFile(path.join(dirPath, fileName))
    } else {
      res.status(404).send('Gambar tidak ditemukan.')
    }
  })
})

// Jalankan server
app.listen(PORT, () => {
  console.log(`🚀 Server aktif di http://localhost:${PORT}`)
})
