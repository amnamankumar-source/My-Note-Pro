const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

const app = express();

// 1. Hardcoded Secrets हटाकर केवल Environment Variables का उपयोग करें
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// 2. CORS को केवल अपनी डोमेन तक सीमित करें
const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:3000'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy: Access Denied'));
    }
  }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("Error: MONGO_URI environment variable is not defined!");
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Schema Definition
const noteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  subject: { type: String, default: 'NEET' },
  isPrivate: { type: Boolean, default: true },
  createdAt: { type: String, default: () => new Date().toLocaleString() },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  pinCode: { type: String, default: '' }
});

const Note = mongoose.model('Note', noteSchema);

// --- CLOUDINARY SIGNATURE API ---
app.get('/api/cloudinary-signature', (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      { timestamp: timestamp, upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET || 'ml_default' },
      process.env.CLOUDINARY_API_SECRET
    );
    res.json({
      timestamp,
      signature,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY
    });
  } catch (err) {
    res.status(500).json({ error: 'Signature generation failed' });
  }
});

// GET: Fetch ONLY Public Notes (Private Notes छिपाने के लिए)
app.get('/api/notes/public', async (req, res) => {
  try {
    const publicNotes = await Note.find({ isPrivate: false }).sort({ _id: -1 });
    res.json(publicNotes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// POST: Create New Note
app.post('/api/notes', async (req, res) => {
  try {
    const { title, content, subject, isPrivate, createdAt, pinCode } = req.body;
    const newNote = new Note({ title, content, subject, isPrivate, createdAt, pinCode: pinCode || '' });
    await newNote.save();
    res.status(201).json(newNote);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// PUT: Update Note (PIN Protection Verified)
app.put('/api/notes/:id', async (req, res) => {
  try {
    const existingNote = await Note.findById(req.params.id);
    if (!existingNote) return res.status(404).json({ error: "Note not found" });

    if (existingNote.pinCode && existingNote.pinCode !== req.body.enteredPin) {
      return res.status(403).json({ error: "Incorrect PIN! Authorization denied." });
    }

    const updatedNote = await Note.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedNote);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// DELETE: Protected Delete (PIN Check required if PIN exists)
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const existingNote = await Note.findById(req.params.id);
    if (!existingNote) return res.status(404).json({ error: "Note not found" });

    if (existingNote.pinCode && existingNote.pinCode !== req.headers['x-pin-code']) {
      return res.status(403).json({ error: "Incorrect PIN! Authorization denied." });
    }

    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: 'Note deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// POST: Increment Views
app.post('/api/notes/:id/view', async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
    res.json({ views: updatedNote ? updatedNote.views : 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to increment views' });
  }
});

// POST: Increment Likes
app.post('/api/notes/:id/like', async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(req.params.id, { $inc: { likes: 1 } }, { new: true });
    res.json({ likes: updatedNote ? updatedNote.likes : 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to increment likes' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running securely on port ${PORT}`));
