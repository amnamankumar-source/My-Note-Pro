const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// Middlewares (Increased payload limits for Base64 image/media upload)
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve Static Frontend HTML
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mynotepro';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Database Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// ================= SCHEMAS & MODELS =================

// Note Schema
const noteSchema = new mongoose.Schema({
  title: { type: String, default: 'Untitled Note' },
  content: { type: String, default: '' },
  subject: { type: String, default: 'General' },
  isPrivate: { type: Boolean, default: false },
  isPinned: { type: Boolean, default: false },
  views: { type: Number, default: 0 },
  likes: { type: Number, default: 0 },
  createdAtFormatted: { type: String }
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// Subject / Circle Schema
const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  img: { type: String, required: true }
}, { timestamps: true });

const Subject = mongoose.model('Subject', subjectSchema);

// ================= REST API ENDPOINTS =================

// 1. Fetch Notes with Pagination (Infinite Scroll API)
app.get('/api/notes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const skip = (page - 1) * limit;
    const subject = req.query.subject || '';
    const search = req.query.search || '';
    const date = req.query.date || '';

    let filter = {};

    if (subject) {
      filter.subject = { $regex: new RegExp(`^${subject}$`, 'i') };
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }

    if (date) {
      filter.createdAtFormatted = { $regex: date, $options: 'i' };
    }

    // Sort by pinned notes first, then latest created
    const totalNotes = await Note.countDocuments(filter);
    const notes = await Note.find(filter)
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      notes,
      currentPage: page,
      totalPages: Math.ceil(totalNotes / limit),
      hasMore: skip + notes.length < totalNotes
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// 2. Create New Note
app.post('/api/notes', async (req, res) => {
  try {
    const { title, content, subject, isPrivate, isPinned, createdAtFormatted } = req.body;
    const newNote = new Note({
      title,
      content,
      subject: subject || 'General',
      isPrivate: isPrivate || false,
      isPinned: isPinned || false,
      createdAtFormatted: createdAtFormatted || new Date().toLocaleString()
    });
    await newNote.save();
    res.status(201).json(newNote);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// 3. Update Note (Edit / Pin / View Count)
app.put('/api/notes/:id', async (req, res) => {
  try {
    const updatedNote = await Note.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedNote);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// 4. Global Like API (Increments/Decrements globally for all users)
app.post('/api/notes/:id/like', async (req, res) => {
  try {
    const { action } = req.body; // 'like' or 'unlike'
    const increment = action === 'like' ? 1 : -1;
    
    const note = await Note.findByIdAndUpdate(
      req.params.id,
      { $inc: { likes: increment } },
      { new: true }
    );
    
    // Prevent negative likes
    if (note.likes < 0) {
      note.likes = 0;
      await note.save();
    }
    
    res.json({ likes: note.likes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update like status' });
  }
});

// 5. Delete Note
app.delete('/api/notes/:id', async (req, res) => {
  try {
    await Note.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Note deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// 6. Fetch Custom Circle Logos
app.get('/api/subjects', async (req, res) => {
  try {
    const subjects = await Subject.find().sort({ createdAt: -1 });
    res.json(subjects);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// 7. Add Custom Circle Logo
app.post('/api/subjects', async (req, res) => {
  try {
    const { name, img } = req.body;
    const newSubject = new Subject({ name, img });
    await newSubject.save();
    res.status(201).json(newSubject);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add subject' });
  }
});

// Fallback Route to serve Frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
