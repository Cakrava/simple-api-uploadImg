// --- DEPENDENSI ---
const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const sharp = require('sharp')
const { initializeApp } = require('firebase/app')
const { getDatabase, ref, onValue, set } = require('firebase/database')
const mqtt = require('mqtt')

// ==========================================================
//               KONFIGURASI UTAMA
// ==========================================================
const firebaseConfig = {
  apiKey: 'AIzaSyDFjcD83kj0_7baZaA2_Tm7UcCtdafqhnc',
  authDomain: 'sikesa-3d40e.firebaseapp.com',
  databaseURL:
    'https://sikesa-3d40e-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'sikesa-3d40e',
  storageBucket: 'sikesa-3d40e.appspot.com',
  messagingSenderId: '14359253035',
  appId: '1:14359253035:web:4390ae46888b9848195a6e',
  measurementId: 'G-52RQK7ZB66',
}

const MQTT_BROKER_URL = 'ws://broker.emqx.io:8083/mqtt'
const PORT = process.env.PORT || 3000

// ==========================================================
//               INISIALISASI APLIKASI
// ==========================================================
const app = express()
const firebaseApp = initializeApp(firebaseConfig)
const database = getDatabase(firebaseApp)
const mqttClient = mqtt.connect(MQTT_BROKER_URL)

// --- Inisialisasi untuk API Gambar ---
const uploadDir = path.join(__dirname, 'public/images')
const dbPath = path.join(__dirname, 'imageData.json')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '[]', 'utf-8')

// --- Konfigurasi Multer ---
const storage = multer.memoryStorage()
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
      return cb(new Error('Hanya file gambar yang diizinkan!'), false)
    }
    cb(null, true)
  },
})

// --- Middleware ---
app.use(express.static('public'))

// ==========================================================
//                 BAGIAN API GAMBAR
// ==========================================================
app.get('/', (req, res) => {
  res.send('API Gambar & Pemantauan Perangkat Aktif')
})

