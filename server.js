const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/mynotepro';

// MongoDB Connection Setup
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// Database Schemas & Models
const NoteSchema = new mongoose.Schema({
    title: { type: String, required: true, default: 'Untitled Note' },
    content: { type: String, default: '' },
    subject: { type: String, default: 'General' },
    createdBy: { type: String, required: true }, // Creator UserId
    isPrivate: { type: Boolean, default: true }, // true = Private (Only creator), false = Published (Everyone)
    isPinned: { type: Boolean, default: false },
    likedUsers: { type: [String], default: [] },
    views: { type: Number, default: 0 },
    createdAt: { type: String, required: true }
}, { timestamps: true });

// Text Search Indexes for Fast Search
NoteSchema.index({ title: 'text', content: 'text', subject: 'text' });

const SubjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    img: { type: String, required: true }
});

const ProfileSchema = new mongoose.Schema({
    userId: { type: String, unique: true },
    name: { type: String, default: "Note Author" },
    img: { type: String, default: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" }
});

const Note = mongoose.model('Note', NoteSchema);
const Subject = mongoose.model('Subject', SubjectSchema);
const Profile = mongoose.model('Profile', ProfileSchema);

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Static Uploads Folder
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(__dirname));

// Multer Config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

// Seed Default Subjects if empty
async function seedDefaultSubjects() {
    const count = await Subject.countDocuments();
    if (count === 0) {
        await Subject.insertMany([
            { name: "Science", img: "https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&w=120&120&q=80" },
            { name: "Maths", img: "https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=120&120&q=80" }
        ]);
    }
}
seedDefaultSubjects();

/* ================= API ROUTES ================= */

// 1. Profile APIs
app.get('/api/profile', async (req, res) => {
    try {
        const userId = req.query.userId || 'default_user';
        let profile = await Profile.findOne({ userId });
        if (!profile) {
            profile = await Profile.create({ userId, name: "Note Author" });
        }
        res.json(profile);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

app.put('/api/profile', async (req, res) => {
    try {
        const { userId, name, img } = req.body;
        const updateData = {};
        if (name) updateData.name = name;
        if (img) updateData.img = img;

        const profile = await Profile.findOneAndUpdate(
            { userId: userId || 'default_user' },
            { $set: updateData },
            { new: true, upsert: true }
        );
        res.json({ message: "Profile updated", profile });
    } catch (err) {
        res.status(500).json({ error: "Failed to update profile" });
    }
});

// 2. Subjects / Circle Logos APIs
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find().sort({ _id: -1 });
        res.json(subjects);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch subjects" });
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
        res.status(500).json({ error: "Failed to create subject" });
    }
});

// 3. Notes APIs with Global Search & Privacy Control
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 9, search = '', subject = '', date = '', userId = '' } = req.query;
        page = parseInt(page);
        limit = parseInt(limit);

        // PRIVACY RULE:
        // User primary condition: Global Published Notes (isPrivate: false) OR Private Notes created by current user
        let filter = {
            $or: [
                { isPrivate: false },
                { isPrivate: true, createdBy: userId }
            ]
        };

        // Filter by Search Query
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            filter.$and = [
                {
                    $or: [
                        { title: searchRegex },
                        { content: searchRegex },
                        { subject: searchRegex }
                    ]
                }
            ];
        }

        // Filter by Subject
        if (subject) {
            filter.subject = new RegExp(`^${subject}$`, 'i');
        }

        // Filter by Date
        if (date) {
            filter.createdAt = new RegExp(date, 'i');
        }

        const totalNotes = await Note.countDocuments(filter);
        const notesList = await Note.find(filter)
            .sort({ isPinned: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        // Map notes to format liked state per user
        const formattedNotes = notesList.map(n => {
            const likedArray = n.likedUsers || [];
            return {
                _id: n._id,
                title: n.title,
                content: n.content,
                subject: n.subject,
                createdBy: n.createdBy,
                isPrivate: n.isPrivate,
                isPinned: n.isPinned,
                views: n.views,
                createdAt: n.createdAt,
                likes: likedArray.length,
                userLiked: userId ? likedArray.includes(userId) : false
            };
        });

        res.json({
            notes: formattedNotes,
            hasMore: (page * limit) < totalNotes,
            totalNotes
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load notes" });
    }
});

app.post('/api/notes', async (req, res) => {
    try {
        const { title, content, subject, isPrivate, isPinned, createdAt, userId } = req.body;
        const newNote = await Note.create({
            title: title || 'Untitled Note',
            content: content || '',
            subject: subject || 'General',
            createdBy: userId || 'anonymous',
            isPrivate: isPrivate !== undefined ? isPrivate : false, // Default published if set false
            isPinned: !!isPinned,
            likedUsers: [],
            views: 0,
            createdAt: createdAt || new Date().toLocaleString()
        });
        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ error: "Failed to save note" });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId, ...updateFields } = req.body;

        const note = await Note.findById(id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        // If updating content/privacy, check creator ownership
        if (updateFields.title || updateFields.content || updateFields.isPrivate !== undefined) {
            if (note.createdBy !== userId) {
                return res.status(403).json({ error: "You are not authorized to edit this note" });
            }
        }

        const updatedNote = await Note.findByIdAndUpdate(id, { $set: updateFields }, { new: true });
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: "Failed to update note" });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.query;

        const note = await Note.findById(id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        if (note.createdBy !== userId) {
            return res.status(403).json({ error: "Unauthorized to delete this note" });
        }

        await Note.findByIdAndDelete(id);
        res.json({ message: "Note deleted from MongoDB", id });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete note" });
    }
});

// Like Endpoint
app.post('/api/notes/:id/like', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;

        const note = await Note.findById(id);
        if (!note) return res.status(404).json({ error: "Note not found" });

        let userLiked = false;
        if (note.likedUsers.includes(userId)) {
            note.likedUsers = note.likedUsers.filter(u => u !== userId);
            userLiked = false;
        } else {
            note.likedUsers.push(userId);
            userLiked = true;
        }

        await note.save();
        res.json({ likes: note.likedUsers.length, userLiked });
    } catch (err) {
        res.status(500).json({ error: "Like toggle failed" });
    }
});

// File Upload Endpoint
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
