require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 5000;

const BUCKET_NAME = 'my_note_pro';
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in environment variables!");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// OTP Storage (In-Memory Store)
const otpStore = {}; 

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(__dirname));

// Helper Function: Phone formatting back-end check
function formatPhoneNumber(phone) {
    if (!phone) return null;
    let cleanPhone = phone.trim();
    if (!cleanPhone.startsWith('+')) {
        if (cleanPhone.length === 10) {
            cleanPhone = '+91' + cleanPhone;
        } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
            cleanPhone = '+' + cleanPhone;
        }
    }
    return cleanPhone;
}

// ==========================================
// Middleware: JWT Verification
// ==========================================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: Please Login First' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or Expired Token' });
        req.user = user;
        next();
    });
};

// ==========================================
// 1. Authentication APIs (OTP & JWT)
// ==========================================

// Send OTP Endpoint (UPDATED)
app.post('/api/auth/send-otp', async (req, res) => {
    try {
        let { phone } = req.body;
        if (!phone) return res.status(400).json({ error: 'Mobile number required' });

        // Auto-format phone to E.164 (+91XXXXXXXXXX)
        phone = formatPhoneNumber(phone);
        
        if (!phone || phone.length < 13) {
            return res.status(400).json({ error: 'Invalid mobile number format' });
        }

        const otp = '123456'; // Testing OTP (Integrate Fast2SMS/Twilio here)
        otpStore[phone] = {
            otp: otp,
            expires: Date.now() + 5 * 60 * 1000 // 5 Minutes validity
        };

        console.log(`[OTP SENT] Phone: ${phone}, OTP: ${otp}`);
        return res.json({ success: true, message: 'OTP Sent Successfully', phone: phone });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Verify OTP & Generate JWT (UPDATED)
app.post('/api/auth/verify-otp', async (req, res) => {
    try {
        let { phone, otp } = req.body;
        
        if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

        phone = formatPhoneNumber(phone);

        const record = otpStore[phone];
        if (!record || record.otp !== otp || Date.now() > record.expires) {
            return res.status(400).json({ error: 'Invalid or Expired OTP' });
        }

        delete otpStore[phone]; // Clear OTP after verification

        // Supabase DB: Fetch or Create User Profile
        let { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('phone', phone)
            .maybeSingle();

        if (!profile) {
            const { data: newProfile, error: createError } = await supabase
                .from('profiles')
                .insert([{ 
                    phone: phone,
                    name: `User_${phone.slice(-4)}`, 
                    img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" 
                }])
                .select()
                .single();

            if (createError) throw createError;
            profile = newProfile;
        }

        // Generate JWT Token (valid for 30 days)
        const token = jwt.sign({ id: profile.id, phone: profile.phone }, JWT_SECRET, { expiresIn: '30d' });

        return res.json({
            token: token,
            user: profile
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. Profile APIs
// ==========================================
app.get('/api/profile', async (req, res) => {
    try {
        let { deviceId, phone } = req.query;
        let query = supabase.from('profiles').select('*');

        if (phone) {
            phone = formatPhoneNumber(phone);
            query = query.eq('phone', phone);
        } else if (deviceId) {
            query = query.eq('device_id', deviceId);
        } else {
            return res.status(400).json({ error: "Device ID or Phone required" });
        }

        const { data, error } = await query.maybeSingle();
        if (error && error.code !== 'PGRST116') throw error;
        
        if (!data) {
            const { data: newProfile, error: createError } = await supabase
                .from('profiles')
                .insert([{ 
                    device_id: deviceId || null,
                    phone: phone || null,
                    name: "Note Author", 
                    img: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80" 
                }])
                .select()
                .single();
            if (createError) throw createError;
            return res.json(newProfile);
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { deviceId, name, img } = req.body;
        const userId = req.user.id;

        const updatePayload = {};
        if (name !== undefined) updatePayload.name = name;
        if (img !== undefined) updatePayload.img = img;
        if (deviceId !== undefined) updatePayload.device_id = deviceId;

        const { data, error } = await supabase
            .from('profiles')
            .update(updatePayload)
            .eq('id', userId)
            .select()
            .single();

        if (error) throw error;
        res.json({ message: "Profile updated successfully", profile: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. Subjects APIs
// ==========================================
app.get('/api/subjects', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('subjects')
            .select('*')
            .order('id', { ascending: false });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/subjects', authenticateToken, async (req, res) => {
    try {
        const { name, img } = req.body;
        if (!name) return res.status(400).json({ error: "Subject name is required" });

        const { data: existing } = await supabase
            .from('subjects')
            .select('id')
            .ilike('name', name)
            .maybeSingle();

        if (existing) {
            return res.status(400).json({ error: "Circle logo with this name already exists!" });
        }

        const { data, error } = await supabase
            .from('subjects')
            .insert([{
                name: name,
                img: img || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=120&120&q=80"
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/subjects/:id', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase
            .from('subjects')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ message: "Subject deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. Notes APIs (Public & Protected)
// ==========================================

// Public Route: View Notes
app.get('/api/notes', async (req, res) => {
    try {
        let { page = 1, limit = 10, search = '', subject = '', date = '', deviceId = '' } = req.query;
        page = Math.max(1, parseInt(page));
        limit = Math.max(1, parseInt(limit));
        const skip = (page - 1) * limit;

        let query = supabase.from('notes').select('*', { count: 'exact' });

        if (deviceId) {
            query = query.not('deleted_for', 'cs', `{${deviceId}}`);
        }

        if (search) {
            query = query.or(`title.ilike.%${search}%,content.ilike.%${search}%`);
        }

        if (subject) {
            query = query.ilike('subject', subject);
        }

        if (date) {
            query = query.ilike('created_at_formatted', `%${date}%`);
        }

        query = query.order('is_pinned', { ascending: false })
                     .order('created_at', { ascending: false })
                     .range(skip, skip + limit - 1);

        const { data: notes, count: totalNotes, error } = await query;
        if (error) throw error;

        const formattedNotes = (notes || []).map(note => {
            const likedByArray = note.liked_by || [];
            const isLiked = deviceId ? likedByArray.includes(deviceId) : false;
            return {
                _id: note.id,
                title: note.title,
                content: note.content,
                subject: note.subject,
                userProfilePic: note.user_profile_pic || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80",
                authorDeviceId: note.author_device_id || '',
                authorUserId: note.author_user_id || null,
                isPrivate: note.is_private,
                isPinned: note.is_pinned,
                likes: note.likes || 0,
                likedBy: likedByArray,
                views: note.views || 0,
                viewedBy: note.viewed_by || [],
                createdAtFormatted: note.created_at_formatted,
                createdAt: note.created_at,
                userLiked: isLiked
            };
        });

        res.json({
            notes: formattedNotes,
            hasMore: skip + formattedNotes.length < (totalNotes || 0),
            totalNotes: totalNotes || 0,
            currentPage: page
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Protected Route: Create Note
app.post('/api/notes', authenticateToken, async (req, res) => {
    try {
        const { title, content, subject, userProfilePic, authorDeviceId, isPrivate, isPinned, createdAt } = req.body;
        
        const { data, error } = await supabase
            .from('notes')
            .insert([{
                title: title || 'Untitled Note',
                content: content || '',
                subject: subject || 'General',
                user_profile_pic: userProfilePic || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
                author_device_id: authorDeviceId || '',
                author_user_id: req.user.id,
                is_private: isPrivate || false,
                is_pinned: isPinned || false,
                created_at_formatted: createdAt || new Date().toLocaleString()
            }])
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ ...data, _id: data.id, author: req.user.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Protected Route: Update Note
app.put('/api/notes/:id', authenticateToken, async (req, res) => {
    try {
        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !note) return res.status(404).json({ error: "Note not found" });

        if (note.is_pinned) {
            return res.status(403).json({ error: "Pinned notes are locked and cannot be edited." });
        }

        const updateData = {};
        if (req.body.title !== undefined) updateData.title = req.body.title;
        if (req.body.content !== undefined) updateData.content = req.body.content;
        if (req.body.subject !== undefined) updateData.subject = req.body.subject;
        if (req.body.userProfilePic !== undefined) updateData.user_profile_pic = req.body.userProfilePic;
        if (req.body.isPrivate !== undefined) updateData.is_private = req.body.isPrivate;
        if (req.body.isPinned !== undefined) updateData.is_pinned = req.body.isPinned;

        const { data: updated, error: updateErr } = await supabase
            .from('notes')
            .update(updateData)
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateErr) throw updateErr;
        res.json({ message: 'Note updated successfully', ...updated, _id: updated.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Protected Route: Delete Note
app.delete('/api/notes/:id', authenticateToken, async (req, res) => {
    try {
        const { deviceId } = req.query;

        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !note) return res.status(404).json({ error: "Note not found" });

        if (deviceId) {
            let deletedFor = note.deleted_for || [];
            if (!deletedFor.includes(deviceId)) {
                deletedFor.push(deviceId);
                await supabase
                    .from('notes')
                    .update({ deleted_for: deletedFor })
                    .eq('id', req.params.id);
            }
        } else {
            await supabase.from('notes').delete().eq('id', req.params.id);
        }

        res.json({ message: "Note deleted successfully", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Like
app.put('/api/notes/:id/like', async (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) return res.status(400).json({ error: 'Device ID required' });

        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !note) return res.status(404).json({ error: "Note not found" });

        let likedBy = note.liked_by || [];
        let likes = note.likes || 0;
        const alreadyLiked = likedBy.includes(deviceId);

        if (alreadyLiked) {
            likedBy = likedBy.filter(id => id !== deviceId);
            likes = Math.max(0, likes - 1);
        } else {
            likedBy.push(deviceId);
            likes += 1;
        }

        const { data: updated, error: updateErr } = await supabase
            .from('notes')
            .update({ liked_by: likedBy, likes: likes })
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        res.json({
            likes: updated.likes,
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

        const { data: note, error: fetchErr } = await supabase
            .from('notes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (fetchErr || !note) return res.status(404).json({ error: "Note not found" });

        let viewedBy = note.viewed_by || [];
        if (deviceId && !viewedBy.includes(deviceId)) {
            viewedBy.push(deviceId);
        }

        const { data: updated, error: updateErr } = await supabase
            .from('notes')
            .update({ views: (note.views || 0) + 1, viewed_by: viewedBy })
            .eq('id', req.params.id)
            .select()
            .single();

        if (updateErr) throw updateErr;

        res.json({ views: updated.views });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Feed Endpoint
app.get('/api/feed', async (req, res) => {
    try {
        const { data: files, error: filesError } = await supabase
            .storage
            .from(BUCKET_NAME)
            .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });

        if (filesError) throw filesError;

        const mediaList = (files || []).map(file => {
            const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(file.name);
            return {
                name: file.name,
                url: data.publicUrl,
                createdAt: file.created_at
            };
        });

        res.json({ files: mediaList });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 5. File Upload
// ==========================================
app.post('/api/upload', authenticateToken, (req, res) => {
    upload.array('media', 10)(req, res, async (err) => {
        if (err) {
            console.error("Multer Upload Error:", err);
            return res.status(500).json({ error: err.message || 'Upload failed' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        try {
            const uploadedFiles = [];

            for (const file of req.files) {
                const cleanFileName = path.parse(file.originalname).name.replace(/[^a-zA-Z0-9]/g, "_");
                const ext = path.extname(file.originalname);
                const filePath = `uploads/${Date.now()}_${cleanFileName}${ext}`;

                const { data, error: uploadErr } = await supabase
                    .storage
                    .from(BUCKET_NAME)
                    .upload(filePath, file.buffer, {
                        contentType: file.mimetype,
                        upsert: true
                    });

                if (uploadErr) throw uploadErr;

                const { data: urlData } = supabase
                    .storage
                    .from(BUCKET_NAME)
                    .getPublicUrl(filePath);

                uploadedFiles.push({
                    url: urlData.publicUrl,
                    fileType: file.mimetype,
                    filename: file.originalname,
                    path: filePath
                });
            }

            res.json({
                message: 'Files uploaded to Supabase Storage successfully',
                files: uploadedFiles,
                url: uploadedFiles[0].url,
                fileType: uploadedFiles[0].fileType,
                filename: uploadedFiles[0].filename
            });
        } catch (error) {
            console.error("Supabase Storage Upload Error:", error);
            res.status(500).json({ error: error.message || 'Supabase upload failed' });
        }
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
