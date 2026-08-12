const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Socket.io for Realtime Live Likes & Views
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cloudinary Storage Config (PDF, Image, Video, Text, Code Files)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'my_note_pro_uploads',
      resource_type: 'auto', // Auto-detects image, video, raw (pdf/code files)
    };
  },
});

const upload = multer({ storage: storage });

// MongoDB Database Connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mynotepro')
  .then(() => console.log('MongoDB Database Connected Successfully'))
  .catch((err) => console.error('MongoDB Connection Error:', err));

// MongoDB Schema Definition
const noteSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true }, // Store text, formatted HTML, code snippets
  author: { type: String, default: 'Anonymous Pro' },
  authorImg: { type: String, default: '' },
  subject: { type: String, default: 'General' },
  mediaUrls: [{ 
    url: String, 
    type: { type: String, enum: ['image', 'video', 'pdf', 'code', 'file'] } 
  }],
  likes: { type: Number, default: 0 },
  views: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });

const Note = mongoose.model('Note', noteSchema);

// ================= API ENDPOINTS ================= //

// 1. Get Notes with Pagination (Load 10 notes at a time for fast speed)
app.get('/api/notes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const subject = req.query.subject || '';
    const isTrash = req.query.trash === 'true';

    const skip = (page - 1) * limit;

    let query = { isDeleted: isTrash };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }

    if (subject && subject !== 'All') {
      query.subject = subject;
    }

    const notes = await Note.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalNotes = await Note.countDocuments(query);
    const hasMore = skip + notes.length < totalNotes;

    res.status(200).json({
      success: true,
      data: notes,
      currentPage: page,
      hasMore: hasMore,
      totalNotes: totalNotes
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Upload Files & Media (Images, Videos, PDFs, Code files)
app.post('/api/notes/upload', upload.array('files', 5), (req, res) => {
  try {
    const uploadedFiles = req.files.map(file => ({
      url: file.path,
      type: file.mimetype.startsWith('image/') ? 'image' : 
            file.mimetype.startsWith('video/') ? 'video' : 
            file.mimetype.includes('pdf') ? 'pdf' : 'file'
    }));

    res.status(200).json({
      success: true,
      files: uploadedFiles
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Create New Note
app.post('/api/notes', async (req, res) => {
  try {
    const { title, content, author, authorImg, subject, mediaUrls } = req.body;
    const newNote = new Note({
      title,
      content,
      author,
      authorImg,
      subject,
      mediaUrls: mediaUrls || []
    });

    await newNote.save();
    
    // Broadcast live event for new note creation
    io.emit('noteCreated', newNote);

    res.status(201).json({ success: true, data: newNote });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Increase Realtime View Count
app.post('/api/notes/:id/view', async (req, res) => {
  try {
    const note = await Note.findByIdAndUpdate(
      req.params.id,
      { $inc: { views: 1 } },
      { new: true }
    );

    if (note) {
      // Broadcast live realtime view change
      io.emit('statUpdated', { noteId: note._id, views: note.views, likes: note.likes });
    }

    res.status(200).json({ success: true, views: note ? note.views : 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. Increase/Decrease Realtime Like Count
app.post('/api/notes/:id/like', async (req, res) => {
  try {
    const { action } = req.body; // 'like' or 'unlike'
    const increment = action === 'unlike' ? -1 : 1;

    const note = await Note.findByIdAndUpdate(
      req.params.id,
      { $inc: { likes: increment } },
      { new: true }
    );

    if (note) {
      // Broadcast live realtime like change
      io.emit('statUpdated', { noteId: note._id, views: note.views, likes: note.likes });
    }

    res.status(200).json({ success: true, likes: note ? note.likes : 0 });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. Delete Note (Soft Move to Trash)
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const note = await Note.findByIdAndUpdate(req.params.id, { isDeleted: true }, { new: true });
    io.emit('noteDeleted', req.params.id);
    res.status(200).json({ success: true, message: 'Moved to trash' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Realtime WebSockets Handle
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
