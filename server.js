require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');
const { GridFSBucket, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 5000;

// Body Parser Limit
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// 1. MongoDB Connection Setup via Environment Variables
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("FATAL ERROR: MONGO_URI is missing in .env file!");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Atlas Connected Successfully!'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// 2. Mongoose Database Schemas
const profileSchema = new mongoose.Schema({
    name: { type: String, default: "Note Author" },
    img: { type: String, default: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" }
});

const subjectSchema = new mongoose.Schema({
    name: String,
    img: String
});

const noteSchema = new mongoose.Schema({
    title: { type: String, default: 'Untitled Note' },
    content: { type: String, default: '' },
    subject: { type: String, default: 'General' },
    isPrivate: { type: Boolean, default: false },
    isPinned: { type: Boolean, default: false },
    likedUsers: { type: [String], default: [] },
    views: { type: Number, default: 0 },
    createdAt: { type: String, default: () => new Date().toLocaleString() }
}, { timestamps: true });

const Profile = mongoose.model('Profile', profileSchema);
const Subject = mongoose.model('Subject', subjectSchema);
const Note = mongoose.model('Note', noteSchema);

// Memory Storage for Multer (Saves directly to MongoDB GridFS)
const storage = multer.memoryStorage();
const upload = multer({ storage });

app.use(express.static(__dirname));

// API ROUTES

// Profile APIs
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
        if (!profile) profile = new Profile();
        if (name) profile.name = name;
        if (img) profile.img = img;
        await profile.save();
        res.json({ message: "Profile updated successfully", profile });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Subjects APIs
app.get('/api/subjects', async (req, res) => {
    try {
        let subjects = await Subject.find();
        if (subjects.length === 0) {
            subjects = await Subject.insertMany([
                { name: "Science", img: "https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&w=120&120&q=80" },
                { name: "Maths", img: "https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=120&120&q=80" }
            ]);
        }
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

// Notes APIs
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 9, search = '', subject = '', date = '', userId = '' } = req.query;
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
            query.subject = { $regex: `^${subject}$`, $options: 'i' };
        }

        if (date) {
            query.createdAt = { $regex: date, $options: 'i' };
        }

        const totalNotes = await Note.countDocuments(query);
        const notes = await Note.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const formattedNotes = notes.map(n => {
            const noteObj = n.toObject();
            return {
                ...noteObj,
                _id: noteObj._id.toString(),
                likes: (noteObj.likedUsers || []).length,
                userLiked: userId ? (noteObj.likedUsers || []).includes(userId) : false
            };
        });

        res.json({
            notes: formattedNotes,
            hasMore: (page * limit) < totalNotes,
            totalNotes
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
            createdAt: createdAt || new Date().toLocaleString()
        });
        res.status(201).json(newNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/notes/:id', async (req, res) => {
    try {
        const updatedNote = await Note.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedNote) return res.status(404).json({ error: "Note not found" });
        res.json(updatedNote);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/notes/:id/like', async (req, res) => {
    try {
        const { userId } = req.body;
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
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/notes/:id', async (req, res) => {
    try {
        await Note.findByIdAndDelete(req.params.id);
        res.json({ message: "Note deleted successfully from server", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Unlimited Media File Upload to MongoDB (GridFS)
app.post('/api/upload', upload.single('media'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    const uploadStream = bucket.openUploadStream(`${Date.now()}-${req.file.originalname}`, {
        contentType: req.file.mimetype
    });

    uploadStream.end(req.file.buffer);

    uploadStream.on('finish', () => {
        const fileUrl = `${req.protocol}://${req.get('host')}/api/files/${uploadStream.id}`;
        res.json({ url: fileUrl, fileType: req.file.mimetype });
    });

    uploadStream.on('error', (err) => {
        res.status(500).json({ error: err.message });
    });
});

// Serve Uploaded Files Directly from MongoDB GridFS
app.get('/api/files/:id', async (req, res) => {
    try {
        const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
        const _id = new ObjectId(req.params.id);
        const files = await bucket.find({ _id }).toArray();

        if (!files || files.length === 0) {
            return res.status(404).json({ error: 'File not found' });
        }

        res.set('Content-Type', files[0].contentType);
        bucket.openDownloadStream(_id).pipe(res);
    } catch (err) {
        res.status(500).json({ error: 'Invalid file requested' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
