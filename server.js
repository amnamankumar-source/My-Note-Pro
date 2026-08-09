const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Security & Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 1. Uploads Folder Check
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// 2. Secure MongoDB Connection Setup
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('CRITICAL ERROR: MONGO_URI environment variable is missing!');
    process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Atlas Connected Successfully!'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// Helper: Escape Special Regex Characters
function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

// 3. Mongoose Schemas & Models
const profileSchema = new mongoose.Schema({
    userId: { type: String, default: 'default_user' },
    name: { type: String, default: "Note Author" },
    img: { type: String, default: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" }
});

const subjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }
});

const noteSchema = new mongoose.Schema({
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    subject: { type: String, default: 'General' },
    isPrivate: { type: Boolean, default: true },
    isPinned: { type: Boolean, default: false },
    likedUsers: { type: [String], default: [] },
    views: { type: Number, default: 0 },
    createdAt: { type: String, default: () => new Date().toLocaleString() }
});

const Profile = mongoose.model('Profile', profileSchema);
const Subject = mongoose.model('Subject', subjectSchema);
const Note = mongoose.model('Note', noteSchema);

// 4. Secured Multer Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname).toLowerCase());
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB Limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf|webp|mp4|webm|quicktime/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
            return cb(null, true);
        }
        cb(new Error("Unsupported file format!"));
    }
});

// API ROUTES

// Profile APIs
app.get('/api/profile', async (req, res) => {
    try {
        let profile = await Profile.findOne({ userId: 'default_user' });
        if (!profile) {
            profile = await Profile.create({});
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const { name, img } = req.body;
        let profile = await Profile.findOne({ userId: 'default_user' });
        if (!profile) profile = new Profile({ userId: 'default_user' });
        
        if (name !== undefined) profile.name = name;
        if (img !== undefined) profile.img = img;
        await profile.save();

        res.json({ message: "Profile updated successfully", profile });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Subjects APIs
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find().sort({ _id: -1 });
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post('/api/subjects', async (req, res) => {
    try {
        const { name, img } = req.body;
        const newSubject = new Subject({
            name: name || "Custom Logo",
            img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
        });
        await newSubject.save();
        res.status(201).json(newSubject);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.delete('/api/subjects/:id', async (req, res) => {
    try {
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: "Circle logo deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Notes APIs
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 9, search = '', subject = '', date = '', userId = '' } = req.query;
        page = Math.max(1, parseInt(page) || 1);
        limit = Math.max(1, parseInt(limit) || 9);

        let query = {};

        if (search) {
            const cleanSearch = escapeRegex(search);
            query.$or = [
                { title: { $regex: cleanSearch, $options: 'i' } },
                { content: { $regex: cleanSearch, $options: 'i' } }
            ];
        }

        if (subject) {
            const cleanSubject = escapeRegex(subject);
            query.subject = { $regex: `^${cleanSubject}$`, $options: 'i' };
        }

        if (date) {
            const cleanDate = escapeRegex(date);
            query.createdAt = { $regex: cleanDate, $options: 'i' };
        }

        const totalNotes = await Note.countDocuments(query);
        const notes = await Note.find(query)
            .sort({ isPinned: -1, _id: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const formattedNotes = notes.map(n => {
            const userLiked = userId ? (n.likedUsers || []).includes(userId) : false;
            return {
                ...n.toObject(),
                likes: (n.likedUsers || []).length,
                userLiked: userLiked
            };
        });

        res.json({
            notes: formattedNotes,
            hasMore: (page * limit) < totalNotes,
            totalNotes: totalNotes
        });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const { title, content, subject, isPrivate, isPinned, createdAt } = req.body;
        const newNote = new Note({
            title: title || 'Untitled Note',
            content: content || '',
            subject: subject || 'General',
            isPrivate: typeof isPrivate === 'boolean' ? isPrivate : true,
            isPinned: typeof isPinned === 'boolean' ? isPinned : false,
            createdAt: createdAt || new Date().toLocaleString()
        });
        await newNote.save();
        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Partial Safe Update Note API
app.put('/api/notes/:id', async (req, res) => {
    try {
        const updateFields = {};
        const { title, content, subject, isPrivate, isPinned } = req.body;

        if (title !== undefined) updateFields.title = title;
        if (content !== undefined) updateFields.content = content;
        if (subject !== undefined) updateFields.subject = subject;
        if (isPrivate !== undefined) updateFields.isPrivate = isPrivate;
        if (isPinned !== undefined) updateFields.isPinned = isPinned;
        
        const updatedNote = await Note.findByIdAndUpdate(
            req.params.id, 
            { $set: updateFields }, 
            { new: true, runValidators: true }
        );

        if (!updatedNote) return res.status(404).json({ error: "Note not found" });
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// View Count Increment Route
app.post('/api/notes/:id/view', async (req, res) => {
    try {
        const note = await Note.findByIdAndUpdate(
            req.params.id,
            { $inc: { views: 1 } },
            { new: true }
        );
        if (!note) return res.status(404).json({ error: "Note not found" });
        res.json({ views: note.views });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Like API
app.post('/api/notes/:id/like', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "userId is required" });

        const note = await Note.findById(req.params.id);
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

        res.json({
            likes: note.likedUsers.length,
            userLiked: userLiked
        });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        const deletedNote = await Note.findByIdAndDelete(req.params.id);
        if (!deletedNote) return res.status(404).json({ error: "Note not found" });
        res.json({ message: "Note deleted successfully from server", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// File Upload Endpoint with Safe Error Catching
app.post('/api/upload', (req, res) => {
    upload.single('media')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: `Multer Error: ${err.message}` });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded or file rejected' });
        }
        const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        res.json({ url: fileUrl, fileType: req.file.mimetype });
    });
});

// Safe Catch-All Route for Single Page Apps
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({ error: "Frontend entry (index.html) not found on server." });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
