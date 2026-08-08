const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;

// MongoDB Connection String (Replace with your Mongo URI or ENV variable)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mynotepro';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected Successfully'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// MongoDB Schemas & Models
const NoteSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, default: '' },
    subject: { type: String, default: 'General' },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    creatorUserId: { type: String, required: true }, // Created by specific User
    likedUsers: [{ type: String }],
    views: { type: Number, default: 0 },
    createdAt: { type: String, default: () => new Date().toLocaleString() }
}, { timestamps: true });

const ProfileSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: { type: String, default: 'Note Author' },
    img: { type: String, default: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }
});

const SubjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }
});

const Note = mongoose.model('Note', NoteSchema);
const Profile = mongoose.model('Profile', ProfileSchema);
const Subject = mongoose.model('Subject', SubjectSchema);

// Middleware Setup
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Ensure Static Uploads Folder Exists
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

// API ROUTES

// 1. Profile APIs
app.get('/api/profile', async (req, res) => {
    try {
        const { userId } = req.query;
        let profile = await Profile.findOne({ userId });
        if (!profile) {
            profile = await Profile.create({ userId, name: "Note Author", img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" });
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: 'Server Error' });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const { userId, name, img } = req.body;
        let profile = await Profile.findOneAndUpdate(
            { userId },
            { $set: { name, img } },
            { new: true, upsert: true }
        );
        res.json({ message: "Profile updated successfully", profile });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// 2. Subjects APIs
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find().sort({ _id: -1 });
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch subjects' });
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
        res.status(500).json({ error: 'Failed to create subject' });
    }
});

// 3. Notes APIs (Public All Users + Private Only Owner)
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 9, search = '', subject = '', date = '', userId = '' } = req.query;
        page = parseInt(page);
        limit = parseInt(limit);

        // Core Query: Show all Public notes OR Private notes owned by current User
        let query = {
            $or: [
                { isPrivate: false },
                { isPrivate: true, creatorUserId: userId }
            ]
        };

        if (search) {
            const regex = new RegExp(search, 'i');
            query.$and = [
                { $or: query.$or },
                { $or: [{ title: regex }, { content: regex }] }
            ];
            delete query.$or;
        }

        if (subject) {
            query.subject = { $regex: new RegExp(`^${subject}$`, 'i') };
        }

        if (date) {
            query.createdAt = { $regex: new RegExp(date, 'i') };
        }

        const totalNotes = await Note.countDocuments(query);
        const notes = await Note.find(query)
            .sort({ isPinned: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const formattedNotes = notes.map(n => ({
            _id: n._id,
            title: n.title,
            content: n.content,
            subject: n.subject,
            isPrivate: n.isPrivate,
            isPinned: n.isPinned,
            creatorUserId: n.creatorUserId,
            views: n.views,
            createdAt: n.createdAt,
            likes: n.likedUsers.length,
            userLiked: userId ? n.likedUsers.includes(userId) : false,
            isOwner: n.creatorUserId === userId
        }));

        res.json({
            notes: formattedNotes,
            hasMore: (page * limit) < totalNotes,
            totalNotes
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch notes' });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const { title, content, subject, isPrivate, isPinned, createdAt, userId } = req.body;
        const newNote = await Note.create({
            title: title || 'Untitled Note',
            content: content || '',
            subject: subject || 'General',
            isPrivate: !!isPrivate,
            isPinned: !!isPinned,
            creatorUserId: userId,
            likedUsers: [],
            views: 0,
            createdAt: createdAt || new Date().toLocaleString()
        });
        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ error: 'Failed to save note' });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updatedNote = await Note.findByIdAndUpdate(id, req.body, { new: true });
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update note' });
    }
});

// Unique Like System
app.post('/api/notes/:id/like', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;

        const note = await Note.findById(id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        const userIndex = note.likedUsers.indexOf(userId);
        let userLiked = false;

        if (userIndex === -1) {
            note.likedUsers.push(userId);
            userLiked = true;
        } else {
            note.likedUsers.splice(userIndex, 1);
            userLiked = false;
        }

        await note.save();
        res.json({ likes: note.likedUsers.length, userLiked });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update like' });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Note.findByIdAndDelete(id);
        res.json({ message: "Note deleted successfully", id });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete note' });
    }
});

// Upload File Endpoint
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, fileType: req.file.mimetype });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
