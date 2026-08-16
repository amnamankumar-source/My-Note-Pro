const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;

// 1. MongoDB Connection Setup
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/notes_db';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Middleware Setup
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Static Uploads Folder Setup
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });

// 2. Mongoose Database Schemas & Models
const profileSchema = new mongoose.Schema({
    name: { type: String, default: "Note Author" },
    img: { type: String, default: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" }
});
const Profile = mongoose.model('Profile', profileSchema);

const subjectSchema = new mongoose.Schema({
    name: String,
    img: String
});
const Subject = mongoose.model('Subject', subjectSchema);

const noteSchema = new mongoose.Schema({
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    subject: { type: String, default: 'General' },
    userId: { type: String, required: true }, // Note creator identifier
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    likedUsers: [{ type: String }],
    views: { type: Number, default: 0 }
}, { timestamps: true });

// Performance Optimization: Indexing for Super Fast Retrieval
noteSchema.index({ isPinned: -1, createdAt: -1 });
noteSchema.index({ subject: 1 });

const Note = mongoose.model('Note', noteSchema);

// API ROUTES

// 1. Profile APIs
app.get('/api/profile', async (req, res) => {
    try {
        let profile = await Profile.findOne().lean();
        if (!profile) {
            profile = await Profile.create({});
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const { name, img } = req.body;
        let profile = await Profile.findOneAndUpdate({}, { name, img }, { new: true, upsert: true });
        res.json({ message: "Profile updated successfully", profile });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Subjects APIs
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find().lean();
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/subjects', async (req, res) => {
    try {
        const { name, img } = req.body;
        const newSubject = await Subject.create({
            name: name || "Custom Logo",
            img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
        });
        res.status(201).json(newSubject);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/subjects/:id', async (req, res) => {
    try {
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: "Circle logo deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Super Fast 10 Notes API (Pagination & Search)
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 10, search = '', subject = '', userId = '' } = req.query;
        page = parseInt(page);
        limit = parseInt(limit);

        let query = {};

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } }
            ];
        }

        if (subject) {
            query.subject = { $regex: new RegExp(`^${subject}$`, 'i') };
        }

        // Fetching 10 notes super fast using .lean() and indexes
        const totalNotes = await Note.countDocuments(query);
        const notes = await Note.find(query)
            .sort({ isPinned: -1, createdAt: -1 }) // Pinned notes first, then latest
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        const formattedNotes = notes.map(n => ({
            ...n,
            likes: (n.likedUsers || []).length,
            userLiked: userId ? (n.likedUsers || []).includes(userId) : false
        }));

        res.json({
            notes: formattedNotes,
            hasMore: (page * limit) < totalNotes,
            totalNotes: totalNotes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create Note API
app.post('/api/notes', async (req, res) => {
    try {
        const { title, content, subject, isPrivate, isPinned, userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: "userId is required to create a note" });
        }

        const newNote = await Note.create({
            title: title || 'Untitled Note',
            content: content || '',
            subject: subject || 'General',
            userId: userId,
            isPrivate: !!isPrivate,
            isPinned: !!isPinned,
            likedUsers: [],
            views: 0
        });

        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Note API (Pinned Restrict Rule Added)
app.put('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, ...updateData } = req.body;

        const note = await Note.findById(id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        // Rules: Agar Note PINNED hai, to sirf original author hi EDIT kar sakta hai
        if (note.isPinned && note.userId !== userId) {
            return res.status(403).json({ error: "Yeh note pinned hai, ise sirf ise banane wala user hi edit kar sakta hai." });
        }

        const updatedNote = await Note.findByIdAndUpdate(id, updateData, { new: true }).lean();
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Like / Unlike API
app.post('/api/notes/:id/like', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;

        if (!userId) return res.status(400).json({ error: "userId required" });

        const note = await Note.findById(id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        const hasLiked = note.likedUsers.includes(userId);
        const updateQuery = hasLiked 
            ? { $pull: { likedUsers: userId } } 
            : { $addToSet: { likedUsers: userId } };

        const updatedNote = await Note.findByIdAndUpdate(id, updateQuery, { new: true });

        res.json({
            likes: updatedNote.likedUsers.length,
            userLiked: !hasLiked
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Note API (Pinned Restrict Rule Added)
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body; // Pass userId in body or headers

        const note = await Note.findById(id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        // Rules: Agar Note PINNED hai, to sirf original creator hi DELETE kar sakta hai
        if (note.isPinned && note.userId !== userId) {
            return res.status(403).json({ error: "Yeh note pinned hai, ise sirf ise banane wala user hi delete kar sakta hai." });
        }

        await Note.findByIdAndDelete(id);
        res.json({ message: "Note deleted successfully", id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// File Upload Route
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, fileType: req.file.mimetype });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
