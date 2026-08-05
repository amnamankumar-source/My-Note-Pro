const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Base64 Media and Large Content Uploads Support
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/MyNoteProDB';
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Database Connected Successfully!'))
    .catch(err => console.error('❌ Database Connection Error:', err));

// ==========================================
// 📌 MONGOOSE SCHEMAS & MODELS
// ==========================================

// Note Schema
const noteSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true }, // Custom ID sync (e.g. neet_bio_01)
    title: { type: String, required: true, default: 'Untitled Note' },
    logo: { type: String, default: '' },
    author: { type: String, default: 'Pro User' },
    isSliderEnabled: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    likedByUser: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
    statusMedia: [
        {
            type: { type: String, enum: ['image', 'video'], default: 'image' },
            url: { type: String },
            text: { type: String, default: '' },
            isShort: { type: Boolean, default: false },
            isPinterest: { type: Boolean, default: false },
            isTwitter: { type: Boolean, default: false },
            isTelegram: { type: Boolean, default: false },
            isFacebook: { type: Boolean, default: false }
        }
    ],
    content: { type: String, default: '' },
    dateCreated: { type: String },
    isoDate: { type: String }
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// Settings Schema (Profile Name, Profile Image, Themes etc.)
const settingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true }
});

const Setting = mongoose.model('Setting', settingSchema);

// Permanent / Undeletable System Notes Config
const PERMANENT_NOTE_IDS = ["neet_bio_01", "neet_chem_03", "neet_zoo_04", "neet_phy_05"];


// ==========================================
// 🚀 REST API ENDPOINTS
// ==========================================

// 1. GET ALL NOTES
app.get('/api/notes', async (req, res) => {
    try {
        const notes = await Note.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: notes });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET SINGLE NOTE BY ID
app.get('/api/notes/:id', async (req, res) => {
    try {
        const note = await Note.findOne({ id: req.params.id });
        if (!note) return res.status(404).json({ success: false, message: 'Note not found' });
        res.status(200).json({ success: true, data: note });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. CREATE OR UPDATE (AUTO-SAVE) NOTE
app.post('/api/notes', async (req, res) => {
    try {
        const noteData = req.body;
        
        // Ensure Permanent notes cannot be deleted
        if (PERMANENT_NOTE_IDS.includes(noteData.id)) {
            noteData.isDeleted = false;
        }

        const updatedNote = await Note.findOneAndUpdate(
            { id: noteData.id },
            noteData,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json({ success: true, message: 'Note saved successfully!', data: updatedNote });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. DELETE NOTE (PERMANENT DELETE OR RECYCLE BIN MOVER)
app.delete('/api/notes/:id', async (req, res) => {
    try {
        const noteId = req.params.id;

        // Security Shield: Prevent permanent system notes deletion
        if (PERMANENT_NOTE_IDS.includes(noteId)) {
            return res.status(403).json({ success: false, message: 'Security Guard: Permanent notes cannot be deleted!' });
        }

        const note = await Note.findOne({ id: noteId });
        if (!note) return res.status(404).json({ success: false, message: 'Note not found' });

        if (note.isDeleted) {
            // Permanent Delete from MongoDB if already in Recycle Bin
            await Note.deleteOne({ id: noteId });
            return res.status(200).json({ success: true, message: 'Note permanently deleted from database.' });
        } else {
            // Move to Recycle Bin
            note.isDeleted = true;
            await note.save();
            return res.status(200).json({ success: true, message: 'Note moved to Recycle Bin.' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. RESTORE NOTE FROM RECYCLE BIN
app.patch('/api/notes/:id/restore', async (req, res) => {
    try {
        const note = await Note.findOneAndUpdate(
            { id: req.params.id },
            { isDeleted: false },
            { new: true }
        );
        res.status(200).json({ success: true, message: 'Note restored!', data: note });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. SAVE SETTING (PROFILE / THEME SETTINGS)
app.post('/api/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        const setting = await Setting.findOneAndUpdate(
            { key },
            { key, value },
            { upsert: true, new: true }
        );
        res.status(200).json({ success: true, data: setting });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. GET SETTING BY KEY
app.get('/api/settings/:key', async (req, res) => {
    try {
        const setting = await Setting.findOne({ key: req.params.key });
        res.status(200).json({ success: true, data: setting ? setting.value : null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Server Listening
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
