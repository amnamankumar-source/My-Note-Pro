require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/notes_db';

// MongoDB Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// ===== CLOUDINARY CONFIGURATION =====
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

// Configure Multer Storage for Cloudinary
const cloudinaryStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        let resource_type = 'auto'; // Auto-detects image, video

        // Cloudinary processes PDFs and office documents as 'raw'
        if (
            file.mimetype === 'application/pdf' || 
            file.mimetype.includes('document') || 
            file.mimetype.includes('msword') || 
            file.mimetype.includes('zip')
        ) {
            resource_type = 'raw';
        }

        const cleanFileName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9]/g, "_");

        return {
            folder: 'my_note_pro_uploads',
            resource_type: resource_type,
            public_id: `${Date.now()}_${cleanFileName}`
        };
    }
});

const upload = multer({ 
    storage: cloudinaryStorage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB Max
});

// ===== MONGOOSE SCHEMAS & MODELS =====
const profileSchema = new mongoose.Schema({
    name: { type: String, default: "Note Author" },
    img: { type: String, default: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" }
});
const Profile = mongoose.model('Profile', profileSchema);

const subjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }
});
const Subject = mongoose.model('Subject', subjectSchema);

const noteSchema = new mongoose.Schema({
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    subject: { type: String, default: 'General' },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: String }],
    views: { type: Number, default: 0 },
    viewedBy: [{ type: String }],
    deletedFor: [{ type: String }],
    createdAtFormatted: { type: String }
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(__dirname));

// ===== API ROUTES =====

// 1. Profile APIs
app.get('/api/profile', async (req, res) => {
    try {
        let profile = await Profile.findOne();
        if (!profile) {
            profile = await Profile.create({ name: "Note Author" });
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
        const subjects = await Subject.find().sort({ _id: -1 });
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/subjects', async (req, res) => {
    try {
        const { name, img } = req.body;
        const newSubject = new Subject({
            name: name || "Custom Subject",
            img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
        });
        await newSubject.save();
        res.status(201).json(newSubject);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/subjects/:id', async (req, res) => {
    try {
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: "Subject deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Notes APIs
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 10, search = '', subject = '', date = '', deviceId = '' } = req.query;
        page = Math.max(1, parseInt(page));
        limit = Math.max(1, parseInt(limit));

        let query = {};

        if (deviceId) {
            query.deletedFor = { $ne: deviceId };
        }

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } }
            ];
        }

        if (subject) {
            query.subject = { $regex: `^${subject}$`, $options: 'i' };
        }

        if (date) {
            query.createdAtFormatted = { $regex: date, $options: 'i' };
        }

        const skip = (page - 1) * limit;

        const [notes, totalNotes] = await Promise.all([
            Note.find(query)
                .sort({ isPinned: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Note.countDocuments(query)
        ]);

        const formattedNotes = notes.map(note => {
            const isLiked = deviceId && Array.isArray(note.likedBy) ? note.likedBy.includes(deviceId) : false;
            return {
                ...note,
                userLiked: isLiked
            };
        });

        res.json({
            notes: formattedNotes,
            hasMore: skip + formattedNotes.length < totalNotes,
            totalNotes,
            currentPage: page
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Like Route
app.put('/api/notes/:id/like', async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID required' });
        }

        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        const alreadyLiked = note.likedBy.includes(deviceId);

        if (alreadyLiked) {
            note.likedBy = note.likedBy.filter(id => id !== deviceId);
            note.likes = Math.max(0, note.likes - 1);
        } else {
            note.likedBy.push(deviceId);
            note.likes += 1;
        }

        await note.save();

        res.json({
            likes: note.likes,
            userLiked: !alreadyLiked
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Record View Count
app.put('/api/notes/:id/view', async (req, res) => {
    try {
        const { deviceId } = req.body;

        const updateData = { $inc: { views: 1 } };
        if (deviceId) {
            updateData.$addToSet = { viewedBy: deviceId };
        }

        const note = await Note.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        );

        if (!note) return res.status(404).json({ error: "Note not found" });

        res.json({ views: note.views });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create Note
app.post('/api/notes', async (req, res) => {
    try {
        const { title, content, subject, isPrivate, isPinned, createdAt } = req.body;
        const newNote = new Note({
            title: title || 'Untitled Note',
            content: content || '',
            subject: subject || 'General',
            isPrivate: isPrivate || false,
            isPinned: isPinned || false,
            createdAtFormatted: createdAt || new Date().toLocaleString()
        });
        await newNote.save();
        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Note
app.put('/api/notes/:id', async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        if (note.isPinned) {
            return res.status(403).json({ error: "Pinned notes are locked and cannot be edited." });
        }

        const updatedNote = await Note.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Note
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { deviceId } = req.query;
        if (!deviceId) {
            return res.status(400).json({ error: "Device ID required for deletion" });
        }

        const note = await Note.findById(req.params.id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        if (!note.deletedFor.includes(deviceId)) {
            note.deletedFor.push(deviceId);
            await note.save();
        }

        res.json({ message: "Note deleted for current user", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. File Upload (Multiple Files to Cloudinary: Images, Videos, PDFs)
app.post('/api/upload', (req, res) => {
    upload.array('media', 10)(req, res, (err) => {
        if (err) {
            console.error("Cloudinary Upload Error:", err);
            return res.status(500).json({ error: err.message || 'Upload failed' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const uploadedFiles = req.files.map(file => ({
            url: file.path, // Cloudinary Secure URL
            fileType: file.mimetype,
            filename: file.originalname,
            publicId: file.filename
        }));

        res.json({ 
            message: 'Files uploaded to Cloudinary successfully',
            files: uploadedFiles,
            url: uploadedFiles[0].url,
            fileType: uploadedFiles[0].fileType,
            filename: uploadedFiles[0].filename
        });
    });
});

// Catch-all route to serve Frontend index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
