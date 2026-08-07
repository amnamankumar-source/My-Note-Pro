const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://your_mongo_connection_string_here';

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// --- Schemas ---

// 1. Note Schema
const NoteSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    subject: { type: String, default: 'General' },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    likedBy: { type: [String], default: [] }, // Stores IP/Session/User identifier who liked
    createdAt: { type: String, required: true }
}, { timestamps: true });

const Note = mongoose.model('Note', NoteSchema);

// 2. Custom Category Circle Schema
const SubjectSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    img: { type: String, required: true }
});

const Subject = mongoose.model('Subject', SubjectSchema);


// --- API Endpoints ---

// 1. Get Notes with Pagination & Infinite Scroll Support
app.get('/api/notes', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const subject = req.query.subject;

        let query = { isPrivate: false };
        if (subject) {
            query.subject = subject;
        }

        const totalNotes = await Note.countDocuments(query);
        const notes = await Note.find(query)
            .sort({ isPinned: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit);

        res.json({
            notes,
            currentPage: page,
            totalPages: Math.ceil(totalNotes / limit),
            hasMore: skip + notes.length < totalNotes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Create Note
app.post('/api/notes', async (req, res) => {
    try {
        const newNote = new Note(req.body);
        const savedNote = await newNote.save();
        res.status(201).json(savedNote);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// 3. Update Note (Views, Likes, Content)
app.put('/api/notes/:id', async (req, res) => {
    try {
        const { views, incrementLike, userId } = req.body;
        const note = await Note.findById(req.params.id);
        
        if (!note) return res.status(404).json({ error: 'Note not found' });

        if (views !== undefined) {
            note.views += 1;
        }

        if (incrementLike !== undefined && userId) {
            const hasLiked = note.likedBy.includes(userId);
            if (incrementLike && !hasLiked) {
                note.likedBy.push(userId);
                note.likes += 1;
            } else if (!incrementLike && hasLiked) {
                note.likedBy = note.likedBy.filter(id => id !== userId);
                note.likes = Math.max(0, note.likes - 1);
            }
        }

        // Standard field updates if provided
        if (req.body.title) note.title = req.body.title;
        if (req.body.content) note.content = req.body.content;
        if (req.body.subject) note.subject = req.body.subject;
        if (req.body.isPinned !== undefined) note.isPinned = req.body.isPinned;

        const updatedNote = await note.save();
        res.json(updatedNote);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// 4. Delete Note
app.delete('/api/notes/:id', async (req, res) => {
    try {
        await Note.findByIdAndDelete(req.params.id);
        res.json({ message: 'Note deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Category Circle Endpoints ---

// Get all custom category circles
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find();
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add custom category circle
app.post('/api/subjects', async (req, res) => {
    try {
        const { name, img } = req.body;
        const newSub = new Subject({ name, img });
        const saved = await newSub.save();
        res.status(201).json(saved);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// Delete custom category circle
app.delete('/api/subjects/:id', async (req, res) => {
    try {
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: 'Subject circle deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
