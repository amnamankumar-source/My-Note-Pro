const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware Setup
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// -------------------------------------------------------------
// 1. MONGODB CONNECTION
// -------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/notes_app';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB successfully!'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// -------------------------------------------------------------
// 2. MONGOOSE SCHEMAS & MODELS
// -------------------------------------------------------------
const ProfileSchema = new mongoose.Schema({
    name: { type: String, default: "Note Author" },
    img: { type: String, default: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" }
});

const SubjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, default: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80" }
});

const NoteSchema = new mongoose.Schema({
    title: { type: String, default: "Untitled Note" },
    content: { type: String, default: "" },
    subject: { type: String, default: "General" },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    userId: { type: String, default: "anonymous" },
    mediaUrl: { type: String, default: "" },
    mediaType: { type: String, default: "" },
    likedUsers: { type: [String], default: [] },
    views: { type: Number, default: 0 },
    createdAt: { type: String, default: () => new Date().toLocaleString() }
}, { timestamps: true });

const Profile = mongoose.model('Profile', ProfileSchema);
const Subject = mongoose.model('Subject', SubjectSchema);
const Note = mongoose.model('Note', NoteSchema);

// -------------------------------------------------------------
// 3. FILE UPLOAD CONFIGURATION (MULTER)
// -------------------------------------------------------------
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Static serve for uploaded files
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage, 
    limits: { fileSize: 100 * 1024 * 1024 } // 100 MB Limit
});

// -------------------------------------------------------------
// 4. API ROUTES
// -------------------------------------------------------------

// --- PROFILE APIs ---
app.get('/api/profile', async (req, res) => {
    try {
        let profile = await Profile.findOne();
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
        let profile = await Profile.findOne();
        if (!profile) {
            profile = new Profile({ name, img });
        } else {
            if (name) profile.name = name;
            if (img) profile.img = img;
        }
        await profile.save();
        res.json({ message: "Profile updated successfully", profile });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SUBJECTS APIs ---
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
        const newSubject = await Subject.create({
            name: name || "Custom Logo",
            img: img || undefined
        });
        res.status(201).json(newSubject);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/subjects/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid Subject ID format" });
        }
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: "Subject deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- NOTES APIs ---

// 🔥 FETCH NOTES WITH PAGINATION (10 per page) & TOPIC/SEARCH FILTER
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 10, search = '', subject = '', date = '', userId = '' } = req.query;
        page = parseInt(page);
        limit = parseInt(limit);

        let conditions = [];

        // Privacy Check
        if (userId) {
            conditions.push({
                $or: [
                    { isPrivate: false },
                    { isPrivate: true, userId: userId }
                ]
            });
        } else {
            conditions.push({ isPrivate: false });
        }

        // 🔥 Search across Title, Content, and Subject (Topic)
        if (search) {
            conditions.push({
                $or: [
                    { title: { $regex: search, $options: 'i' } },
                    { content: { $regex: search, $options: 'i' } },
                    { subject: { $regex: search, $options: 'i' } }
                ]
            });
        }

        if (subject) {
            conditions.push({ subject: { $regex: new RegExp(`^${subject}$`, 'i') } });
        }

        if (date) {
            conditions.push({ createdAt: { $regex: date, $options: 'i' } });
        }

        const query = conditions.length > 0 ? { $and: conditions } : {};

        // 🎯 Infinite Scroll Pagination Logic (10 notes at a time)
        const skip = (page - 1) * limit;
        const totalNotes = await Note.countDocuments(query);

        const notes = await Note.find(query)
            .sort({ isPinned: -1, _id: -1 })
            .skip(skip)
            .limit(limit);

        const formattedNotes = notes.map(n => {
            const noteObj = n.toObject();
            const userLiked = userId ? (noteObj.likedUsers || []).includes(userId) : false;
            return {
                ...noteObj,
                likes: (noteObj.likedUsers || []).length,
                userLiked: userLiked
            };
        });

        res.json({
            notes: formattedNotes,
            page: page,
            limit: limit,
            hasMore: (skip + notes.length) < totalNotes,
            totalNotes: totalNotes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 🔥 FIXED NOTE SAVE ROUTE
app.post('/api/notes', async (req, res) => {
    try {
        const { id, _id, title, content, subject, isPrivate, isPinned, userId, mediaUrl, mediaType, createdAt } = req.body;
        const noteId = id || _id;

        // Agar Valid ObjectId hai toh Update karega
        if (noteId && mongoose.Types.ObjectId.isValid(noteId)) {
            const updatedNote = await Note.findByIdAndUpdate(
                noteId,
                { 
                    $set: { 
                        title: title || 'Untitled Note', 
                        content: content || '', 
                        subject: subject || 'General', 
                        isPrivate: !!isPrivate, 
                        isPinned: !!isPinned, 
                        userId: userId || 'anonymous', 
                        mediaUrl: mediaUrl || '', 
                        mediaType: mediaType || '' 
                    } 
                },
                { new: true }
            );
            if (updatedNote) {
                return res.json(updatedNote);
            }
        }

        // 🔥 Naya Note Create karne ke liye cleanly create call karega
        const newNote = await Note.create({
            title: title || 'Untitled Note',
            content: content || '',
            subject: subject || 'General',
            isPrivate: !!isPrivate,
            isPinned: !!isPinned,
            userId: userId || 'anonymous',
            mediaUrl: mediaUrl || '',
            mediaType: mediaType || '',
            createdAt: createdAt || new Date().toLocaleString()
        });

        res.status(201).json(newNote);
    } catch (err) {
        console.error("Save Note Error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: "Invalid Note ID format" });
        }
        const updatedNote = await Note.findByIdAndUpdate(
            req.params.id, 
            { $set: req.body }, 
            { new: true }
        );
        if (!updatedNote) return res.status(404).json({ error: "Note not found" });
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes/:id/like', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "userId is required" });
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid Note ID" });
        }

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

        res.json({
            likes: note.likedUsers.length,
            userLiked: userLiked
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: "Invalid MongoDB ObjectId" });
        }

        const deletedNote = await Note.findByIdAndDelete(id);

        if (!deletedNote) {
            return res.status(404).json({ error: "Note MongoDB me nahi mila" });
        }

        if (deletedNote.mediaUrl) {
            const fileName = path.basename(deletedNote.mediaUrl);
            const fullPath = path.join(uploadsDir, fileName);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
        }

        if (deletedNote.content) {
            const fileMatches = deletedNote.content.match(/\/uploads\/[a-zA-Z0-9.-]+/g);
            if (fileMatches) {
                fileMatches.forEach(filePath => {
                    const fileName = path.basename(filePath);
                    const fullPath = path.join(uploadsDir, fileName);
                    if (fs.existsSync(fullPath)) {
                        fs.unlinkSync(fullPath);
                    }
                });
            }
        }

        res.json({ 
            success: true, 
            message: "Note permanently deleted", 
            id: id 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// FILE UPLOAD ROUTE
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const mime = req.file.mimetype;
    let type = 'file';

    if (mime.startsWith('image/')) type = 'image';
    else if (mime.startsWith('video/')) type = 'video';
    else if (mime === 'application/pdf') type = 'pdf';

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    res.json({ 
        url: fileUrl, 
        fileType: mime,
        mediaType: type,
        mimeType: mime,
        originalName: req.file.originalname 
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
