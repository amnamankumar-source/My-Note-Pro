const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Middleware: GB scale payloads
app.use(express.json({ limit: '2gb' }));
app.use(express.urlencoded({ limit: '2gb', extended: true }));
app.use(cors());

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("Error: MONGO_URI environment variable is not defined!");
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully!'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Note Schema (Updated with likes, views, pinCode)
const noteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  subject: { type: String, default: 'NEET' },
  isPrivate: { type: Boolean, default: true },
  createdAt: { type: String, default: () => new Date().toLocaleString() },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  pinCode: { type: String, default: '' } // 4-Digit Security PIN
});

const Note = mongoose.model('Note', noteSchema);

// API Routes

// GET: Fetch ALL Notes
app.get('/api/notes', async (req, res) => {
  try {
    const allNotes = await Note.find().sort({ _id: -1 });
    res.json(allNotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET: Fetch ONLY Public Notes
app.get('/api/notes/public', async (req, res) => {
  try {
    const publicNotes = await Note.find({ isPrivate: false }).sort({ _id: -1 });
    res.json(publicNotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

// PUT: Update Note (PIN Validation Check)
app.put('/api/notes/:id', async (req, res) => {
  try {
    const existingNote = await Note.findById(req.params.id);
    if (!existingNote) return res.status(404).json({ error: "Note not found" });

    // Verify PIN if note is PIN protected
    if (existingNote.pinCode && existingNote.pinCode !== req.body.enteredPin) {
      return res.status(403).json({ error: "Incorrect PIN! Authorization denied." });
    }

    const updatedNote = await Note.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedNote);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Increment Views
app.post('/api/notes/:id/view', async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true });
    res.json({ views: updatedNote.views });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Increment Likes
app.post('/api/notes/:id/like', async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(req.params.id, { $inc: { likes: 1 } }, { new: true });
    res.json({ likes: updatedNote.likes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Permanently Delete Note
app.delete('/api/notes/:id', async (req, res) => {
  try {
    await Note.findByIdAndDelete(req.params.id);
    res.json({ message: 'Note deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Server Start
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