app.post('/upload', upload.single('image'), async (req, res) => {
  const { id, image_token } = req.body
  if (!req.file || !id || !image_token) {
    return res.status(400).json({
      status: 'error',
      message: 'Wajib menyertakan id, image_token, dan file gambar.',
    })
  }
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
  const ext = path.extname(req.file.originalname).toLowerCase()
  const newFilename = `${image_token}${ext}`
  const newPath = path.join(uploadDir, newFilename)
  const existingEntryIndex = db.findIndex((entry) => entry.id === id)
  if (existingEntryIndex !== -1) {
    const oldToken = db[existingEntryIndex].token
    const files = fs.readdirSync(uploadDir)
    const oldFile = files.find((f) => path.parse(f).name === oldToken)
    if (oldFile) fs.unlinkSync(path.join(uploadDir, oldFile))
    db[existingEntryIndex].token = image_token
  } else {
    db.push({ id, token: image_token })
  }
  try {
    await sharp(req.file.buffer)
      .resize({ width: 1080, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .png({ quality: 70 })
      .toFile(newPath)
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf-8')
    const imageUrl = `${req.protocol}://${req.get(
      'host',
    )}/images/${image_token}`
    res.status(200).json({
      status: 'success',
      message: 'Upload dan kompresi berhasil!',
      data: { id, token: image_token, filename: newFilename, url: imageUrl },
    })
  } catch (error) {
    console.error('Gagal memproses gambar:', error)
    return res
      .status(500)
      .json({ status: 'error', message: 'Gagal memproses gambar.' })
  }
})

app.delete('/delete/:id', (req, res) => {
  const { id } = req.params
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf-8'))
  const entryToDelete = db.find((entry) => entry.id === id)
  if (!entryToDelete) {
    return res
      .status(404)
      .json({ status: 'error', message: 'ID tidak ditemukan.' })
  }
  const token = entryToDelete.token
  const files = fs.readdirSync(uploadDir)
  const fileToDelete = files.find((f) => path.parse(f).name === token)
  if (fileToDelete) fs.unlinkSync(path.join(uploadDir, fileToDelete))
  const newDb = db.filter((entry) => entry.id !== id)
  fs.writeFileSync(dbPath, JSON.stringify(newDb, null, 2), 'utf-8')
  res.status(200).json({
    status: 'success',
    message: `Data dan gambar untuk ID '${id}' telah dihapus.`,
  })
})

app.get('/images/:imageToken', (req, res) => {
  const { imageToken } = req.params
  fs.readdir(uploadDir, (err, files) => {
    if (err) return res.status(500).send('Gagal membaca folder gambar.')
    const fileName = files.find((f) => path.parse(f).name === imageToken)
    if (fileName) {
      res.sendFile(path.join(uploadDir, fileName))
    } else {
      res.status(404).send('Gambar tidak ditemukan.')
    }
  })
})

// ==========================================================
//         BAGIAN PEMANTAUAN PERANGKAT (DEVICE MONITORING)
// ==========================================================

// Variabel state untuk pemantauan
let deviceList = []
let lastMessageTimestamps = {}
let lastDeviceStatuses = {}
let subscribedTopics = new Set()

// Fungsi Helper untuk Monitoring
const sendLog = (message) => {
  const logRef = ref(database, `Log/${Date.now()}`)
  set(logRef, {
    timestamp: new Date().toISOString(),
    message: message,
  }).catch((err) => console.error('Gagal mengirim log:', err))
}

const updateDeviceStatusInFirebase = (topic, status) => {
  const previousStatus = lastDeviceStatuses[topic] || 'tidak diketahui'
  if (previousStatus !== status) {
    const timestamp = new Date().toISOString()
    const device = deviceList.find((d) => d.topic === topic)
    const deviceName = device ? device.name : topic

    console.log(
      `[STATUS CHANGE] ${timestamp} - Perangkat "${deviceName}" (${topic}) berubah dari '${previousStatus}' -> '${status}'`,
    )

    const statusRef = ref(database, `Device/${topic}/status`)
    set(statusRef, status).catch((err) =>
      console.error(`Gagal update status Firebase untuk ${topic}:`, err),
    )

    const logMessage = `Perangkat "${deviceName}" telah ${status}`
    sendLog(logMessage)

    lastDeviceStatuses[topic] = status
  }
}

const updateMqttSubscriptions = () => {
  const newTopics = new Set(deviceList.map((d) => `${d.topic}-status`))

  for (const oldTopic of subscribedTopics) {
    if (!newTopics.has(oldTopic)) {
      mqttClient.unsubscribe(oldTopic, (err) => {
        if (!err) console.log(`-- Unsubscribed dari ${oldTopic}`)
      })
    }
  }

  for (const newTopic of newTopics) {
    if (!subscribedTopics.has(newTopic)) {
      mqttClient.subscribe(newTopic, (err) => {
        if (!err) console.log(`++ Berhasil subscribe ke ${newTopic}`)
      })
    }
  }
  subscribedTopics = newTopics
}

// Logika Utama Monitoring
const startDeviceMonitoring = () => {
  mqttClient.on('connect', () => {
    console.log('✅ Terhubung ke MQTT Broker')
    const deviceRef = ref(database, 'Device')

    onValue(deviceRef, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        deviceList = Object.keys(data)
          .map((key) => ({ id: key, ...data[key] }))
          .filter((device) => device.topic && device.name)
      } else {
        deviceList = []
      }

      console.log(
        `\n🔄 Daftar perangkat yang valid diperbarui. Total: ${deviceList.length}`,
      )
      if (deviceList.length > 0) {
        console.log(
          deviceList
            .map((d) => `  - Nama: ${d.name}, Topik: ${d.topic}`)
            .join('\n'),
        )
      }
      updateMqttSubscriptions()
    })
  })

  mqttClient.on('error', (err) => {
    console.error('MQTT Error:', err)
  })

  mqttClient.on('message', (topic, payload) => {
    const deviceTopic = topic.replace('-status', '')
    lastMessageTimestamps[deviceTopic] = Date.now()
    updateDeviceStatusInFirebase(deviceTopic, 'online')
  })

  setInterval(() => {
    const now = Date.now()
    deviceList.forEach((device) => {
      if (!device.topic) return
      const lastTimestamp = lastMessageTimestamps[device.topic]
      if (!lastTimestamp || now - lastTimestamp > 7000) {
        updateDeviceStatusInFirebase(device.topic, 'offline')
      }
    })
  }, 2000)
}

// ==========================================================
//               JALANKAN SERVER
// ==========================================================
app.listen(PORT, () => {
  console.log(`🚀 Server API aktif di http://localhost:${PORT}`)
  console.log('🔥 Memulai layanan pemantauan perangkat...')
  startDeviceMonitoring()
})
