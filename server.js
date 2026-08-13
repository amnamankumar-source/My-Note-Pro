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
// Apne MongoDB Atlas Connection String se replace karein agar online database use kar rahe hain
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
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

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
        await Subject.findByIdAndDelete(req.params.id);
        res.json({ message: "Subject deleted successfully from MongoDB", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- NOTES APIs (PAGINATION + MONGODB REAL-TIME SEARCH) ---
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 9, search = '', subject = '', date = '', userId = '' } = req.query;
        page = parseInt(page);
        limit = parseInt(limit);

        // MongoDB Search Query Filter
        let query = {};

        // 1. Direct Search in MongoDB (Title ya Content dono me search karega)
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { content: { $regex: search, $options: 'i' } }
            ];
        }

        // 2. Subject Filter
        if (subject) {
            query.subject = { $regex: new RegExp(`^${subject}$`, 'i') };
        }

        // 3. Date Filter
        if (date) {
            query.createdAt = { $regex: date, $options: 'i' };
        }

        // Database Level Pagination (Skip & Limit for Fast Mobile Experience)
        const skip = (page - 1) * limit;
        const totalNotes = await Note.countDocuments(query);
        
        // Mongo query: Har call par sirf utna hi batch fetch hoga (e.g. 9 notes at a time)
        const notes = await Note.find(query)
            .sort({ isPinned: -1, _id: -1 }) // Pehle Pinned notes, fir Naye notes
            .skip(skip)
            .limit(limit);

        // Likes & User Liked Check format
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
            hasMore: (skip + notes.length) < totalNotes, // Frontend ko bataega ki aur notes bache hain ya nahi
            totalNotes: totalNotes
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const { title, content, subject, isPrivate, isPinned, createdAt } = req.body;
        const newNote = await Note.create({
            title: title || 'Untitled Note',
            content: content || '',
            subject: subject || 'General',
            isPrivate: !!isPrivate,
            isPinned: !!isPinned,
            createdAt: createdAt || undefined
        });
        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
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

// Like / Unlike Endpoint
app.post('/api/notes/:id/like', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: "userId is required" });

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

// DELETE Note from MongoDB
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const deletedNote = await Note.findByIdAndDelete(req.params.id);
        if (!deletedNote) {
            return res.status(404).json({ error: "Note MongoDB me nahi mila" });
        }
        res.json({ message: "Note permanently deleted from MongoDB", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// File Upload Endpoint
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, fileType: req.file.mimetype });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
